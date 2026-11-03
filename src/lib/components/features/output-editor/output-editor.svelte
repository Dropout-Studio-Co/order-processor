<!--
    Editor entry: owns the working batch (rows + per-row UUID rowIds + batch
    defaults) and composes the defaults strip, grid, and action bar. Mounted by
    order-processor.svelte once a CSV is parsed; re-mounted (via {#key}) on a new
    drop or a Copilot re-map, which is why props seed $state once and are never
    re-read. Registers an EditorController with copilotBridge so the AI Copilot
    can mutate this batch (CLAUDE.md #15) — those ai* handlers deliberately bypass
    the native undo stack (see comment at aiGetRows). Phone normalization happens
    only in download() at export, never on commit (CLAUDE.md #4 / NFR-14).
-->
<script lang="ts">
    import { untrack } from "svelte";
    import { SvelteSet, SvelteMap } from "svelte/reactivity";
    import type { SteadFastOrder } from "#lib/types/index.js";
    import {
        buildWorkbook,
        writeWorkbook,
        normalizePhoneNumber,
        validateRow,
        type CellWarning
    } from "#lib/utils/index.js";
    import BatchDefaultsStrip from "./batch-defaults-strip.svelte";
    import EditorGrid from "./editor-grid.svelte";
    import ActionBar from "./action-bar.svelte";
    import * as AlertDialog from "#lib/components/ui/alert-dialog/index.js";
    import { BATCH_CONSTANT_COLUMNS, type BatchDefaults, type CellColumn } from "./columns";
    import { copilotBridge } from "#lib/stores/copilot-bridge.svelte.js";
    import type { CellEdit, EditorController, EditorSnapshot } from "#lib/ai/types.js";

    interface Props {
        initialRows: SteadFastOrder[];
        initialDefaults: BatchDefaults;
        fileName: string;
        onDiscard: () => void;
    }

    let { initialRows, initialDefaults, fileName, onDiscard }: Props = $props();

    // Props seed state once. Re-mount on new CSV drop, never re-read props.
    // Spread-clone (not structuredClone) — initialRows may be a $state proxy.
    let rows = $state<SteadFastOrder[]>(untrack(() => initialRows.map((row) => ({ ...row }))));
    // rowIds stays lockstep with rows. Stable UUID keys make row insert/delete
    // animate exactly one row and preserve a cell's component across commit.
    let rowIds = $state<string[]>(untrack(() => initialRows.map(() => crypto.randomUUID())));
    let defaults = $state<BatchDefaults>(untrack(() => ({ ...initialDefaults })));
    let selection = new SvelteSet<number>();
    let showBatchColumns = $state(false);
    let lastSelectAnchor = $state<number | null>(null);
    let showDiscardConfirm = $state(false);
    let gridComponent = $state<EditorGrid | null>(null);

    type UndoEntry = {
        kind: "delete-rows";
        rows: { row: SteadFastOrder; id: string; index: number }[];
        label: string;
    } | null;

    let undoEntry = $state<UndoEntry>(null);
    let undoTimer: ReturnType<typeof setTimeout> | null = null;

    // FR-28 dirty detection: compare current JSON against mount-time snapshot.
    const initialRowsSnapshot = untrack(() => JSON.stringify(initialRows));
    const initialDefaultsSnapshot = untrack(() => JSON.stringify(initialDefaults));

    const dirty = $derived(
        JSON.stringify(rows) !== initialRowsSnapshot || JSON.stringify(defaults) !== initialDefaultsSnapshot
    );

    const allWarnings = $derived.by((): CellWarning[] => {
        const list: CellWarning[] = [];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (!row) continue;
            list.push(...validateRow(row, i));
        }
        return list;
    });

    const warningsByRow = $derived.by(() => {
        const map = new SvelteMap<number, SvelteMap<CellColumn, string>>();
        for (const warning of allWarnings) {
            let inner = map.get(warning.rowIndex);
            if (!inner) {
                inner = new SvelteMap();
                map.set(warning.rowIndex, inner);
            }
            inner.set(warning.column, warning.message);
        }
        return map;
    });

    // Sentinel for the validation live-region: row ops call announceRowChange
    // which resyncs this, so the $effect below only speaks for commit-driven
    // warning changes (not warnings that appear when blank rows are inserted).
    let lastWarningCount = -1;

    const overrideCountByColumn = $derived.by(() => {
        const counts: Record<keyof BatchDefaults, number> = {
            Invoice: 0,
            "Contact Name": 0,
            "Contact Phone": 0,
            "Delivery Type": 0,
            Lot: 0
        };
        for (const row of rows) {
            for (const column of BATCH_CONSTANT_COLUMNS) {
                const key = column.key as keyof BatchDefaults;
                if (row[key] !== defaults[key]) counts[key]++;
            }
        }
        return counts;
    });

    const scheduleUndoExpiry = (ms: number) => {
        if (undoTimer) clearTimeout(undoTimer);
        undoTimer = setTimeout(() => {
            undoEntry = null;
            undoTimer = null;
        }, ms);
    };

    const clearUndo = () => {
        if (undoTimer) clearTimeout(undoTimer);
        undoTimer = null;
        undoEntry = null;
    };

    const commitCell = (rowIndex: number, column: CellColumn, value: string) => {
        const row = rows[rowIndex];
        if (!row) return;
        const next = { ...row, [column]: value };
        rows[rowIndex] = next as SteadFastOrder;
    };

    const addRow = () => {
        const newRow: SteadFastOrder = {
            Invoice: defaults.Invoice,
            Name: "",
            Address: "",
            Phone: "",
            Amount: "",
            Note: "",
            Lot: defaults.Lot,
            "Delivery Type": defaults["Delivery Type"],
            "Contact Name": defaults["Contact Name"],
            "Contact Phone": defaults["Contact Phone"]
        };
        rows.push(newRow);
        rowIds.push(crypto.randomUUID());
        clearUndo();
        gridComponent?.focusNameCell(rows.length - 1);
        announceRowChange(`Added row ${rows.length}`);
    };

    const duplicateRow = (rowIndex: number) => {
        const source = rows[rowIndex];
        if (!source) return;
        rows.splice(rowIndex + 1, 0, { ...source });
        rowIds.splice(rowIndex + 1, 0, crypto.randomUUID());
        // Shift selection indexes >= rowIndex+1 by +1; SvelteSet is reactive so mutate in place.
        const snapshot = [...selection];
        selection.clear();
        for (const i of snapshot) selection.add(i >= rowIndex + 1 ? i + 1 : i);
        clearUndo();
        gridComponent?.focusNameCell(rowIndex + 1);
        announceRowChange(`Duplicated row ${rowIndex + 1}`);
    };

    const deleteRow = (rowIndex: number) => {
        const removed = rows[rowIndex];
        const removedId = rowIds[rowIndex];
        if (!removed || removedId === undefined) return;
        rows.splice(rowIndex, 1);
        rowIds.splice(rowIndex, 1);
        // Drop the removed index and shift indexes > rowIndex by -1.
        const snapshot = [...selection];
        selection.clear();
        for (const i of snapshot) {
            if (i === rowIndex) continue;
            selection.add(i > rowIndex ? i - 1 : i);
        }
        undoEntry = {
            kind: "delete-rows",
            rows: [{ row: removed, id: removedId, index: rowIndex }],
            label: `delete row ${rowIndex + 1}`
        };
        scheduleUndoExpiry(5000);
        announceRowChange(`Deleted row ${rowIndex + 1}`);
    };

    const bulkDelete = () => {
        if (selection.size === 0) return;
        const sortedIndexes = [...selection].sort((a, b) => a - b);
        const removed: { row: SteadFastOrder; id: string; index: number }[] = [];
        // Reverse iteration keeps lower indexes stable while splicing.
        for (let i = sortedIndexes.length - 1; i >= 0; i--) {
            const idx = sortedIndexes[i];
            if (idx === undefined) continue;
            const row = rows[idx];
            const id = rowIds[idx];
            if (!row || id === undefined) continue;
            removed.unshift({ row, id, index: idx });
            rows.splice(idx, 1);
            rowIds.splice(idx, 1);
        }
        const count = removed.length;
        selection.clear();
        undoEntry = {
            kind: "delete-rows",
            rows: removed,
            label: `delete ${count} row${count === 1 ? "" : "s"}`
        };
        scheduleUndoExpiry(count > 1 ? 10000 : 5000);
        announceRowChange(`Deleted ${count} row${count === 1 ? "" : "s"}`);
    };

    const undo = () => {
        if (!undoEntry) return;
        if (undoEntry.kind === "delete-rows") {
            // Ascending order so each splice lands the row at its original index.
            const sorted = [...undoEntry.rows].sort((a, b) => a.index - b.index);
            for (const item of sorted) {
                rows.splice(item.index, 0, item.row);
                rowIds.splice(item.index, 0, item.id);
            }
            announceRowChange(`Restored ${sorted.length} row${sorted.length === 1 ? "" : "s"}`);
        }
        clearUndo();
    };

    // SvelteSet is reactive — mutate in place rather than reassigning.
    const toggleSelect = (rowIndex: number, event: MouseEvent) => {
        const isShift = event.shiftKey;

        if (isShift && lastSelectAnchor !== null) {
            const start = Math.min(lastSelectAnchor, rowIndex);
            const end = Math.max(lastSelectAnchor, rowIndex);
            for (let i = start; i <= end; i++) selection.add(i);
        } else {
            if (selection.has(rowIndex)) selection.delete(rowIndex);
            else selection.add(rowIndex);
            lastSelectAnchor = rowIndex;
        }
    };

    // Changing a default rewrites every row whose value still equals the
    // previous default; rows that diverged are treated as user overrides.
    const updateDefault = (field: keyof BatchDefaults, value: string) => {
        const previous = defaults[field];
        defaults = { ...defaults, [field]: value };
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (!row) continue;
            if (row[field] === previous) {
                rows[i] = { ...row, [field]: value };
            }
        }
    };

    const resetOverrides = (field: keyof BatchDefaults) => {
        const target = defaults[field];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (!row) continue;
            if (row[field] !== target) {
                rows[i] = { ...row, [field]: target };
            }
        }
    };

    // Controller exposed to the AI Copilot via copilotBridge. These deliberately
    // do NOT touch native `undoEntry` — Copilot owns a parallel snapshot stack
    // in copilot.svelte.ts. Restoring an AI undo reverts manual edits too.
    const aiGetRows = (): SteadFastOrder[] => rows.map((row) => ({ ...row }));
    const aiGetDefaults = (): BatchDefaults => ({ ...defaults });
    const aiGetWarnings = (): CellWarning[] => [...allWarnings];
    const aiGetFileName = (): string => fileName;

    const aiSnapshot = (): EditorSnapshot => ({
        rows: rows.map((row) => ({ ...row })),
        rowIds: [...rowIds],
        defaults: { ...defaults }
    });

    const aiRestore = (snap: EditorSnapshot) => {
        rows = snap.rows.map((row) => ({ ...row }));
        rowIds = [...snap.rowIds];
        defaults = { ...snap.defaults };
        selection.clear();
        clearUndo();
    };

    const aiApplyCellEdits = (edits: CellEdit[]) => {
        for (const edit of edits) {
            const row = rows[edit.rowIndex];
            if (!row) continue;
            rows[edit.rowIndex] = { ...row, [edit.column]: edit.value } as SteadFastOrder;
        }
    };

    const aiAddRows = (drafts: Partial<SteadFastOrder>[]) => {
        for (const draft of drafts) {
            rows.push({
                Invoice: draft.Invoice ?? defaults.Invoice,
                Name: draft.Name ?? "",
                Address: draft.Address ?? "",
                Phone: draft.Phone ?? "",
                Amount: draft.Amount ?? "",
                Note: draft.Note ?? "",
                Lot: draft.Lot ?? defaults.Lot,
                "Delivery Type": draft["Delivery Type"] ?? defaults["Delivery Type"],
                "Contact Name": draft["Contact Name"] ?? defaults["Contact Name"],
                "Contact Phone": draft["Contact Phone"] ?? defaults["Contact Phone"]
            });
            rowIds.push(crypto.randomUUID());
        }
    };

    const aiDeleteRows = (indexes: number[]) => {
        const ordered = [...new Set(indexes)].sort((a, b) => b - a);
        for (const idx of ordered) {
            if (idx >= 0 && idx < rows.length) {
                rows.splice(idx, 1);
                rowIds.splice(idx, 1);
            }
        }
        selection.clear();
    };

    const aiSetDefaults = (patch: Partial<BatchDefaults>) => {
        for (const [key, value] of Object.entries(patch)) {
            if (value === undefined) continue;
            updateDefault(key as keyof BatchDefaults, value);
        }
    };

    $effect(() => {
        const controller: EditorController = {
            getRows: aiGetRows,
            getDefaults: aiGetDefaults,
            getWarnings: aiGetWarnings,
            getFileName: aiGetFileName,
            snapshot: aiSnapshot,
            restore: aiRestore,
            applyCellEdits: aiApplyCellEdits,
            addRows: aiAddRows,
            deleteRows: aiDeleteRows,
            setDefaults: aiSetDefaults
        };
        copilotBridge.registerEditor(controller);
        return () => copilotBridge.unregisterEditor(controller);
    });

    const jumpToFirstWarning = () => {
        const first = allWarnings[0];
        if (!first) return;
        gridComponent?.focusNameCell(first.rowIndex);
        // focusNameCell scrolls the row in; microtask then moves focus to the offending cell.
        queueMicrotask(() => {
            const selector = `[data-cell="${first.rowIndex}:${CSS.escape(first.column)}"]`;
            const el = document.querySelector<HTMLElement>(selector);
            el?.focus();
            el?.scrollIntoView({ block: "center", behavior: "smooth" });
        });
    };

    const requestDiscard = () => {
        if (!dirty) {
            onDiscard();
            return;
        }
        showDiscardConfirm = true;
    };

    const confirmDiscard = () => {
        showDiscardConfirm = false;
        onDiscard();
    };

    const cancelDiscard = () => {
        showDiscardConfirm = false;
    };

    const download = () => {
        // NFR-14: idempotent BD-phone normalization at export only, not on commit.
        const normalized = rows.map((row) => ({
            ...row,
            Phone: normalizePhoneNumber(row.Phone ?? "")
        }));
        const workbook = buildWorkbook(normalized, "Sheet1");
        writeWorkbook(workbook, fileName);
        liveAnnounce(`Downloaded ${normalized.length} row${normalized.length === 1 ? "" : "s"}`);
    };

    let liveMessage = $state("");
    let liveTimer: ReturnType<typeof setTimeout> | null = null;
    const liveAnnounce = (msg: string) => {
        liveMessage = msg;
        if (liveTimer) clearTimeout(liveTimer);
        liveTimer = setTimeout(() => {
            liveMessage = "";
            liveTimer = null;
        }, 2000);
    };

    // Resync lastWarningCount so the validation $effect doesn't double-announce
    // a row op that already spoke (e.g. "Added row 3" + "1 warning").
    const announceRowChange = (msg: string) => {
        liveAnnounce(msg);
        lastWarningCount = allWarnings.length;
    };

    // NFR-8: announce validation changes triggered by cell commits. Row ops
    // announce themselves via announceRowChange. The -1 sentinel primes the
    // first run so the editor's starting warning count is not announced.
    // $effect (not $derived) because announcing to the live region is a side effect.
    $effect(() => {
        const count = allWarnings.length;
        if (lastWarningCount === -1) {
            lastWarningCount = count;
        } else if (count !== lastWarningCount) {
            lastWarningCount = count;
            liveAnnounce(count === 0 ? "All warnings resolved" : `${count} warning${count === 1 ? "" : "s"}`);
        }
    });

    const handleKeydown = (event: KeyboardEvent) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
            // Defer to the browser's native text-undo when an input/textarea is focused.
            const target = event.target as HTMLElement | null;
            if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
            if (undoEntry) {
                event.preventDefault();
                undo();
            }
        }
    };
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex w-full flex-col gap-4" aria-label="Order output editor">
    <BatchDefaultsStrip {defaults} {overrideCountByColumn} onUpdate={updateDefault} onResetOverrides={resetOverrides} />

    <EditorGrid
        bind:this={gridComponent}
        {rows}
        {rowIds}
        batchDefaults={defaults}
        {showBatchColumns}
        {selection}
        {warningsByRow}
        onCellCommit={commitCell}
        onToggleSelect={toggleSelect}
        onDeleteRow={deleteRow}
        onDuplicateRow={duplicateRow}
        onAddRow={addRow}
    />

    <ActionBar
        rowCount={rows.length}
        warningCount={allWarnings.length}
        selectionCount={selection.size}
        {showBatchColumns}
        undoAvailable={undoEntry !== null}
        undoLabel={undoEntry?.label ?? ""}
        canDownload={rows.length > 0}
        onToggleBatchColumns={() => (showBatchColumns = !showBatchColumns)}
        onJumpToFirstWarning={jumpToFirstWarning}
        onBulkDelete={bulkDelete}
        onUndo={undo}
        onDiscard={requestDiscard}
        onDownload={download}
    />
