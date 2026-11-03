<script lang="ts">
    /**
     * Confirmation modal for Copilot batch mutations — the user-facing half of the
     * gate the executor enforces centrally for any change touching >1 row.
     * Mounted globally (not inside the rail) so it overlays the whole app; it reads
     * `copilot.pendingConfirmations[0]` and answers via `respondToConfirmation`.
     * The executor runs tool calls sequentially, so at most one confirmation is
     * pending at a time — but a single confirmation's `diff` can list many rows
     * (e.g. auto-fix). Escape rejects; reject is focused on mount as the safe default.
     */
    import { tick } from "svelte";
    import { fade, fly } from "svelte/transition";
    import { copilot } from "#lib/stores/copilot.svelte.js";
    import { respondToConfirmation } from "#lib/ai/chat-client.js";
    import { motionDuration, DISTANCE } from "#lib/motion/index.js";
    import { ShieldCheck, Undo2 } from "@lucide/svelte";
    import CopilotAnomalyWarning from "./copilot-anomaly-warning.svelte";

    const pending = $derived(copilot.pendingConfirmations[0] ?? null);

    const onConfirm = () => {
        if (pending) respondToConfirmation(pending.toolCallId, true);
    };
    const onReject = () => {
        if (pending) respondToConfirmation(pending.toolCallId, false);
    };

    const focusOnMount = (node: HTMLElement) => {
        tick().then(() => node.focus());
    };

    const onKeydown = (event: KeyboardEvent) => {
        if (pending && event.key === "Escape") {
            event.preventDefault();
            onReject();
        }
    };
</script>

<svelte:window onkeydown={onKeydown} />

{#if pending}
    <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="copilot-confirm-title"
        transition:fade={{ duration: motionDuration("fast") }}
        class="bg-scrim fixed inset-0 z-[60] flex items-center justify-center p-4 backdrop-blur-[var(--glass-blur-soft)]"
    >
        <div
            transition:fly={{ duration: motionDuration("base"), y: DISTANCE.md }}
            class="bg-chat-bg border-chat-border flex max-h-[85vh] w-[min(30rem,calc(100vw-2rem))] flex-col rounded-2xl border border-solid shadow-[var(--chat-shadow)]"
        >
            <div class="border-chat-border flex items-center gap-2 border-b border-solid px-5 py-4">
                <ShieldCheck class="text-chat-text-primary size-4 shrink-0" aria-hidden="true" />
                <h2 id="copilot-confirm-title" class="text-chat-text-primary text-sm font-medium text-balance">
                    Confirm this change
                </h2>
            </div>

            <div class="chat-scrollbar flex-1 space-y-3 overflow-y-auto px-5 py-4">
                <p class="text-chat-text-secondary text-sm text-pretty">{pending.humanLabel}.</p>

                {#if pending.diff.length > 0}
                    <div
                        class="border-chat-border-subtle bg-chat-surface space-y-2.5 rounded-lg border border-solid p-3"
                    >
                        {#each pending.diff as row, i (i)}
                            <div class="space-y-1">
                                <div class="text-chat-text-muted text-micro tracking-[0.12em] uppercase">
                                    {row.label}
                                </div>
                                <div class="flex items-start gap-2 text-xs">
                                    <span class="text-destructive shrink-0 select-none">−</span>
                                    <span class="text-chat-text-muted min-w-0 break-words line-through">
                                        {row.current}
                                    </span>
                                </div>
                                <div class="flex items-start gap-2 text-xs">
                                    <span class="text-chat-text-primary shrink-0 select-none">+</span>
                                    <span class="text-chat-text-primary min-w-0 font-medium break-words">
                                        {row.proposed}
                                    </span>
                                </div>
                            </div>
                        {/each}
                    </div>
                {/if}

                {#if pending.anomalies.length > 0}
                    <CopilotAnomalyWarning anomalies={pending.anomalies} />
                {/if}

                <p class="text-chat-text-muted text-caption flex items-start gap-1.5 text-pretty">
                    <Undo2 class="mt-px size-3 shrink-0" aria-hidden="true" />
                    <span>{pending.inverseSummary}</span>
                </p>
            </div>

            <div class="border-chat-border flex items-center justify-end gap-2 border-t border-solid px-5 py-4">
                <button
                    type="button"
                    onclick={onReject}
                    use:focusOnMount
                    class="border-hair bg-chat-surface text-chat-text-primary hover:border-signal hover:bg-ink-2 focus-visible:ring-signal text-caption inline-flex h-9 cursor-pointer touch-manipulation items-center rounded-full border px-5 tracking-[0.12em] whitespace-nowrap uppercase transition-colors ease-[var(--ease)] focus:outline-none focus-visible:ring-2"
                >
                    Reject
                </button>
                <button
                    type="button"
                    onclick={onConfirm}
                    class="bg-signal text-background hover:bg-signal/90 focus-visible:ring-signal text-caption inline-flex h-9 cursor-pointer touch-manipulation items-center rounded-full px-5 font-medium tracking-[0.12em] whitespace-nowrap uppercase transition-colors ease-[var(--ease)] focus:outline-none focus-visible:ring-2"
                >
                    Confirm
                </button>
            </div>
        </div>
    </div>
{/if}
