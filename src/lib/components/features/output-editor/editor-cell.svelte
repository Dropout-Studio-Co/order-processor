<script lang="ts">
    import { scale } from "svelte/transition";
    import { cn } from "$lib/utils";
    import { motionDuration } from "$lib/motion";
    import type { CellColumn, ColumnInputMode } from "./columns";

    export type CellNavigationDirection = "up" | "down" | "left" | "right" | "next" | "previous";

    interface Props {
        value: string;
        column: CellColumn;
        inputmode: ColumnInputMode;
        multiline: boolean;
        rowIndex: number;
        warning?: string | null;
        isOverride?: boolean;
        isSelected?: boolean;
        onCommit: (newValue: string) => void;
        onNavigate?: (direction: CellNavigationDirection) => void;
    }

    let {
        value,
        column,
        inputmode,
        multiline,
        rowIndex,
        warning = null,
        isOverride = false,
        isSelected = false,
        onCommit,
        onNavigate
    }: Props = $props();

    let isEditing = $state(false);
    let draft = $state<string>("");
    let cellRef = $state<HTMLDivElement | null>(null);
    let inputRef = $state<HTMLInputElement | HTMLTextAreaElement | null>(null);

    /**
     * FR-4: resolve caret offset under the click point so editing starts
     * where the user pointed. MUST run before isEditing flips — the display
     * span needs to still be mounted to read its caret position.
     * Returns null when neither caret API is exposed.
     */
    const caretOffsetFromPoint = (x: number, y: number): number | null => {
        type CaretDoc = Document & {
            caretPositionFromPoint?: (x: number, y: number) => { offset: number } | null;
            caretRangeFromPoint?: (x: number, y: number) => Range | null;
        };
        const doc = document as CaretDoc;
        if (typeof doc.caretPositionFromPoint === "function") {
            return doc.caretPositionFromPoint(x, y)?.offset ?? null;
        }
        if (typeof doc.caretRangeFromPoint === "function") {
            return doc.caretRangeFromPoint(x, y)?.startOffset ?? null;
        }
        return null;
    };

    /** FR-8 expand-on-focus: grow textarea to fit content (no scrollbars until max-h hits). */
    const autoGrow = (el: HTMLTextAreaElement) => {
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
    };

    // microtask defers until the input/textarea is mounted by the {#if} branch.
    const focusEditor = (caret: number | "end") => {
        queueMicrotask(() => {
            const el = inputRef;
            if (!el) return;
            el.focus();
            const end = el.value.length;
            const pos = caret === "end" ? end : Math.min(Math.max(caret, 0), end);
            el.setSelectionRange(pos, pos);
            if (multiline) autoGrow(el as HTMLTextAreaElement);
        });
    };

    // FR-4: text columns honour the click caret; tel/decimal always start at end.
    const enterEditMode = (caret: number | "end") => {
        draft = value;
        isEditing = true;
        focusEditor(caret);
    };

    const handleCellClick = (event: MouseEvent) => {
        if (isEditing) return;
        if (inputmode === "text" && value) {
            enterEditMode(caretOffsetFromPoint(event.clientX, event.clientY) ?? "end");
        } else {
            enterEditMode("end");
        }
    };

    const commit = () => {
        if (!isEditing) return;
        isEditing = false;
        if (draft !== value) {
            onCommit(draft);
        }
        // Return focus to the cell wrapper so arrow-key navigation resumes.
        queueMicrotask(() => cellRef?.focus());
    };

    const revert = () => {
        if (!isEditing) return;
        draft = value;
        isEditing = false;
        queueMicrotask(() => cellRef?.focus());
    };

    const handleCellKeydown = (event: KeyboardEvent) => {
        if (isEditing) return;

        switch (event.key) {
            case "Enter":
            case "F2":
                event.preventDefault();
                enterEditMode("end");
                return;
            case "ArrowUp":
                event.preventDefault();
                onNavigate?.("up");
                return;
            case "ArrowDown":
                event.preventDefault();
                onNavigate?.("down");
                return;
            case "ArrowLeft":
                event.preventDefault();
                onNavigate?.("left");
                return;
            case "ArrowRight":
                event.preventDefault();
                onNavigate?.("right");
                return;
            case "Tab":
                event.preventDefault();
                onNavigate?.(event.shiftKey ? "previous" : "next");
                return;
        }

        // Type-to-edit: any printable char enters edit mode seeded with that char.
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
            event.preventDefault();
            draft = event.key;
            isEditing = true;
            focusEditor("end");
        }
    };

    const handleInputKeydown = (event: KeyboardEvent) => {
        switch (event.key) {
            case "Enter":
                // FR-5: Enter commits even in textarea. SteadFast cells are
                // single logical values; textarea is layout-only — no newlines.
                event.preventDefault();
                event.stopPropagation();
                commit();
                onNavigate?.("down");
                return;
            case "Escape":
                event.preventDefault();
                event.stopPropagation();
                revert();
                return;
            case "Tab":
                event.preventDefault();
                event.stopPropagation();
                commit();
                onNavigate?.(event.shiftKey ? "previous" : "next");
                return;
        }
    };

    /**
     * FR-8: gate decimal cells at `beforeinput` so non-digits / extra dots
     * never enter the DOM. Cancelling here keeps the caret stable; cancelling
     * at `input` would re-trigger after the value already mutated.
     */
    const handleBeforeInput = (event: InputEvent) => {
        if (inputmode !== "decimal") return;
        const data = event.data;
        if (!data) return; // null data = deletion or IME composition end — always pass.
        if (!/^[0-9.]*$/.test(data)) {
            event.preventDefault();
            return;
        }
        if (data.includes(".")) {
            const el = event.currentTarget as HTMLInputElement;
            const start = el.selectionStart ?? el.value.length;
            const end = el.selectionEnd ?? el.value.length;
            const resulting = el.value.slice(0, start) + data + el.value.slice(end);
            if ((resulting.match(/\./g)?.length ?? 0) > 1) {
                event.preventDefault();
            }
        }
    };

    const handleTextareaInput = (event: Event) => {
        autoGrow(event.currentTarget as HTMLTextAreaElement);
    };