</div>

<div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{liveMessage}</div>

<AlertDialog.Root bind:open={showDiscardConfirm}>
    <AlertDialog.Content class="border-hair gap-0 rounded-2xl border border-solid p-6 shadow-2xl ring-0">
        <AlertDialog.Header class="gap-0 text-left">
            <AlertDialog.Title class="text-foreground text-base font-medium text-balance">
                Discard your edits?
            </AlertDialog.Title>
            <AlertDialog.Description class="text-ink-muted mt-2 text-sm text-pretty">
                This can't be undone. Your edits will be lost and you'll return to the upload zone.
            </AlertDialog.Description>
        </AlertDialog.Header>
        <AlertDialog.Footer class="mt-6 flex flex-row items-center justify-end gap-2">
            <AlertDialog.Cancel
                onclick={cancelDiscard}
                class="border-hair bg-background text-foreground hover:border-signal hover:bg-ink-2 hover:text-foreground inline-flex h-9 cursor-pointer touch-manipulation items-center rounded-full border border-solid px-5  text-xs font-normal tracking-[0.06em] uppercase transition-colors ease-[var(--ease)]"
            >
                Cancel
            </AlertDialog.Cancel>
            <AlertDialog.Action
                onclick={confirmDiscard}
                class="bg-destructive/10 text-destructive hover:bg-destructive/20 inline-flex h-9 cursor-pointer touch-manipulation items-center rounded-full px-5  text-xs font-medium tracking-[0.06em] uppercase transition-colors ease-[var(--ease)]"
            >
                Discard
            </AlertDialog.Action>
        </AlertDialog.Footer>
    </AlertDialog.Content>
</AlertDialog.Root>
