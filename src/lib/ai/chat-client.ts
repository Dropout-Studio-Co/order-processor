/**
 * One Copilot turn: append user msg → POST to /api/copilot/chat → consume SSE
 * frames → execute any tool calls in the browser.
 *
 * Server is stateless: every request ships full message history + the
 * `projectBatchState` CURRENT STATE block. Errors NEVER surface as raw text in
 * the assistant bubble — friendlyHttpError() maps them onto the error banner.
 */
import { copilot } from "#lib/stores/copilot.svelte.js";
import { copilotBridge } from "#lib/stores/copilot-bridge.svelte.js";
import { brandSettings } from "#lib/stores/index.js";
import { api } from "#lib/api/client.js";
import { projectBatchState } from "./context";
import { streamFrames } from "./streaming";
import { executeToolCall, type ConfirmationRequest, type ExecutorContext } from "./executor";
import type { ChatRequestBody, ParsedToolCall, PersistedConversationSummary, PersistedMessage } from "./types";

// Defense-in-depth: ensures error banners are always user-readable; never
// expose raw status codes or server payloads (see CLAUDE.md warning #19).
const friendlyHttpError = (status: number): string => {
    switch (status) {
        case 401:
            return "Your session has expired. Please refresh the page and sign in again.";
        case 429:
            return "The Copilot is handling a lot of requests right now. Wait a few seconds and try again.";
        case 503:
            return "The Copilot is temporarily unavailable. Please try again in a moment.";
        default:
            return "Something went wrong reaching the Copilot. Please try again.";
    }
};

// Bridges executor → confirm dialog: enqueue the request, await the dialog's
// resolve(approved) call, then auto-dequeue.
const requestConfirmation = (req: ConfirmationRequest): Promise<boolean> =>
    new Promise((resolve) => {
        copilot.enqueueConfirmation({
            toolCallId: req.toolCallId,
            toolName: req.toolName,
            humanLabel: req.humanLabel,
            diff: req.diff,
            anomalies: req.anomalies,
            inverseSummary: req.inverseSummary,
            resolve: (approved: boolean) => {
                copilot.dequeueConfirmation(req.toolCallId);
                resolve(approved);
            }
        });
    });

export const sendMessage = async (text: string): Promise<void> => {
    const trimmed = text.trim();
    const images = copilot.pendingImages.length > 0 ? [...copilot.pendingImages] : undefined;
    if ((trimmed.length === 0 && !images) || copilot.inputBusy) return;

    const localConversationId = copilot.activeConversationId;
    const persistedConversationId = copilot.activeConversation.persisted ? localConversationId : null;

    const userMessageId = crypto.randomUUID();
    const userText = trimmed.length > 0 ? trimmed : "Please read the attached image.";
    copilot.appendUserMessage(userMessageId, userText, images);

    // Snapshot history BEFORE startAssistantMessage so the in-progress placeholder isn't included.
    // A tool-only assistant turn has empty text; keep it (using its tool-call
    // summaries as content) so the model sees the action was already completed
    // and doesn't re-fire the prior instruction on the next turn.
    const history = copilot.messages
        .filter((m) => m.role === "user" || m.content.trim().length > 0 || m.toolCalls.length > 0)
        .map((m) => {
            if (m.content.trim().length > 0) return { role: m.role, content: m.content };
            const done = m.toolCalls.map((c) => c.summary?.trim()).filter((s): s is string => !!s);
            return { role: m.role, content: done.length > 0 ? done.join(" ") : "(action completed)" };
        });

    const contextText = projectBatchState(
        copilotBridge.editor,
        brandSettings.value,
        copilotBridge.ingestion?.getRawCsv() ?? null,
        copilot.undoStack.some((entry) => !entry.undone)
    );

    const assistantId = crypto.randomUUID();
    copilot.setError(null);
    copilot.setConnectRequired(false);
    copilot.setStreaming(true);
    copilot.startAssistantMessage(assistantId);

    const collectedToolCalls: ParsedToolCall[] = [];

    try {
        const body: ChatRequestBody = { messages: history, contextText, conversationId: persistedConversationId };
        if (images) body.images = images;

        const response = await fetch("/api/copilot/chat", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body)
        });

        // 412 = no BYO Cloudflare account connected. Surface the dedicated
        // "Connect your Cloudflare account in Settings →" CTA banner instead of a
        // generic error, and drop the empty assistant placeholder.
        if (response.status === 412) {
            copilot.setConnectRequired(true);
            copilot.discardAssistantMessage(assistantId);
            copilot.setStreaming(false);
            return;
        }

        if (!response.ok || !response.body) {
            copilot.setError(friendlyHttpError(response.status));
            copilot.finalizeAssistantMessage(assistantId);
            copilot.setStreaming(false);
            return;
        }

        // Request accepted — drop the composer attachments (already mirrored onto
        // the user message and the request body); a failed POST above keeps them.
        copilot.clearPendingImages();

        for await (const frame of streamFrames(response.body)) {
            if (frame.t === "text") {
                copilot.appendAssistantDelta(assistantId, frame.delta);
            } else if (frame.t === "tool_call") {
                const call: ParsedToolCall = { id: frame.id, name: frame.name, args: frame.args };
                collectedToolCalls.push(call);
                copilot.attachToolCall(assistantId, call);
            } else if (frame.t === "end") {
                if (frame.conversationId) copilot.adoptConversationId(localConversationId, frame.conversationId);
            } else if (frame.t === "error") {
                copilot.setError("The Copilot ran into a problem completing that. Please try again.");
            }
        }
    } catch {
        copilot.setError("The connection was interrupted before the Copilot finished. Please try again.");
    }

    copilot.finalizeAssistantMessage(assistantId);
    copilot.setStreaming(false);

    if (collectedToolCalls.length === 0) return;

    copilot.setToolsRunning(true);
    const ctx: ExecutorContext = { messageId: assistantId, requestConfirmation };
    for (const call of collectedToolCalls) {
        await executeToolCall(call, ctx);
    }
    copilot.setToolsRunning(false);
};

