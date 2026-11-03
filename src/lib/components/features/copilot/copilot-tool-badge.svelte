<script lang="ts">
    /**
     * A single tool-call card inside an assistant message (child of copilot-message).
     * Reflects the call's live status from the store and, for an applied mutation,
     * offers Undo. The Undo button calls `undoAction(call.undoId)` which pops the
     * Copilot's *own* undo stack (warning #18) — distinct from the editor's native
     * Cmd+Z; reverting also rolls back any manual edits made since. Read-only tools
     * have no `undoId`, so `canUndo` hides the button for them.
     */
    import type { CopilotToolCall, ToolName } from "#lib/ai/types.js";
    import { TOOL_LABELS } from "#lib/ai/tools-catalog.js";
    import { undoAction } from "#lib/ai/chat-client.js";
    import { CheckCircle2, CircleX, Loader2, ShieldAlert, Undo2 } from "@lucide/svelte";
    import { cn } from "#lib/utils/index.js";
    import CopilotAnomalyWarning from "./copilot-anomaly-warning.svelte";

    let { call }: { call: CopilotToolCall } = $props();

    const label = $derived(TOOL_LABELS[call.name as ToolName] ?? "Action");

    const statusLabel = $derived.by(() => {
        switch (call.status) {
            case "applied":
                return call.undone ? "Undone" : "Applied";
            case "rejected":
                return "Rejected";
            case "failed":
                return "Failed";
            case "pending_confirmation":
                return "Awaiting confirmation";
            default:
                return "Working…";
        }
    });

    const statusClasses = $derived.by(() => {
        if (call.undone) return "border-chat-border-subtle bg-chat-surface text-chat-text-muted";
        switch (call.status) {
            case "applied":
                return "border-courier-accent/30 bg-courier-accent/10 text-courier-accent";
            case "rejected":
                return "border-chat-border-subtle bg-chat-surface text-chat-text-muted";
            case "failed":
                return "border-status-error-border bg-status-error-bg text-status-error-fg";
            case "pending_confirmation":
                return "border-status-warn-border bg-status-warn-bg text-status-warn-fg";
            default:
                return "border-chat-border-subtle bg-chat-surface text-chat-text-secondary";
        }
    });

    const canUndo = $derived(call.status === "applied" && !call.undone && !!call.undoId);
    let undoing = $state(false);

    const onUndo = () => {
        if (!call.undoId || undoing) return;
        undoing = true;
        undoAction(call.undoId);
        undoing = false;
    };
</script>

<div class="chat-message-enter flex w-full flex-col gap-1.5">
    <div
        class={cn(
            "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-solid px-2.5 py-2 text-xs",
            statusClasses
        )}
    >
        <span class="flex size-4 shrink-0 items-center justify-center">
            {#if call.status === "pending" || call.status === "pending_confirmation"}
                <Loader2 class="size-3.5 animate-spin" aria-hidden="true" />
            {:else if call.status === "applied" && !call.undone}
                <CheckCircle2 class="size-3.5" aria-hidden="true" />
            {:else if call.status === "failed"}
                <CircleX class="size-3.5" aria-hidden="true" />
            {:else}
                <ShieldAlert class="size-3.5" aria-hidden="true" />
            {/if}
        </span>
        <span class="font-medium break-words">{label}</span>
        <span class="tabular-nums">· {statusLabel}</span>
        {#if canUndo}
            <button
                type="button"
                onclick={onUndo}
                disabled={undoing}
                class={cn(
                    "border-chat-border bg-chat-surface text-chat-text-secondary hover:text-chat-text-primary hover:bg-chat-surface-hover ml-auto inline-flex touch-manipulation items-center gap-1 rounded-md border border-solid px-2 py-1 font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                    undoing && "cursor-wait"
                )}
            >
                <Undo2 class="size-3" aria-hidden="true" />
                Undo
            </button>
        {/if}
        {#if call.summary}
            <span class="w-full text-pretty">{call.summary}</span>
        {/if}
        {#if call.error}
            <span class="w-full break-words">{call.error}</span>
        {/if}
    </div>
    {#if call.anomalies.length > 0}
        <CopilotAnomalyWarning anomalies={call.anomalies} />
    {/if}
</div>
