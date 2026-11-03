<script lang="ts">
    import { Button } from "#lib/components/ui/button/index.js";
    import { cn } from "#lib/utils/index.js";
    import { Undo2, Download } from "@lucide/svelte";

    interface Props {
        rowCount: number;
        warningCount: number;
        selectionCount: number;
        showBatchColumns: boolean;
        undoAvailable: boolean;
        undoLabel: string;
        canDownload: boolean;
        onToggleBatchColumns: () => void;
        onJumpToFirstWarning: () => void;
        onBulkDelete: () => void;
        onUndo: () => void;
        onDiscard: () => void;
        onDownload: () => void;
    }

    let {
        rowCount,
        warningCount,
        selectionCount,
        showBatchColumns,
        undoAvailable,
        undoLabel,
        canDownload,
        onToggleBatchColumns,
        onJumpToFirstWarning,
        onBulkDelete,
        onUndo,
        onDiscard,
        onDownload
    }: Props = $props();
</script>

<div
    class="border-hair bg-card/90 sticky bottom-0 z-30 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-solid p-3 backdrop-blur"
>
    <div class="flex flex-wrap items-center gap-2 text-sm">
        <span
            class="border-hair bg-background text-foreground inline-flex min-h-11 items-center rounded-full border border-solid px-3.5 text-xs whitespace-nowrap tabular-nums sm:min-h-9"
            aria-live="polite"
        >
            {rowCount}
            <span class="text-ink-muted ml-1 tracking-[0.1em] uppercase">{rowCount === 1 ? "order" : "orders"}</span>
        </span>

        {#if warningCount > 0}
            <button
                type="button"
                onclick={onJumpToFirstWarning}
                class="text-destructive border-destructive/40 hover:bg-destructive/10 focus-visible:ring-destructive/40 inline-flex min-h-11 cursor-pointer touch-manipulation items-center gap-1.5 rounded-full border border-solid px-3.5 text-xs whitespace-nowrap tabular-nums transition-colors focus:outline-none focus-visible:ring-2 sm:min-h-9"
                aria-label="{warningCount} warning{warningCount === 1 ? '' : 's'} — jump to first"
            >
                <span aria-hidden="true">⚠</span>
                {warningCount}
                <span class="tracking-[0.1em] uppercase opacity-80">{warningCount === 1 ? "warning" : "warnings"}</span>
            </button>
        {/if}

        <button
            type="button"
            onclick={onToggleBatchColumns}
            aria-pressed={showBatchColumns}
            class={cn(
                "text-caption inline-flex min-h-11 cursor-pointer touch-manipulation items-center rounded-full border border-solid px-3.5  tracking-[0.1em] whitespace-nowrap uppercase sm:min-h-9",
                "focus-visible:ring-ring transition-colors ease-[var(--ease)] focus:outline-none focus-visible:ring-2",
                showBatchColumns
                    ? "border-signal bg-ink-2 text-foreground"
                    : "border-hair text-ink-muted hover:text-foreground hover:border-white/30"
            )}
        >
            {showBatchColumns ? "Hide batch columns" : "Show batch columns"}
        </button>

        {#if selectionCount > 0}
            <Button
                variant="destructive"
                size="lg"
                onclick={onBulkDelete}
                class="min-h-11 touch-manipulation rounded-full  text-xs tracking-[0.06em] uppercase sm:min-h-9"
            >
                Delete {selectionCount} selected
            </Button>
        {/if}

        {#if undoAvailable}
            <button
                type="button"
                onclick={onUndo}
                class="text-ink-muted border-hair hover:bg-ink-2 hover:text-foreground focus-visible:ring-ring text-caption inline-flex min-h-11 cursor-pointer touch-manipulation items-center gap-2 rounded-full border border-solid px-3.5 tracking-[0.1em] whitespace-nowrap uppercase transition-colors ease-[var(--ease)] focus:outline-none focus-visible:ring-2 sm:min-h-9"
                aria-label="Undo {undoLabel}"
            >
                <Undo2 class="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
                Undo
                <span class="text-foreground/70 normal-case">{undoLabel}</span>
            </button>
        {/if}
    </div>

    <div class="flex w-full items-center gap-2 max-lg:pe-16 sm:w-auto">
        <button
            type="button"
            onclick={onDiscard}
            class={cn(
                "border-hair text-foreground hover:border-signal hover:bg-ink-2 focus-visible:outline-signal text-label inline-flex min-h-11 flex-1 cursor-pointer touch-manipulation items-center justify-center rounded-full border border-solid px-5  whitespace-nowrap uppercase sm:min-h-9 sm:flex-none",
                "transition-[background,color,border-color] duration-[450ms] ease-[var(--ease)] focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-[3px]"
            )}
        >
            Discard
        </button>
        <button
            type="button"
            onclick={onDownload}
            disabled={!canDownload}
            class={cn(
                "bg-signal text-background text-label inline-flex min-h-11 flex-1 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-full px-6  font-medium whitespace-nowrap uppercase sm:min-h-9 sm:flex-none",
                "hover:bg-signal/90 focus-visible:outline-signal focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-[3px]",
                "transition-[background,color] duration-[450ms] ease-[var(--ease)] disabled:cursor-not-allowed disabled:opacity-50"
            )}
        >
            <Download class="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            Download .xlsx
        </button>
    </div>
</div>
