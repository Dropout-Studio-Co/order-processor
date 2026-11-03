<script lang="ts">
    import { fade } from "svelte/transition";
    import { cubicOut } from "svelte/easing";
    import Check from "@lucide/svelte/icons/check";
    import { Copy, Trash2 } from "@lucide/svelte";
    import type { SteadFastOrder } from "#lib/types/index.js";
    import { Table } from "#lib/components/ui/index.js";
    import { cn } from "#lib/utils/index.js";
    import EditorCell, { type CellNavigationDirection } from "./editor-cell.svelte";
    import type { CellColumn, ColumnDescriptor, BatchDefaults } from "./columns";

    interface Props {
        row: SteadFastOrder;
        rowIndex: number;
        columns: readonly ColumnDescriptor[];
        batchDefaults: BatchDefaults;
        animateEntry: boolean;
        warningMessages: ReadonlyMap<CellColumn, string>;
        isSelected: boolean;
        onCellCommit: (column: CellColumn, value: string) => void;
        onCellNavigate: (rowIndex: number, column: CellColumn, direction: CellNavigationDirection) => void;
        onToggleSelect: (event: MouseEvent) => void;
        onDelete: () => void;
        onDuplicate: () => void;
    }

    let {
        row,
        rowIndex,
        columns,
        batchDefaults,
        animateEntry,
        warningMessages,
        isSelected,
        onCellCommit,
        onCellNavigate,
        onToggleSelect,
        onDelete,
        onDuplicate
    }: Props = $props();

    const isOverride = (column: CellColumn): boolean => {
        if (column in batchDefaults) {
            return row[column as keyof SteadFastOrder] !== batchDefaults[column as keyof BatchDefaults];
        }
        return false;
    };

    const controlBase = "border border-solid border-hair bg-ink-2";

    // Row motion uses `fade` (NOT `slide`) — Svelte rejects `slide` on
    // <tr> (transition_slide_display) because table rows have no overflow
    // clipping and ignore padding/margin. See CLAUDE.md warning #13.
    // animateEntry gates IN so initial mount is instant; OUT always animates.
    const ROW_MOTION_MS = 100;
    const rowMotion = (node: Element, { animate }: { animate: boolean }) =>
        animate ? fade(node, { duration: ROW_MOTION_MS, easing: cubicOut }) : { duration: 0 };
</script>

<tr
    data-slot="table-row"
    data-selected={isSelected ? "true" : undefined}
    in:rowMotion={{ animate: animateEntry }}
    out:rowMotion={{ animate: true }}
    class={cn("border-hair hover:bg-ink-2/60 border-b border-solid transition-colors", isSelected && "bg-ink-2/50")}
>
    <!-- Frozen columns must be OPAQUE, not `bg-inherit`: the row is transparent (and its
         selected/hover tints are translucent), so an inherited background lets horizontally
         scrolled cell text paint straight through. The app is pinned dark, where --card and
         --ink-2 are the same ink-900, so bg-card matches every row state exactly.
         ponytail: if a light theme ever lands, these need the opaque color-mix of the tint. -->
    <Table.Cell class="bg-card sticky left-0 z-10 w-14 p-0 align-middle">
        <div class="flex items-center justify-center gap-1">
            <!-- Generous min-11 hit area wraps a ~17px custom DS checkbox box.
                 The native input is appearance-none + peer; the visible box and
                 its check mark are siblings driven by peer-checked / peer-focus-visible. -->
            <label
                class="flex min-h-11 min-w-11 cursor-pointer touch-manipulation items-center justify-center rounded-md sm:min-h-10 sm:min-w-10"
            >
                <span class="sr-only">Select row {rowIndex + 1}</span>
                <input
                    type="checkbox"
                    checked={isSelected}
                    onclick={(e) => onToggleSelect(e as unknown as MouseEvent)}
                    onkeydown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            onToggleSelect(e as unknown as MouseEvent);
                        }
                    }}
                    class="peer sr-only"
                />
                <span
                    aria-hidden="true"
                    class={cn(
                        "border-hair bg-ink-2 relative flex size-[17px] shrink-0 items-center justify-center rounded-[5px] border border-solid transition-[background-color,border-color] duration-150 ease-[var(--ease)]",
                        "peer-hover:border-signal/60",
                        "peer-focus-visible:ring-ring peer-focus-visible:ring-offset-background peer-focus-visible:ring-2 peer-focus-visible:ring-offset-1",
                        isSelected && "border-signal bg-signal"
                    )}
                >
                    <Check
                        class={cn(
                            "text-background size-3 transition-[opacity,transform] duration-150 ease-[var(--ease)]",
                            isSelected ? "scale-100 opacity-100" : "scale-50 opacity-0"
                        )}
                        aria-hidden="true"
                    />
                </span>
            </label>
        </div>
    </Table.Cell>

    <Table.Cell class="text-ink-muted w-10 px-2  text-xs tabular-nums">
        {rowIndex + 1}
    </Table.Cell>

    {#each columns as column (column.key)}
        <Table.Cell class="border-hair border-l border-solid p-0 align-middle">
            <EditorCell
                value={row[column.key as keyof SteadFastOrder] ?? ""}
                column={column.key}
                inputmode={column.inputmode}
                multiline={column.multiline}
                {rowIndex}
                warning={warningMessages.get(column.key) ?? null}
                isOverride={isOverride(column.key)}
                {isSelected}
                onCommit={(value) => onCellCommit(column.key, value)}
                onNavigate={(direction) => onCellNavigate(rowIndex, column.key, direction)}
            />
        </Table.Cell>
    {/each}

    <Table.Cell class="border-hair bg-card sticky right-0 z-10 w-20 border-l border-solid p-0 align-middle">
        <div class="flex min-h-11 items-center justify-center gap-0.5 sm:min-h-10">
            <button
                type="button"
                onclick={onDuplicate}
                class={cn(
                    "sleek text-ink-muted flex h-auto min-h-11 w-auto min-w-11 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-md sm:h-9 sm:min-h-9 sm:w-9 sm:min-w-9",
                    controlBase,
                    "hover:border-signal/50 hover:bg-ink-2 hover:text-foreground active:bg-ink-2",
                    "focus-visible:ring-ring focus:outline-none focus-visible:ring-2"
                )}
                title="Duplicate row"
                aria-label="Duplicate row {rowIndex + 1}"
            >
                <Copy class="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            </button>
            <button
                type="button"
                onclick={onDelete}
                class={cn(
                    "sleek text-ink-muted flex h-auto min-h-11 w-auto min-w-11 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-md sm:h-9 sm:min-h-9 sm:w-9 sm:min-w-9",
                    controlBase,
                    "hover:bg-destructive/15 hover:border-destructive/30 hover:text-destructive active:bg-destructive/25",
                    "focus-visible:ring-ring focus:outline-none focus-visible:ring-2"
                )}
                title="Delete row"
                aria-label="Delete row {rowIndex + 1}"
            >
                <Trash2 class="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            </button>
        </div>
    </Table.Cell>
</tr>