</script>

<div
    bind:this={cellRef}
    role="button"
    tabindex={isEditing ? -1 : 0}
    data-cell="{rowIndex}:{column}"
    data-row={rowIndex}
    data-column={column}
    aria-label="{column}, row {rowIndex + 1}, {value || 'empty'}"
    aria-describedby={warning ? `cell-warn-${rowIndex}-${column}` : undefined}
    onkeydown={handleCellKeydown}
    onclick={handleCellClick}
    class={cn(
        "ring-offset-background focus-visible:ring-ring group relative min-h-11 min-w-[10rem] cursor-text px-3 text-base focus:outline-none focus-visible:z-10 focus-visible:ring-2 sm:min-h-10",
        "flex items-center transition-colors",
        isSelected && "bg-ink-2/50",
        warning && "ring-destructive/60 ring-1 ring-inset",
        isOverride &&
            "before:bg-signal/80 before:absolute before:top-1 before:bottom-1 before:left-0 before:w-[2px] before:rounded-r"
    )}
>
    {#if isEditing}
        {#if multiline}
            <textarea
                bind:this={inputRef}
                bind:value={draft}
                name="cell-{column}-row-{rowIndex + 1}"
                {inputmode}
                rows="1"
                autocomplete="off"
                spellcheck="false"
                onblur={commit}
                onkeydown={handleInputKeydown}
                oninput={handleTextareaInput}
                class="text-foreground block max-h-[40vh] w-full resize-none overflow-y-auto border-0 bg-transparent p-0 text-base leading-snug outline-none focus:ring-0"
                aria-label="Editing {column}, row {rowIndex + 1}"></textarea>
        {:else}
            <input
                bind:this={inputRef}
                bind:value={draft}
                name="cell-{column}-row-{rowIndex + 1}"
                {inputmode}
                type="text"
                autocomplete="off"
                spellcheck="false"
                onblur={commit}
                onbeforeinput={handleBeforeInput}
                onkeydown={handleInputKeydown}
                class="text-foreground block h-full w-full border-0 bg-transparent p-0 text-base outline-none focus:ring-0"
                aria-label="Editing {column}, row {rowIndex + 1}"
            />
        {/if}
    {:else}
        <span class={cn("block w-full truncate tabular-nums", value ? "text-foreground/90" : "text-ink-muted italic")}>
            {value || "—"}
        </span>
        {#if warning}
            <span
                id="cell-warn-{rowIndex}-{column}"
                transition:scale={{ duration: motionDuration("fast"), start: 0.6 }}
                class="text-destructive pointer-events-none absolute top-0.5 right-1 text-xs leading-none"
                aria-hidden="true">⚠</span
            >
        {/if}
    {/if}
</div>
