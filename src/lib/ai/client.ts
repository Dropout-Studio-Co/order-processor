/**
 * Workers AI bridge — bring-your-own (BYO) Cloudflare account.
 *
 * Chat + tool-calling runs on the END USER's own Cloudflare account over the
 * Workers AI REST API (billed to them), NOT the owner's bound `env.AI` /
 * AI-Gateway dynamic route. The single user-picked model is used (no fallback
 * chain — the chain lived in the gateway route which BYO bypasses).
 *
 * The REST call is BUFFERED (one request → one full result), but this module
 * keeps the exact same `AsyncGenerator<Frame, RawChatResult>` signature the chat
 * endpoint consumes: it emits the buffered text as a single `text` frame, then a
 * `tool_call` frame per decided call. The SSE wire format the browser reads is
 * therefore unchanged (one larger text delta instead of many small ones).
 *
 * Only imported by `/api/copilot/chat/+server.ts` (server) — never client-
 * bundled — so importing the server-only REST client here is safe.
 *
 * Native multimodal vision still rides as `image_url` content parts on the same
 * model.
 */
import type { Frame, ParsedToolCall, ToolCatalogEntry, RawChatResult } from "./types";
import {
    runChatViaRest,
    CfInferenceError,
    type CloudflareCreds,
    type ChatRestResult
} from "#lib/server/ai/run-rest.js";

export type { RawChatResult } from "./types";

/** BYO env: the resolved per-user creds + the user-selected model id. */
export interface RunChatEnv {
    creds: CloudflareCreds;
    model: string;
}

export interface RunChatParams {
    systemContext: string;
    history: Array<{ role: "user" | "assistant"; content: string }>;
    userMessage: string;
    conversationId: string;
    tools: ToolCatalogEntry[];
    images?: string[];
    maxTokens?: number;
}

const buildToolsPayload = (tools: ToolCatalogEntry[]) =>
    tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters }
    }));

type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

/** Plain string when no images; otherwise a multimodal content-part array (text + image_url). */
const buildUserContent = (text: string, images?: string[]): string | ContentPart[] => {
    if (!images || images.length === 0) return text;
    return [{ type: "text", text }, ...images.map((url): ContentPart => ({ type: "image_url", image_url: { url } }))];
};

/** Maps a CfInferenceError to a clean, user-facing model-error message. */
const cfErrorMessage = (err: CfInferenceError): string => {
    switch (err.kind) {
        case "auth":
            return "Your Cloudflare token was rejected — reconnect your account in Settings.";
        case "model_unavailable":
            return "The selected model isn't available on your account — pick another in Settings.";
        case "rate_limit":
            return "Cloudflare rate-limited the request. Wait a moment and try again.";
        default:
            return "Couldn't reach Cloudflare Workers AI. Please try again.";
    }
};

/** Normalizes the REST `tool_calls` shape (id/name/arguments) into ParsedToolCall. */
const parseToolCalls = (result: ChatRestResult): ParsedToolCall[] => {
    const calls = Array.isArray(result.tool_calls) ? result.tool_calls : [];
    const out: ParsedToolCall[] = [];
    for (const tc of calls) {
        const name = typeof tc.name === "string" ? tc.name : "";
        if (name.length === 0) continue;
        let args: unknown = tc.arguments ?? {};
        // Some models return arguments as a JSON string rather than an object.
        if (typeof args === "string") {
            const trimmed = args.trim();
            if (trimmed.length === 0) {
                args = {};
            } else {
                try {
                    args = JSON.parse(trimmed);
                } catch {
                    args = {};
                }
            }
        }
        out.push({ id: tc.id && tc.id.length > 0 ? tc.id : crypto.randomUUID(), name, args });
    }
    return out;
};

/**
 * Runs one chat turn on the user's account. Emits the buffered text as one frame
 * then a frame per tool call; returns the accumulated `RawChatResult` for the
 * caller to persist. Mirrors the previous streaming generator's contract.
 */
export const runChatFrames = async function* (
    env: RunChatEnv,
    params: RunChatParams
): AsyncGenerator<Frame, RawChatResult> {
    const messages = [
        { role: "system", content: params.systemContext },
        ...params.history.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: buildUserContent(params.userMessage, params.images) }
    ];

    const result: RawChatResult = { text: "", toolCalls: [] };

    let rest: ChatRestResult;
    try {
        rest = await runChatViaRest(env.creds, env.model, {
            messages,
            ...(params.tools.length > 0 ? { tools: buildToolsPayload(params.tools) } : {}),
            // Low temperature keeps tool-arg JSON deterministic.
            max_tokens: params.maxTokens ?? 2048,
            temperature: 0.2
        });
    } catch (err) {
        const message =
            err instanceof CfInferenceError
                ? cfErrorMessage(err)
                : err instanceof Error
                  ? err.message
                  : "Model invocation failed";
        yield { t: "error", message };
        return result;
    }

    if (typeof rest.response === "string" && rest.response.length > 0) {
        result.text = rest.response;
        yield { t: "text", delta: rest.response };
    }

    for (const call of parseToolCalls(rest)) {
        result.toolCalls.push(call);
        yield { t: "tool_call", id: call.id, name: call.name, args: call.args };
    }

    return result;
};
