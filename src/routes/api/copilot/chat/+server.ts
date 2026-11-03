/**
 * Copilot SSE chat endpoint.
 *
 * CONTRACT
 * - Stateless: client ships full conversation + pre-rendered CURRENT STATE every turn.
 * - Server only DECIDES tool calls; executor.ts in the browser RUNS them.
 * - Validates tool args against argSchemas; one corrective retry per turn.
 * - Frames out: text → tool_call(s) → end | error (see Frame in #lib/ai/types).
 */
import { error } from "@sveltejs/kit";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import type { RequestHandler } from "./$types";
import { runChatFrames, type RunChatEnv } from "#lib/ai/client.js";
import { sseStream } from "#lib/ai/streaming.js";
import { buildSystemContext, FEW_SHOTS, titleFromMessage } from "#lib/ai/prompts.js";
import { TOOLS_CATALOG } from "#lib/ai/tools-catalog.js";
import { argSchemas, isKnownToolName } from "#lib/ai/schemas.js";
import { retrieveAppKnowledge, formatKnowledge } from "#lib/ai/rag.js";
import { salvageTextToolCalls } from "#lib/ai/salvage.js";
import { MAX_IMAGE_DATA_URL_CHARS, MAX_IMAGES } from "#lib/ai/image-limits.js";
import { loadCloudflareConfig, resolveCloudflareCreds } from "#lib/server/ai/cloudflare-config.js";
import { createConversation, getConversation, touchUpdatedAt } from "#lib/server/repositories/ai-conversations.js";
import { appendMessage } from "#lib/server/repositories/ai-messages.js";
import { checkChatRateLimit } from "#lib/server/rate-limit.js";
import type { ParsedToolCall } from "#lib/ai/types.js";

/**
 * Vision model for image-bearing turns — mistral-small-3.1 reads the screenshot AND
 * still tool-calls (so a pasted order screenshot can drive addRows/editCells). Text-
 * only turns stay on the user's chosen brain model. To fall back to the brain for
 * vision, point this at the brain model or drop the `chatEnv.model` branch below.
 */
const VISION_MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct";

const bodySchema = z.object({
    conversationId: z.string().nullable().optional(),
    messages: z
        .array(
            z.object({
                role: z.enum(["user", "assistant"]),
                content: z.string().max(12000)
            })
        )
        .min(1)
        .max(80),
    contextText: z.string().max(60000),
    images: z.array(z.string().max(MAX_IMAGE_DATA_URL_CHARS)).max(MAX_IMAGES).optional()
});

interface ValidatedCall {
    call: ParsedToolCall;
    valid: boolean;
    error?: string;
}

const validateToolCalls = (calls: ParsedToolCall[]): ValidatedCall[] =>
    calls.map((call) => {
        if (!isKnownToolName(call.name)) {
            return { call, valid: false, error: `Unknown tool "${call.name}"` };
        }
        const result = argSchemas[call.name].safeParse(call.args ?? {});
        if (!result.success) {
            return {
                call,
                valid: false,
                error: result.error.issues[0]?.message ?? "Invalid arguments"
            };
        }
        return { call: { ...call, args: result.data }, valid: true };
    });

const correctiveMessage = (invalid: ValidatedCall[]): string =>
    [
        "Your previous tool call(s) failed schema validation:",
        ...invalid.map((v) => `- "${v.call.name}": ${v.error}`),
        "",
        "Re-issue ONLY the corrected tool call(s) listed above — do NOT repeat any other action you already performed this turn. Argument names and types must exactly match each tool's schema. If you cannot produce a valid call, reply with a short plain-text explanation instead."
    ].join("\n");

/** Retry prompt for when the model writes a tool call as chat text instead of calling it. */
const LEAK_RETRY_MESSAGE =
    "Your previous response wrote the action as a chat message instead of calling a tool, so nothing happened. Re-issue it now as a real tool call through the tool interface. If you genuinely cannot, reply with one short plain-language sentence — never JSON or code.";

/** Retry prompt for when the model should have acted on an instruction but called no tool. */
const ACTION_RETRY_MESSAGE =
    "Your previous reply did not call any tool, so nothing changed. The user gave an instruction to change the batch or their settings. Emit the correct tool call now through the tool interface. Do NOT ask the user to confirm in chat (the UI handles confirmation) and do NOT claim anything was done. Only if the request is genuinely out of scope or impossible, say so plainly in one short sentence.";

