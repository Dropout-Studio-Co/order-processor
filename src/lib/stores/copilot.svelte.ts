/**
 * Closure-based runes store (project pattern; see brand-settings.svelte.ts).
 *
 * D1-BACKED — conversations + messages persist server-side and survive reloads.
 * The store holds the working set; chat-client.ts owns the network calls
 * (create/list/load/rename/delete) and feeds results back through these
 * mutators. A conversation starts local (`persisted: false`); the server mints
 * its real id on the first turn and the client adopts it via adoptConversationId.
 *
 * undoStack is SEPARATE from output-editor's native Cmd+Z. Each AI mutation
 * snapshots full editor state via EditorController.snapshot(); revert restores
 * the snapshot, which also reverts any manual edits made since (intentional —
 * see CLAUDE.md warning #18). Bounded by MAX_UNDO to cap memory.
 */
import { titleFromMessage } from "#lib/ai/prompts.js";
import { MAX_IMAGES } from "#lib/ai/image-limits.js";
import type {
    AiUndoEntry,
    Conversation,
    CopilotMessage,
    CopilotToolCall,
    ParsedToolCall,
    PendingConfirmation,
    PersistedConversationSummary,
    PersistedMessage
} from "#lib/ai/types.js";

const MAX_UNDO = 25;

const newConversation = (): Conversation => ({
    id: crypto.randomUUID(),
    title: "New chat",
    createdAt: new Date().toISOString(),
    messages: [],
    persisted: false,
    loaded: true
});

const toCopilotMessage = (row: PersistedMessage): CopilotMessage => ({
    id: row.id,
    role: row.role,
    content: row.content,
    toolCalls: (row.toolCalls ?? []).map((tc) => ({
        id: tc.id,
        name: tc.name,
        args: tc.args,
        status: "applied",
        summary: null,
        error: null,
        anomalies: [],
        undoId: null,
        undone: false
    })),
    createdAt: row.createdAt,
    streaming: false
});

