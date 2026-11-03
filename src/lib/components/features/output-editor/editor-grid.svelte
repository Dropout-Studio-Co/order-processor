<script lang="ts">
    import { onMount } from "svelte";
    import { Plus } from "@lucide/svelte";
    import type { SteadFastOrder } from "#lib/types/index.js";
    import { Table } from "#lib/components/ui/index.js";
    import { cn } from "#lib/utils/index.js";
    import EditorRow from "./editor-row.svelte";
    import type { CellNavigationDirection } from "./editor-cell.svelte";
    import { PER_ROW_COLUMNS, STEADFAST_COLUMNS, type CellColumn, type BatchDefaults } from "./columns";

    // Singleton sentinel handed to rows with no warnings — avoids allocating an empty Map per render.
    const EMPTY_WARNING_MAP: ReadonlyMap<CellColumn, string> = new Map();

    interface Props {
        rows: SteadFastOrder[];
        rowIds: string[];
        batchDefaults: BatchDefaults;
        showBatchColumns: boolean;
        selection: ReadonlySet<number>;
        warningsByRow: ReadonlyMap<number, ReadonlyMap<CellColumn, string>>;
        onCellCommit: (rowIndex: number, column: CellColumn, value: string) => void;
        onToggleSelect: (rowIndex: number, event: MouseEvent) => void;
        onDeleteRow: (rowIndex: number) => void;
        onDuplicateRow: (rowIndex: number) => void;
        onAddRow: () => void;
    }

    let {
        rows,
        rowIds,
        batchDefaults,
        showBatchColumns,
        selection,
        warningsByRow,
        onCellCommit,
        onToggleSelect,
        onDeleteRow,
        onDuplicateRow,
        onAddRow
    }: Props = $props();

    let gridRef = $state<HTMLDivElement | null>(null);

    // Gate row entry transitions so the initial mount is instant and only
    // user-driven row inserts animate (UX §Motion in PRD).
    let mounted = $state(false);
    onMount(() => {
        mounted = true;
    });

    const visibleColumns = $derived(showBatchColumns ? STEADFAST_COLUMNS : PER_ROW_COLUMNS);
    const visibleColumnKeys = $derived(visibleColumns.map((c) => c.key));

    /**
     * Map (source cell, direction) → target cell or null (out-of-bounds noop).
     * Arrow keys stay in their row/column; Tab/Shift+Tab wraps to next/prev row.
     */
    const resolveNavigationTarget = (
        rowIndex: number,
        column: CellColumn,
        direction: CellNavigationDirection
    ): { row: number; column: CellColumn } | null => {
        const columnIndex = visibleColumnKeys.indexOf(column);
        if (columnIndex === -1) return null;

        switch (direction) {
            case "left": {
                const next = columnIndex - 1;
                if (next < 0) return null;
                const col = visibleColumnKeys[next];
                return col === undefined ? null : { row: rowIndex, column: col };
            }
            case "right": {
                const next = columnIndex + 1;
                if (next >= visibleColumnKeys.length) return null;
                const col = visibleColumnKeys[next];
                return col === undefined ? null : { row: rowIndex, column: col };
            }
            case "up": {
                if (rowIndex - 1 < 0) return null;
                return { row: rowIndex - 1, column };
            }
            case "down": {
                if (rowIndex + 1 >= rows.length) return null;
                return { row: rowIndex + 1, column };
            }
            case "next": {
                const next = columnIndex + 1;
                if (next >= visibleColumnKeys.length) {
                    if (rowIndex + 1 >= rows.length) return null;
                    const firstCol = visibleColumnKeys[0];
                    return firstCol === undefined ? null : { row: rowIndex + 1, column: firstCol };
                }
                const col = visibleColumnKeys[next];
                return col === undefined ? null : { row: rowIndex, column: col };
            }
            case "previous": {
                const prev = columnIndex - 1;
                if (prev < 0) {
                    if (rowIndex - 1 < 0) return null;
                    const lastCol = visibleColumnKeys[visibleColumnKeys.length - 1];
                    return lastCol === undefined ? null : { row: rowIndex - 1, column: lastCol };
                }
                const col = visibleColumnKeys[prev];
                return col === undefined ? null : { row: rowIndex, column: col };
            }
        }
    };

    const focusCell = (rowIndex: number, column: CellColumn) => {
        if (!gridRef) return;
        // CellColumn values are a fixed string union (no quotes) — safe to interpolate without CSS.escape.
        const selector = `[data-cell="${rowIndex}:${column}"]`;
        const target = gridRef.querySelector<HTMLElement>(selector);
        target?.focus();
    };

    const handleNavigate = (rowIndex: number, column: CellColumn, direction: CellNavigationDirection) => {
        const target = resolveNavigationTarget(rowIndex, column, direction);
        if (target) focusCell(target.row, target.column);
    };

    // FR-16/FR-17: called by parent after add/duplicate to land focus in the new row.
    // microtask waits for the EditorRow to render.
    export const focusNameCell = (rowIndex: number) => {
        queueMicrotask(() => focusCell(rowIndex, "Name"));
    };