/**
 * The user gave an imperative instruction (not a question) — they expect an
 * action. The gateway chain models intermittently narrate an action ("Done…",
 * "Adding a new row…", "Confirm to append…") WITHOUT calling a tool, so nothing
 * runs. We detect that from the user's intent rather than the model's wording.
 */
const IMPERATIVE_RE =
    /\b(set|add|change|update|delete|remove|edit|fix|mark|make|apply|append|insert|rename|clear|replace|assign|move|undo|revert|create|correct|adjust|drop|fill|put)\b/i;
/** Read-only/interrogative lead words — a message starting with one is a question, not a command. */
const READONLY_LEAD_RE =
    /^(how|what|when|where|which|why|who|is|are|do|does|did|can|could|would|show|tell|list|remind|give)\b/i;
const looksImperative = (text: string): boolean => {
    const t = text.trim();
    // Read-only questions ("show my rows", "what's the total") must not trigger the
    // forced action-retry even when they lack a trailing "?".
    if (READONLY_LEAD_RE.test(t)) return false;
    return t.length > 0 && !t.endsWith("?") && IMPERATIVE_RE.test(t);
};
/** A genuine refusal/clarification we must NOT suppress as a false action narration. */
const REFUSAL_RE =
    /\b(can'?t|cannot|can not|unable|won'?t|not able|out of scope|outside|only help|only assist|don'?t|do not|no batch|no csv|upload a csv)\b/i;
/**
 * A completion claim ("Done", "Updated 5 rows", "I've added…"). Only when the model
 * CLAIMS it acted but ran no tool do we blank the reply — a genuine read-only answer
 * makes no such claim and must be preserved.
 */
const AFFIRMATION_RE =
    /\b(done|updated?|set|added?|applied|appended|inserted|changed|removed|deleted|cleared|renamed|replaced|fixed|marked|created|adjusted|corrected|archived|restored|reordered|shared|i'?ve|i have|i'?ll|all set|here you go)\b/i;

/**
 * Heuristic: did the model emit tool args as a JSON literal in chat text?
 * `@cf/openai/gpt-oss-120b` does this intermittently — surfacing it as text
 * would leak raw JSON AND silently no-op the user's request.
 */
const looksLikeLeakedToolCall = (text: string): boolean => {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return false;
    try {
        const parsed: unknown = JSON.parse(text.slice(start, end + 1));
        return typeof parsed === "object" && parsed !== null;
    } catch {
        return false;
    }
};

/**
 * Conversations are in-memory client-side with no server id; derive a stable id
 * from the first user message so gateway session affinity holds across a
 * conversation's turns without leaking content.
 */
const stableConversationId = async (seed: string): Promise<string> => {
    const data = new TextEncoder().encode(seed);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest).slice(0, 16))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
};