const createCopilotStore = () => {
    let conversations = $state<Conversation[]>([newConversation()]);
    let activeConversationId = $state<string>(conversations[0]?.id ?? "");
    let streaming = $state(false);
    let toolsRunning = $state(false);
    let error = $state<string | null>(null);
    // True when the chat endpoint returned 412 (no BYO Cloudflare account
    // connected). Drives the "Connect your Cloudflare account in Settings →" CTA
    // banner instead of a generic error.
    let connectRequired = $state(false);
    let pendingConfirmations = $state<PendingConfirmation[]>([]);
    let undoStack = $state<AiUndoEntry[]>([]);
    let railOpen = $state(false);
    let mobileOpen = $state(false);
    let desktopOpen = $state(false);
    let inputFocusNonce = $state(0);
    let pendingImages = $state<string[]>([]);
    const MAX_PENDING_IMAGES = MAX_IMAGES;

    // Defensive: should always find one, but recovers if state was somehow nuked.
    const active = (): Conversation => {
        const found = conversations.find((c) => c.id === activeConversationId);
        if (found) return found;
        const conv = newConversation();
        conversations = [conv];
        activeConversationId = conv.id;
        return conv;
    };

    const findMessage = (id: string): CopilotMessage | undefined => active().messages.find((m) => m.id === id);

    return {
        get conversations() {
            return conversations;
        },
        get activeConversationId() {
            return activeConversationId;
        },
        get activeConversation() {
            return active();
        },
        get messages() {
            return active().messages;
        },
        get streaming() {
            return streaming;
        },
        // Disables the composer while the model streams OR tool calls run.
        get inputBusy() {
            return streaming || toolsRunning;
        },
        get error() {
            return error;
        },
        get connectRequired() {
            return connectRequired;
        },
        get pendingConfirmations() {
            return pendingConfirmations;
        },
        get undoStack() {
            return undoStack;
        },
        get canUndo() {
            return undoStack.some((e) => !e.undone);
        },
        get railOpen() {
            return railOpen;
        },
        get mobileOpen() {
            return mobileOpen;
        },
        get desktopOpen() {
            return desktopOpen;
        },
        get inputFocusNonce() {
            return inputFocusNonce;
        },
        get pendingImages() {
            return pendingImages;
        },
        get maxPendingImages() {
            return MAX_PENDING_IMAGES;
        },

        setStreaming(v: boolean) {
            streaming = v;
        },
        setToolsRunning(v: boolean) {
            toolsRunning = v;
        },
        setError(msg: string | null) {
            error = msg;
        },
        setConnectRequired(v: boolean) {
            connectRequired = v;
        },
        toggleRail() {
            railOpen = !railOpen;
        },
        closeRail() {
            railOpen = false;
        },
        setMobileOpen(v: boolean) {
            mobileOpen = v;
        },
        // Desktop rail visibility (lg+). Separate from `railOpen` (the in-rail
        // history sub-panel) and `mobileOpen` (the <lg sheet). Default closed; not persisted.
        openDesktop() {
            desktopOpen = true;
        },
        closeDesktop() {
            desktopOpen = false;
        },
        toggleDesktop() {
            desktopOpen = !desktopOpen;
        },
        requestInputFocus() {
            inputFocusNonce++;
        },
        /** Pending vision attachments for the next turn (max {@link MAX_PENDING_IMAGES}). */
        addPendingImage(dataUrl: string) {
            if (pendingImages.length >= MAX_PENDING_IMAGES) return;
            pendingImages = [...pendingImages, dataUrl];
        },
        removePendingImage(index: number) {
            pendingImages = pendingImages.filter((_, i) => i !== index);
        },
        clearPendingImages() {
            pendingImages = [];
        },

        // Seeds the conversation list from D1 (summaries only — messages load
        // lazily on switch). Keeps the current local draft at the top so an
        // in-progress new chat is never discarded by hydration.
        hydrate(summaries: PersistedConversationSummary[]) {
            const draft = active();
            const persisted = summaries.map<Conversation>((s) => ({
                id: s.id,
                title: s.title,
                createdAt: s.createdAt,
                updatedAt: s.updatedAt,
                messages: [],
                persisted: true,
                loaded: false
            }));
            const keepDraft = draft.messages.length === 0 && !draft.persisted;
            conversations = keepDraft ? [draft, ...persisted] : persisted.length > 0 ? persisted : [newConversation()];
            if (!conversations.some((c) => c.id === activeConversationId)) {
                activeConversationId = conversations[0]?.id ?? "";
            }
        },

        // Replaces an active local conversation's id with the server-minted one
        // once the first turn is persisted, so subsequent turns reuse the row.
        adoptConversationId(localId: string, serverId: string) {
            const conv = conversations.find((c) => c.id === localId);
            if (!conv || conv.id === serverId) return;
            const existing = conversations.find((c) => c.id === serverId);
            if (existing) {
                // Server row already in the list (e.g. from hydration) — drop the
                // local draft and point the active id at the canonical row.
                conv.persisted = true;
                conversations = conversations.filter((c) => c.id !== localId);
                if (activeConversationId === localId) activeConversationId = serverId;
                return;
            }
            conv.id = serverId;
            conv.persisted = true;
            conv.loaded = true;
            if (activeConversationId === localId) activeConversationId = serverId;
        },

        setConversationMessages(id: string, rows: PersistedMessage[]) {
            const conv = conversations.find((c) => c.id === id);
            if (!conv) return;
            conv.messages = rows.map(toCopilotMessage);
            conv.loaded = true;
        },

        markLoaded(id: string) {
            const conv = conversations.find((c) => c.id === id);
            if (conv) conv.loaded = true;
        },

        appendUserMessage(id: string, content: string, images?: string[]) {
            const conv = active();
            const msg: CopilotMessage = {
                id,
                role: "user",
                content,
                toolCalls: [],
                createdAt: new Date().toISOString(),
                streaming: false
            };
            if (images && images.length > 0) msg.images = images;
            conv.messages.push(msg);
            if (conv.messages.filter((m) => m.role === "user").length === 1) {
                conv.title = titleFromMessage(content);
            }
        },

        startAssistantMessage(id: string) {
            active().messages.push({
                id,
                role: "assistant",
                content: "",
                toolCalls: [],
                createdAt: new Date().toISOString(),
                streaming: true
            });
        },

        appendAssistantDelta(id: string, delta: string) {
            const m = findMessage(id);
            if (m) m.content += delta;
        },

        finalizeAssistantMessage(id: string) {
            const m = findMessage(id);
            if (m) m.streaming = false;
        },

        /** Removes an in-progress assistant placeholder (e.g. when the turn was rejected before any text). */
        discardAssistantMessage(id: string) {
            const conv = active();
            conv.messages = conv.messages.filter((m) => m.id !== id);
        },

        attachToolCall(messageId: string, call: ParsedToolCall) {
            const m = findMessage(messageId);
            if (!m) return;
            m.toolCalls.push({
                id: call.id,
                name: call.name,
                args: call.args,
                status: "pending",
                summary: null,
                error: null,
                anomalies: [],
                undoId: null,
                undone: false
            });
        },

        updateToolCall(messageId: string, toolCallId: string, patch: Partial<CopilotToolCall>) {
            const tc = findMessage(messageId)?.toolCalls.find((t) => t.id === toolCallId);
            if (tc) Object.assign(tc, patch);
        },

        enqueueConfirmation(req: PendingConfirmation) {
            pendingConfirmations = [...pendingConfirmations, req];
        },
        dequeueConfirmation(toolCallId: string) {
            pendingConfirmations = pendingConfirmations.filter((c) => c.toolCallId !== toolCallId);
        },

        pushUndo(entry: AiUndoEntry) {
            undoStack = [...undoStack, entry].slice(-MAX_UNDO);
        },
        // LIFO scan: returns the most recent not-yet-undone entry.
        peekUndo(): AiUndoEntry | null {
            for (let i = undoStack.length - 1; i >= 0; i--) {
                const e = undoStack[i];
                if (e && !e.undone) return e;
            }
            return null;
        },
        markUndone(undoId: string) {
            const entry = undoStack.find((e) => e.id === undoId);
            if (entry) entry.undone = true;
            for (const conv of conversations) {
                for (const m of conv.messages) {
                    for (const tc of m.toolCalls) {
                        if (tc.undoId === undoId) tc.undone = true;
                    }
                }
            }
        },

        createNewConversation() {
            const conv = newConversation();
            conversations = [conv, ...conversations];
            activeConversationId = conv.id;
            error = null;
            connectRequired = false;
            railOpen = false;
            inputFocusNonce++;
        },
        switchConversation(id: string) {
            if (conversations.some((c) => c.id === id)) {
                activeConversationId = id;
                railOpen = false;
            }
        },
        renameConversation(id: string, title: string) {
            const c = conversations.find((x) => x.id === id);
            if (c && title.trim()) c.title = title.trim();
        },
        deleteConversation(id: string) {
            conversations = conversations.filter((c) => c.id !== id);
            if (conversations.length === 0) conversations = [newConversation()];
            if (!conversations.some((c) => c.id === activeConversationId)) {
                activeConversationId = conversations[0]?.id ?? "";
            }
        }
    };
};

export const copilot = createCopilotStore();