export const createNewConversation = (): void => {
    copilot.createNewConversation();
};

/** Fetches the user's D1 conversation summaries and seeds the store. */
export const loadConversations = async (): Promise<void> => {
    try {
        const rows = await api.get<PersistedConversationSummary[]>("/api/copilot/conversations");
        copilot.hydrate(rows);
    } catch {
        // Best-effort hydration; an offline list just leaves the local draft.
    }
};

/** Switches to a conversation, lazily loading its messages from D1 on first open. */
export const switchConversation = async (id: string): Promise<void> => {
    const conv = copilot.conversations.find((c) => c.id === id);
    copilot.switchConversation(id);
    if (!conv || conv.loaded || !conv.persisted) return;
    try {
        const rows = await api.get<PersistedMessage[]>(
            `/api/copilot/messages?conversationId=${encodeURIComponent(id)}`
        );
        copilot.setConversationMessages(id, rows);
    } catch {
        copilot.markLoaded(id);
    }
};

/** Renames a conversation locally, persisting to D1 when it has a server row. */
export const renameConversation = async (id: string, title: string): Promise<void> => {
    const conv = copilot.conversations.find((c) => c.id === id);
    copilot.renameConversation(id, title);
    if (!conv?.persisted) return;
    try {
        await api.patch(`/api/copilot/conversations/${encodeURIComponent(id)}`, { title: title.trim() });
    } catch {
        // Local rename already applied; D1 stays best-effort.
    }
};

/** Deletes a conversation locally and from D1 when it has a server row. */
export const deleteConversation = async (id: string): Promise<void> => {
    const conv = copilot.conversations.find((c) => c.id === id);
    copilot.deleteConversation(id);
    if (!conv?.persisted) return;
    try {
        await api.delete(`/api/copilot/conversations/${encodeURIComponent(id)}`);
    } catch {
        // Local deletion already applied; D1 stays best-effort.
    }
};

/** Resolves a queued confirmation dialog (called by the confirm dialog UI). */
export const respondToConfirmation = (toolCallId: string, approved: boolean): void => {
    const pending = copilot.pendingConfirmations.find((c) => c.toolCallId === toolCallId);
    pending?.resolve(approved);
};

/** Reverts an applied AI action by its undo id (called by tool-card Undo). */
export const undoAction = (undoId: string): void => {
    const entry = copilot.undoStack.find((e) => e.id === undoId);
    if (!entry || entry.undone) return;
    entry.revert();
    copilot.markUndone(entry.id);
};