export const POST: RequestHandler = async ({ locals, request }) => {
    if (!locals.user) {
        error(401, "Not authenticated");
    }
    if (!env.AI) {
        error(503, "AI is not available in this environment.");
    }

    // D1 handle reused for the per-user rate limit below and turn persistence
    // further down. Null when D1 is unbound (degraded mode) — both uses fail open.
    const db = env.DB ? drizzle(env.DB) : null;
    // Capture once: control-flow narrowing of `locals.user` (from the 401 guard
    // above) does not reach the deferred sseStream callback below.
    const userId = locals.user.id;

    let parsed: z.infer<typeof bodySchema>;
    try {
        parsed = bodySchema.parse(await request.json());
    } catch (err) {
        error(400, err instanceof Error ? err.message : "Invalid request body");
    }

    const lastMessage = parsed.messages[parsed.messages.length - 1];
    if (!lastMessage || lastMessage.role !== "user") {
        error(400, "The conversation must end with a user message.");
    }

    let userMessage = lastMessage.content;
    const history = parsed.messages.slice(0, -1);

    // BYO Cloudflare gate. Inference (and the RAG query embedding) run on the
    // USER's own account, billed to them — never the owner's bound `env.AI`. A
    // connected account is REQUIRED: respond 412 with a connect link so the
    // Copilot UI can render a "Connect your Cloudflare account" CTA instead of a
    // generic error. Gated BEFORE the rate limit so an unconnected user never
    // burns a rate-limit unit (matches day-zero / invoice-generator ordering).
    const encryptionKey = env.TOKEN_ENCRYPTION_KEY;
    const resolved =
        db && encryptionKey
            ? await resolveCloudflareCreds(encryptionKey, await loadCloudflareConfig(db, userId)).catch(() => null)
            : null;
    if (!resolved) {
        return Response.json(
            { error: "Connect your Cloudflare account in Settings to use the copilot.", connect: "/settings" },
            { status: 412 }
        );
    }

    // Per-user spend guard: each turn drives real Workers AI (one model call +
    // corrective retry + RAG embedding). Reuses the rate_limits table; skipped
    // when D1 is unavailable. friendlyHttpError() maps the 429 to a banner.
    if (db && !(await checkChatRateLimit(db, userId))) {
        error(429, "You're sending messages too quickly. Please wait a moment and try again.");
    }

    if (env.VECTORIZE) {
        try {
            const knowledge = formatKnowledge(
                await retrieveAppKnowledge(env.VECTORIZE, env.AI, resolved.creds, lastMessage.content)
            );
            if (knowledge.length > 0) {
                userMessage = `${userMessage}\n\nAPP KNOWLEDGE:\n${knowledge}`;
            }
        } catch {
            // Knowledge retrieval is best-effort; ignore failures.
        }
    }

    // Image-bearing turns route to VISION_MODEL (tools still attached — see the
    // TOOLS_CATALOG passed on every runChatFrames call below); text-only turns keep
    // the user's chosen brain model.
    const chatEnv: RunChatEnv = {
        creds: resolved.creds,
        model: parsed.images && parsed.images.length > 0 ? VISION_MODEL : resolved.model
    };
    const systemContext = buildSystemContext(parsed.contextText, TOOLS_CATALOG);
    const withFewShots = history.length === 0 ? [...FEW_SHOTS, ...history] : history;
    const turnId = crypto.randomUUID();
    const firstUserMessage = parsed.messages.find((m) => m.role === "user")?.content ?? userMessage;
    const conversationId = await stableConversationId(firstUserMessage);

    // D1 persistence runs alongside the stateless model flow above — the model
    // still receives the client-shipped history; D1 only records the turn so
    // conversations survive reloads. Persistence failures never abort the turn.
    let persistedConversationId: string | null = null;
    if (db) {
        try {
            const requestedId = parsed.conversationId ?? null;
            let conversation = requestedId ? await getConversation(db, userId, requestedId) : null;
            if (!conversation) {
                conversation = await createConversation(db, userId, titleFromMessage(lastMessage.content));
            }
            persistedConversationId = conversation.id;
            await appendMessage(db, persistedConversationId, { role: "user", content: lastMessage.content });
        } catch {
            persistedConversationId = null;
        }
    }

    return sseStream(async (push) => {
        let errored: string | null = null;
        let assistantText = "";
        const persistedToolCalls: ParsedToolCall[] = [];

        // Buffer the entire turn before flushing: we must inspect the text for
        // leaked tool-call JSON BEFORE pushing it to the client (see prompts.ts
        // and warning #19 in CLAUDE.md).
        const consume = async (gen: ReturnType<typeof runChatFrames>) => {
            let step = await gen.next();
            while (!step.done) {
                const frame = step.value;
                if (frame.t === "error") {
                    errored = frame.message;
                    push(frame);
                }
                step = await gen.next();
            }
            return step.value;
        };

        try {
            const first = await consume(
                runChatFrames(chatEnv, {
                    systemContext,
                    history: withFewShots,
                    userMessage,
                    conversationId,
                    // Conditional spread: exactOptionalPropertyTypes forbids passing
                    // `images: undefined` to an optional `images?: string[]` param.
                    ...(parsed.images ? { images: parsed.images } : {}),
                    tools: TOOLS_CATALOG
                })
            );

            // Recover tool calls the model emitted as plain-text JSON instead of a
            // structured frame (a known chain-model failure) BEFORE validating — else
            // the call is dropped and the user's request silently no-ops.
            let firstCalls = first.toolCalls;
            let firstText = first.text;
            if (firstCalls.length === 0 && !errored && firstText.trim().length > 0) {
                const s = salvageTextToolCalls(firstText);
                if (s.calls.length > 0) {
                    firstCalls = s.calls;
                    firstText = s.cleanedText;
                }
            }

            let validated = validateToolCalls(firstCalls);
            let replyText = firstText;
            const invalid = validated.filter((v) => !v.valid);
            const leakedAsText = firstCalls.length === 0 && looksLikeLeakedToolCall(firstText);
            const userImperative = looksImperative(lastMessage.content);
            // Model failed to act: an imperative instruction produced no tool call,
            // it wasn't leaked JSON, and the reply isn't a clarifying question.
            const failedToAct = firstCalls.length === 0 && !leakedAsText && userImperative && !firstText.includes("?");

            // Exactly one corrective retry: malformed args, a tool call written as
            // chat text, OR an instruction that produced no tool call. No retry on
            // retry — failures fall through to a friendly fallback reply.
            if ((invalid.length > 0 || leakedAsText || failedToAct) && !errored) {
                // Preserve the turn-1 calls that already validated so a mixed
                // valid+invalid turn doesn't silently drop the user's good action.
                const firstValid = validated.filter((v) => v.valid);
                const retryMessage =
                    invalid.length > 0
                        ? correctiveMessage(invalid)
                        : leakedAsText
                          ? LEAK_RETRY_MESSAGE
                          : ACTION_RETRY_MESSAGE;
                const retry = await consume(
                    runChatFrames(chatEnv, {
                        systemContext,
                        history: [
                            ...withFewShots,
                            { role: "user" as const, content: userMessage },
                            {
                                role: "assistant" as const,
                                content: "[The assistant did not produce a valid tool call.]"
                            }
                        ],
                        userMessage: retryMessage,
                        conversationId,
                        tools: TOOLS_CATALOG
                    })
                );
                // Salvage on the retry path too, and strip the consumed JSON region
                // from the reply (use cleanedText, never the raw retry.text).
                let retryCalls = retry.toolCalls;
                let retryText = retry.text;
                if (retryCalls.length === 0 && retryText.trim().length > 0) {
                    const s = salvageTextToolCalls(retryText);
                    if (s.calls.length > 0) {
                        retryCalls = s.calls;
                        retryText = s.cleanedText;
                    }
                }
                const retryValidated = validateToolCalls(retryCalls);
                // Only the invalid-args branch had valid turn-1 calls to keep; the
                // leak / failed-to-act branches produced none, so they replace.
                validated = invalid.length > 0 ? [...firstValid, ...retryValidated] : retryValidated;
                const retryLeaked = retryCalls.length === 0 && looksLikeLeakedToolCall(retryText);
                replyText = retryLeaked ? "" : retryText;
            }

            const validCalls = validated.filter((entry) => entry.valid);

            // Final safety net: drop leaked JSON, and never let an action narration
            // stand when no tool ran (the model "did" nothing). Genuine refusals and
            // clarifying questions are preserved; a narration alongside a real call
            // is true, so it's kept.
            let outText = replyText;
            if (looksLikeLeakedToolCall(outText)) outText = "";
            else if (
                validCalls.length === 0 &&
                userImperative &&
                !outText.includes("?") &&
                !REFUSAL_RE.test(outText) &&
                AFFIRMATION_RE.test(outText)
            ) {
                outText = "";
            }
            if ((leakedAsText || failedToAct) && validCalls.length === 0 && outText.trim().length === 0) {
                outText = "I couldn't apply that change — could you rephrase your request?";
            }
            if (outText.trim().length > 0) {
                assistantText = outText;
                push({ t: "text", delta: outText });
            }
            for (const entry of validCalls) {
                persistedToolCalls.push({ id: entry.call.id, name: entry.call.name, args: entry.call.args });
                push({
                    t: "tool_call",
                    id: entry.call.id,
                    name: entry.call.name,
                    args: entry.call.args
                });
            }
        } catch (err) {
            push({ t: "error", message: err instanceof Error ? err.message : "Stream failed" });
        }

        if (db && persistedConversationId) {
            try {
                await appendMessage(db, persistedConversationId, {
                    role: "assistant",
                    content: assistantText,
                    toolCalls: persistedToolCalls.length > 0 ? persistedToolCalls : null
                });
                await touchUpdatedAt(db, userId, persistedConversationId);
            } catch {
                // Persistence is best-effort; the live turn already streamed.
            }
        }

        push({ t: "end", turnId, conversationId: persistedConversationId ?? undefined });
    });
};
