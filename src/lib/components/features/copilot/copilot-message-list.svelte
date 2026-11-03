<script lang="ts">
    /**
     * Scrollable message transcript (child of copilot-sidebar, rendered only once
     * a chat has messages). Auto-pins to the bottom as content streams in, but
     * backs off the moment the user scrolls up so reading history is not yanked
     * away — `userScrolledUp` latches that intent and the autoscroll `$effect`
     * short-circuits on it. The `<svelte:boundary>` isolates a markdown/render
     * fault to this panel so one bad message can't blank the whole rail.
     */
    import type { CopilotMessage as CopilotMessageType } from "#lib/ai/types.js";
    import CopilotMessage from "./copilot-message.svelte";
    import CopilotTypingIndicator from "./copilot-typing-indicator.svelte";

    let {
        messages,
        isStreaming
    }: {
        messages: CopilotMessageType[];
        isStreaming: boolean;
    } = $props();

    let scrollContainer = $state<HTMLDivElement | null>(null);
    let userScrolledUp = $state(false);

    const last = $derived(messages.at(-1));
    const lastContent = $derived(last?.content ?? "");

    // Only show the standalone indicator before the assistant bubble exists; once
    // the streaming assistant message lands it renders its own in-bubble wave.
    const showTypingIndicator = $derived(isStreaming && !!last && last.role === "user");

    const isPinnedToBottom = (): boolean => {
        if (!scrollContainer) return true;
        const slack = 24;
        return scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight <= slack;
    };

    const handleScroll = () => {
        if (!scrollContainer) return;
        userScrolledUp = !isPinnedToBottom();
    };

    $effect(() => {
        // Touch every signal that grows the transcript so the effect re-runs and
        // re-pins on new messages, streamed token deltas, and the typing indicator.
        void messages.length;
        void lastContent;
        void showTypingIndicator;
        if (!scrollContainer) return;
        if (userScrolledUp) return;
        requestAnimationFrame(() => {
            if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
        });
    });
</script>

<div
    bind:this={scrollContainer}
    onscroll={handleScroll}
    class="chat-scrollbar flex-1 overflow-y-auto px-4 py-4"
    aria-live="polite"
    aria-relevant="additions"
>
    <svelte:boundary>
        {#each messages as message (message.id)}
            <CopilotMessage {message} />
        {/each}
        {#snippet failed(_error, reset)}
            <div class="chat-message-enter flex flex-col items-center gap-2 py-6 text-center" role="alert">
                <p class="text-destructive text-sm font-medium">The chat hit a display error.</p>
                <p class="text-chat-text-muted max-w-xs text-xs text-pretty">
                    Something went wrong showing this conversation. Retry to reload it.
                </p>
                <button
                    type="button"
                    onclick={reset}
                    class="border-hair bg-chat-surface text-chat-text-primary hover:border-signal hover:bg-ink-2 text-caption mt-1 touch-manipulation rounded-full border px-4 py-1.5 tracking-[0.12em] whitespace-nowrap uppercase transition-colors ease-[var(--ease)]"
                >
                    Retry
                </button>
            </div>
        {/snippet}
    </svelte:boundary>
    {#if showTypingIndicator}
        <CopilotTypingIndicator />
    {/if}
</div>