</script>

<div
    bind:this={gridRef}
    aria-label="Editable orders table"
    class="border-hair bg-card overflow-hidden rounded-xl border border-solid"
>
    <!--
        Owns BOTH scroll axes. The Table primitive wraps its <table> in an
        `overflow-x-auto` container of its own; left visible, that inner container
        takes the x-axis and parks its scrollbar under the LAST row — off-screen
        until you scroll down. Neutralizing it moves the horizontal scrollbar to
        this box's bottom edge. `scrollbar-persistent` (app.css) then keeps that bar
        rendered and draggable instead of a fade-out macOS overlay bar.
    -->
    <div
        class="scrollbar-persistent max-h-[50vh] overflow-auto overscroll-x-contain sm:max-h-[60vh] [&>[data-slot=table-container]]:overflow-visible"
    >
        <Table.Root class="w-full text-base">
            <Table.Header class="bg-ink-2 sticky top-0 z-20 backdrop-blur">
                <Table.Row class="border-hair">
                    <Table.Head class="bg-ink-2 text-micro sticky left-0 z-30 w-14 text-center" aria-label="Select"
                    ></Table.Head>
                    <Table.Head
                        class="text-ink-muted text-micro w-10 text-right  tracking-[0.1em]"
                        aria-label="Row number">#</Table.Head
                    >
                    {#each visibleColumns as column (column.key)}
                        <Table.Head
                            class={cn(
                                "border-hair text-caption min-w-[10rem] border-l border-solid  tracking-[0.18em] uppercase",
                                column.kind === "batch-constant" ? "text-foreground" : "text-ink-muted"
                            )}
                        >
                            {column.key}
                            {#if column.required}
                                <span class="text-destructive" aria-label="required">*</span>
                            {/if}
                        </Table.Head>
                    {/each}
                    <Table.Head class="bg-ink-2 sticky right-0 z-30 w-20 text-center" aria-label="Actions"></Table.Head>
                </Table.Row>
            </Table.Header>
            <Table.Body>
                {#each rows as row, rowIndex (rowIds[rowIndex])}
                    <EditorRow
                        {row}
                        {rowIndex}
                        columns={visibleColumns}
                        {batchDefaults}
                        animateEntry={mounted}
                        warningMessages={warningsByRow.get(rowIndex) ?? EMPTY_WARNING_MAP}
                        isSelected={selection.has(rowIndex)}
                        onCellCommit={(column, value) => onCellCommit(rowIndex, column, value)}
                        onCellNavigate={handleNavigate}
                        onToggleSelect={(event) => onToggleSelect(rowIndex, event)}
                        onDelete={() => onDeleteRow(rowIndex)}
                        onDuplicate={() => onDuplicateRow(rowIndex)}
                    />
                {:else}
                    <tr>
                        <td
                            colspan={visibleColumns.length + 3}
                            class="text-ink-muted px-4 py-12 text-center text-sm text-pretty"
                        >
                            No orders yet — click Add row to create the first.
                        </td>
                    </tr>
                {/each}
            </Table.Body>
        </Table.Root>
    </div>

    <button
        type="button"
        onclick={onAddRow}
        class="border-hair text-ink-muted hover:bg-ink-2 hover:text-foreground focus-visible:ring-ring text-caption flex min-h-11 w-full cursor-pointer touch-manipulation items-center justify-center gap-2 border-t border-dashed tracking-[0.18em] whitespace-nowrap uppercase transition-colors ease-[var(--ease)] focus:outline-none focus-visible:ring-2"
        aria-label="Add row"
    >
        <Plus class="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
        Add row
    </button>
</div>
