<script lang="ts">
    /**
     * Entry for the Copilot chat rail — composes the whole chat shell (header,
     * conversations panel, welcome/message-list, composer) and owns the only
     * mutable UI state the shell needs (the in-progress composer text; pending
     * image attachments live on the `copilot` store).
     * Everything else reads from the `copilot` store; sends/new-conversation go
     * through `chat-client`. The server never sees this state — it ships the full
     * history each turn (warning #23) and tool calls run client-side (#17).
     *
     * `bare` drops the rounded border/shadow so the mobile sheet can mount the
     * same shell edge-to-edge; `onClose` is wired only when there is a chrome to
     * close (mobile sheet) and stays undefined for the docked desktop rail.
     */
    import { copilot } from "#lib/stores/copilot.svelte.js";
    import { sendMessage, createNewConversation } from "#lib/ai/chat-client.js";
    import { cn } from "#lib/utils/index.js";
    import { Cloud, ArrowRight } from "@lucide/svelte";
    import CopilotHeader from "./copilot-header.svelte";
    import CopilotWelcome from "./copilot-welcome.svelte";
    import CopilotMessageList from "./copilot-message-list.svelte";
    import CopilotComposer from "./copilot-composer.svelte";
    import CopilotConversationsPanel from "./copilot-conversations-panel.svelte";

    let { bare = false, onClose }: { bare?: boolean; onClose?: () => void } = $props();

    let composerValue = $state("");

    // Collapse the store's flags into the header's single status pill: a live
    // error (or a required Cloudflare connection) wins over an in-flight turn,
    // which wins over idle.
    const status = $derived<"online" | "connecting" | "error">(
        copilot.error || copilot.connectRequired ? "error" : copilot.inputBusy ? "connecting" : "online"
    );

    const handleSuggestion = (text: string) => {
        composerValue = text;
        copilot.requestInputFocus();
    };

    const handleSend = (text: string) => {
        void sendMessage(text);
    };

    const handleNewConversation = () => {
        createNewConversation();
        composerValue = "";
        copilot.clearPendingImages();
    };

    const handleToggleHistory = () => {
        copilot.toggleRail();
    };
</script>

<section
    class={cn(
        "bg-chat-bg flex h-full min-h-[30rem] flex-col overflow-hidden",
        !bare && "border-chat-border rounded-2xl border border-solid shadow-[var(--chat-shadow)]"
    )}
    aria-label="AI chat"
>
    <CopilotHeader
        {onClose}
        onNewConversation={handleNewConversation}
        onToggleHistory={handleToggleHistory}
        hasMessages={copilot.messages.length > 0}
        historyOpen={copilot.railOpen}
        historyCount={copilot.conversations.length}
        {status}
    />

    {#if copilot.railOpen}
        <div class="border-chat-border-subtle border-b border-solid px-3 py-3 md:px-4">
            <CopilotConversationsPanel />
        </div>
    {/if}

    {#if copilot.messages.length === 0}
        <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <CopilotWelcome onSuggestionClick={handleSuggestion} />
        </div>
    {:else}
        <CopilotMessageList messages={copilot.messages} isStreaming={copilot.inputBusy} />
    {/if}

    {#if copilot.connectRequired}
        <div class="border-chat-border-subtle border-t border-solid px-4 py-3" role="alert">
            <div class="border-chat-border bg-chat-surface flex items-start gap-3 rounded-xl border p-3">
                <span
                    class="border-chat-border bg-chat-bg flex size-7 shrink-0 items-center justify-center rounded-lg border"
                >
                    <Cloud class="text-chat-icon-muted size-3.5" aria-hidden="true" />
                </span>
                <div class="flex min-w-0 flex-col gap-2">
                    <p class="text-chat-text-primary text-xs leading-relaxed text-pretty">
                        Connect your Cloudflare account to use the Copilot — it runs on your own Cloudflare account.
                    </p>
                    <a
                        href="/settings"
                        class="text-chat-accent hover:text-chat-text-primary text-caption inline-flex w-fit touch-manipulation items-center gap-1.5 tracking-[0.04em] whitespace-nowrap uppercase transition-colors ease-[var(--ease)]"
                    >
                        Connect in Settings
                        <ArrowRight class="size-3" aria-hidden="true" />
                    </a>
                </div>
            </div>
        </div>
    {:else if copilot.error}
        <div class="text-destructive px-4 py-2 text-center text-xs text-pretty" role="alert">{copilot.error}</div>
    {/if}

    <CopilotComposer
        bind:value={composerValue}
        disabled={copilot.inputBusy}
        focusNonce={copilot.inputFocusNonce}
        onSend={handleSend}
    />
</section>
