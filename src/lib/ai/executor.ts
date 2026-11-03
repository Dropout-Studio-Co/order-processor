/**
 * Browser-side tool executor. The server only decides calls; this module runs
 * them against the editor via `copilotBridge.editor`.
 *
 * Mutation pipeline (applyMutation):
 *   1. Zod-validate args (already validated server-side; re-run for defense)
 *   2. Build a confirmation diff
 *   3. requestConfirmation if it touches > 1 row (deleteRows/autoFix always confirm)
 *   4. Snapshot full editor state via editor.snapshot()
 *   5. Apply mutation
 *   6. Push a revert closure onto copilot.undoStack
 *
 * Editor `$derived` validation re-runs automatically when `rows` mutates.
 * IMPORTANT: undoStack is SEPARATE from the editor's native Cmd+Z (undoEntry).
 */
import { copilot } from "#lib/stores/copilot.svelte.js";
import { copilotBridge } from "#lib/stores/copilot-bridge.svelte.js";
import { brandSettings } from "#lib/stores/index.js";
import { normalizePhoneNumber } from "#lib/utils/index.js";
import { detectAnomalies } from "./safety";
import { argSchemas, isKnownToolName, type ArgsOf } from "./schemas";
import { READ_ONLY_TOOLS } from "./types";
import type {
    AnomalyResult,
    CellEdit,
    ConfirmationDiffRow,
    CopilotToolCall,
    CsvMapping,
    EditorController,
    ParsedToolCall
} from "./types";
import type { SteadFastOrder } from "#lib/types/index.js";
import type { BatchDefaults, CellColumn } from "#lib/components/features/output-editor/columns.js";

export interface ConfirmationRequest {
    toolCallId: string;
    toolName: string;
    humanLabel: string;
    diff: ConfirmationDiffRow[];
    anomalies: AnomalyResult[];
    inverseSummary: string;
}

export interface ExecutorContext {
    messageId: string;
    requestConfirmation: (req: ConfirmationRequest) => Promise<boolean>;
}

// Throws a user-visible message when grid tools run before output-editor mounts.
const requireEditor = (): EditorController => {
    const editor = copilotBridge.editor;
    if (!editor) {
        throw new Error("No batch is loaded — upload a CSV to open the editor first.");
    }
    return editor;
};

const cellValue = (row: SteadFastOrder | undefined, column: CellColumn): string =>
    row ? String(row[column as keyof SteadFastOrder] ?? "") : "";

/**
 * Recover a deliverable BD mobile (^1\d{9}$) from a malformed input.
 * Handles: multi-number strings split by delimiters, accidentally doubled
 * numbers (length 20), and 9-digit numbers missing the leading 1.
 * Returns null if no salvageable BD mobile is found.
 */
const repairPhone = (raw: string): string | null => {
    if (!raw) return null;
    const parts = raw
        .split(/[/,;&]|\band\b|\bor\b/i)
        .map((p) => p.trim())
        .filter(Boolean);
    if (parts.length > 1) {
        for (const part of parts) {
            const candidate = normalizePhoneNumber(part);
            if (/^1\d{9}$/.test(candidate)) return candidate;
        }
    }
    const norm = normalizePhoneNumber(raw);
    if (/^1\d{9}$/.test(norm)) return norm;
    if (norm.length === 20 && /^1\d{9}/.test(norm)) {
        const first = norm.slice(0, 10);
        if (/^1\d{9}$/.test(first)) return first;
    }
    if (norm.length === 9) {
        const withLeadingOne = `1${norm}`;
        if (/^1\d{9}$/.test(withLeadingOne)) return withLeadingOne;
    }
    return null;
};

/** Strip currency symbols/separators; returns the leading numeric run or null. */
const repairAmount = (raw: string): string | null => {
    if (!raw) return null;
    const cleaned = raw.replace(/[^\d.]/g, "");
    const match = cleaned.match(/^\d+(\.\d+)?/);
    return match ? match[0] : null;
};

// Returns the entry id so the caller can stamp it on the tool card for the inline Undo button.
const registerUndo = (label: string, revert: () => void): string => {
    const id = crypto.randomUUID();
    copilot.pushUndo({ id, label, revert, undone: false });
    return id;
};

const applyMutation = async (
    call: ParsedToolCall,
    ctx: ExecutorContext,
    editor: EditorController,
    spec: {
        needsConfirm: boolean;
        humanLabel: string;
        diff: ConfirmationDiffRow[];
        anomalies: AnomalyResult[];
        inverseSummary: string;
        undoLabel: string;
        summary: string;
        apply: () => void;
    }
): Promise<void> => {
    const update = (patch: Partial<CopilotToolCall>) => copilot.updateToolCall(ctx.messageId, call.id, patch);

    if (spec.needsConfirm) {
        update({ status: "pending_confirmation" });
        const approved = await ctx.requestConfirmation({
            toolCallId: call.id,
            toolName: call.name,
            humanLabel: spec.humanLabel,
            diff: spec.diff,
            anomalies: spec.anomalies,
            inverseSummary: spec.inverseSummary
        });
        if (!approved) {
            update({ status: "rejected", summary: "Cancelled — no changes made." });
            return;
        }
    }

    const snapshot = editor.snapshot();
    spec.apply();
    const undoId = registerUndo(spec.undoLabel, () => editor.restore(snapshot));
    update({ status: "applied", summary: spec.summary, undoId });
};

const runGetBatchSummary = (call: ParsedToolCall, ctx: ExecutorContext): void => {
    const editor = requireEditor();
    const rows = editor.getRows();
    const warnings = editor.getWarnings();
    let total = 0;
    let withAmount = 0;
    for (const row of rows) {
        const n = Number.parseFloat(row.Amount);
        if (Number.isFinite(n)) {
            total += n;
            if (n > 0) withAmount++;
        }
    }
    copilot.updateToolCall(ctx.messageId, call.id, {
        status: "applied",
        summary: `${rows.length} row(s) · total amount ${total} · ${withAmount} with a collection amount · ${warnings.length} validation warning(s).`
    });
};

const runGetRows = (call: ParsedToolCall, ctx: ExecutorContext, args: ArgsOf<"getRows">): void => {
    const editor = requireEditor();
    let entries = editor.getRows().map((row, index) => ({ index, row }));
    if (args.indexes && args.indexes.length > 0) {
        const wanted = new Set(args.indexes);
        entries = entries.filter((e) => wanted.has(e.index));
    }
    if (args.query) {
        const q = args.query.toLowerCase();
        entries = entries.filter((e) =>
            [e.row.Name, e.row.Address, e.row.Phone, e.row.Note].some((v) => (v ?? "").toLowerCase().includes(q))
        );
    }
    const CAP = 15;
    const detail = entries
        .slice(0, CAP)
        .map(
            (e) =>
                `#${e.index + 1} ${e.row.Name || "(empty)"} · ${e.row.Phone || "—"} · amt ${e.row.Amount || "—"} · ${e.row.Address || "—"}${e.row.Note ? " · note: " + e.row.Note : ""}`
        )
        .join("; ");
    copilot.updateToolCall(ctx.messageId, call.id, {
        status: "applied",
        summary:
            entries.length === 0
                ? "No matching rows."
                : `Inspected ${entries.length} row(s): ${detail}${entries.length > CAP ? ` (+${entries.length - CAP} more)` : ""}.`
    });
};

const runFlagAnomalies = (call: ParsedToolCall, ctx: ExecutorContext): void => {
    const editor = requireEditor();
    const anomalies = detectAnomalies(editor.getRows());
    copilot.updateToolCall(ctx.messageId, call.id, {
        status: "applied",
        anomalies,
        summary:
            anomalies.length === 0
                ? "No anomalies detected — the batch looks clean."
                : `Flagged ${anomalies.length} potential issue(s) across the batch.`
    });
};

const runEditCells = async (call: ParsedToolCall, ctx: ExecutorContext, args: ArgsOf<"editCells">): Promise<void> => {
    const editor = requireEditor();
    const rows = editor.getRows();
    const edits: CellEdit[] = [];
    for (const edit of args.edits) {
        if (edit.rowIndex < 0 || edit.rowIndex >= rows.length) {
            throw new Error(`Row ${edit.rowIndex + 1} does not exist — the batch has ${rows.length} row(s).`);
        }
        edits.push({ rowIndex: edit.rowIndex, column: edit.column, value: edit.value });
    }
    const affected = new Set(edits.map((e) => e.rowIndex));
    const diff: ConfirmationDiffRow[] = edits.map((e) => ({
        label: `Row ${e.rowIndex + 1} · ${e.column}`,
        current: cellValue(rows[e.rowIndex], e.column) || "—",
        proposed: e.value || "—"
    }));
    const anomalies = detectAnomalies(rows).filter((a) => affected.has(a.rowIndex));
    const first = edits[0];

    await applyMutation(call, ctx, editor, {
        needsConfirm: affected.size > 1,
        humanLabel:
            edits.length === 1 && first
                ? `Set ${first.column} on row ${first.rowIndex + 1}`
                : `Apply ${edits.length} cell edit(s) across ${affected.size} row(s)`,
        diff,
        anomalies,
        inverseSummary: "Undo restores the previous cell values.",
        undoLabel: `Edit ${edits.length} cell(s)`,
        summary: `Updated ${edits.length} cell(s) across ${affected.size} row(s).`,
        apply: () => editor.applyCellEdits(edits)
    });
};

const runSetBatchDefaults = async (
    call: ParsedToolCall,
    ctx: ExecutorContext,
    args: ArgsOf<"setBatchDefaults">
): Promise<void> => {
    const editor = requireEditor();
    const rows = editor.getRows();
    const defaults = editor.getDefaults();
    const patch = args.patch as Partial<BatchDefaults>;

    let affectedRows = 0;
    const diff: ConfirmationDiffRow[] = [];
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        const field = key as keyof BatchDefaults;
        diff.push({ label: `Default · ${key}`, current: defaults[field] || "—", proposed: value || "—" });
        for (const row of rows) {
            if (row[field] === defaults[field]) affectedRows++;
        }
    }

    await applyMutation(call, ctx, editor, {
        needsConfirm: affectedRows > 1,
        humanLabel: `Set batch default(s): ${Object.keys(patch).join(", ")}`,
        diff,
        anomalies: [],
        inverseSummary: "Undo restores the previous defaults and row values.",
        undoLabel: `Set batch defaults`,
        summary: `Updated batch defaults — ${affectedRows} row(s) followed the change.`,
        apply: () => editor.setDefaults(patch)
    });
};

const runAddRows = async (call: ParsedToolCall, ctx: ExecutorContext, args: ArgsOf<"addRows">): Promise<void> => {
    const editor = requireEditor();
    const drafts = args.rows as Partial<SteadFastOrder>[];
    const diff: ConfirmationDiffRow[] = drafts.map((row, i) => ({
        label: `New row ${i + 1}`,
        current: "—",
        proposed: `${row.Name || "(no name)"} · ${row.Phone || "(no phone)"} · ${row.Amount || "(no amount)"}`
    }));

    await applyMutation(call, ctx, editor, {
        needsConfirm: drafts.length > 1,
        humanLabel: drafts.length === 1 ? "Add 1 new row" : `Add ${drafts.length} new rows`,
        diff,
        anomalies: [],
        inverseSummary: "Undo removes the newly added row(s).",
        undoLabel: `Add ${drafts.length} row(s)`,
        summary: `Added ${drafts.length} row(s) to the batch.`,
        apply: () => editor.addRows(drafts)
    });
};

const runDeleteRows = async (call: ParsedToolCall, ctx: ExecutorContext, args: ArgsOf<"deleteRows">): Promise<void> => {
    const editor = requireEditor();
    const rows = editor.getRows();
    const indexes = [...new Set(args.indexes)].filter((i) => i >= 0 && i < rows.length);
    if (indexes.length === 0) {
        throw new Error("None of those row indexes exist in the batch.");
    }
    const diff: ConfirmationDiffRow[] = indexes.map((i) => ({
        label: `Row ${i + 1}`,
        current: `${rows[i]?.Name || "(empty)"} · ${rows[i]?.Phone || ""}`.trim(),
        proposed: "(deleted)"
    }));
    const anomalies = detectAnomalies(rows).filter((a) => indexes.includes(a.rowIndex));

    // Deletion always confirms, even for a single row — destructive op.
    await applyMutation(call, ctx, editor, {
        needsConfirm: true,
        humanLabel: indexes.length === 1 ? `Delete row ${indexes[0]! + 1}` : `Delete ${indexes.length} rows`,
        diff,
        anomalies,
        inverseSummary: "Undo restores the deleted row(s).",
        undoLabel: `Delete ${indexes.length} row(s)`,
        summary: `Deleted ${indexes.length} row(s) from the batch.`,
        apply: () => editor.deleteRows(indexes)
    });
};

const runAutoFixWarnings = async (
    call: ParsedToolCall,
    ctx: ExecutorContext,
    args: ArgsOf<"autoFixWarnings">
): Promise<void> => {
    const editor = requireEditor();
    const rows = editor.getRows();
    const codes = args.codes;
    const warnings = editor.getWarnings().filter((w) => (codes && codes.length > 0 ? codes.includes(w.code) : true));

    const edits: CellEdit[] = [];
    const diff: ConfirmationDiffRow[] = [];
    let unfixable = 0;
    for (const warning of warnings) {
        const row = rows[warning.rowIndex];
        if (!row) continue;
        let fix: string | null = null;
        if (warning.code === "phone_format") fix = repairPhone(row.Phone);
        else if (warning.code === "amount_format") fix = repairAmount(row.Amount);
        if (fix === null) {
            unfixable++;
            continue;
        }
        edits.push({ rowIndex: warning.rowIndex, column: warning.column, value: fix });
        diff.push({
            label: `Row ${warning.rowIndex + 1} · ${warning.column} (${warning.code})`,
            current: cellValue(row, warning.column) || "—",
            proposed: fix
        });
    }

    const update = (patch: Partial<CopilotToolCall>) => copilot.updateToolCall(ctx.messageId, call.id, patch);

    if (edits.length === 0) {
        update({
            status: "applied",
            summary:
                warnings.length === 0
                    ? "No validation warnings to fix."
                    : `None of the ${warnings.length} warning(s) can be auto-fixed — empty required fields and undeliverable numbers need a human.`
        });
        return;
    }

    // Always confirm — batch repair can touch arbitrary rows.
    await applyMutation(call, ctx, editor, {
        needsConfirm: true,
        humanLabel: `Auto-fix ${edits.length} validation warning(s)`,
        diff,
        anomalies: [],
        inverseSummary: "Undo restores the original cell values.",
        undoLabel: `Auto-fix ${edits.length} warning(s)`,
        summary: `Fixed ${edits.length} warning(s).${unfixable > 0 ? ` ${unfixable} still need a human.` : ""}`,
        apply: () => editor.applyCellEdits(edits)
    });
};

const runUpdateBrandSettings = (
    call: ParsedToolCall,
    ctx: ExecutorContext,
    args: ArgsOf<"updateBrandSettings">
): void => {
    const patch = args.patch;
    const before = brandSettings.value;
    const applied: string[] = [];
    const reverts: Array<() => void> = [];

    if (patch.contactName !== undefined) {
        const prev = before.contactName ?? "";
        brandSettings.updateField("contactName", patch.contactName);
        reverts.push(() => brandSettings.updateField("contactName", prev));
        applied.push("Contact Name");
    }
    if (patch.contactPhone !== undefined) {
        const prev = before.contactPhone ?? "";
        brandSettings.updateField("contactPhone", patch.contactPhone);
        reverts.push(() => brandSettings.updateField("contactPhone", prev));
        applied.push("Contact Phone");
    }
    if (patch.merchantId !== undefined && patch.merchantId.trim().length > 0) {
        const prev = before.merchantId ?? "";
        brandSettings.updateField("merchantId", patch.merchantId);
        // Deliberately no revert when there was no prior Merchant ID: undo must
        // not blank out a required field the user had nothing in before.
        if (prev.length > 0) reverts.push(() => brandSettings.updateField("merchantId", prev));
        applied.push("Merchant ID");
    }

    if (applied.length === 0) {
        copilot.updateToolCall(ctx.messageId, call.id, {
            status: "applied",
            summary: "No brand settings were changed."
        });
        return;
    }

    const undoId = registerUndo(`Brand settings: ${applied.join(", ")}`, () => {
        for (const revert of reverts) revert();
    });
    copilot.updateToolCall(ctx.messageId, call.id, {
        status: "applied",
        summary: `Saved ${applied.join(", ")} to your brand settings.`,
        undoId
    });
};

const runProposeCsvColumnMapping = async (
    call: ParsedToolCall,
    ctx: ExecutorContext,
    args: ArgsOf<"proposeCsvColumnMapping">
): Promise<void> => {
    const ingestion = copilotBridge.ingestion;
    if (!ingestion) {
        throw new Error("No CSV is waiting to be mapped.");
    }
    const raw = ingestion.getRawCsv();
    if (!raw) {
        throw new Error("The raw CSV data is no longer available — re-upload the file.");
    }
    const columnCount = raw.headers.length;
    const allIndexes = [
        args.nameIndex,
        args.phoneIndex,
        args.amountIndex,
        ...args.addressIndexes,
        ...(args.noteIndex !== null ? [args.noteIndex] : [])
    ];
    for (const idx of allIndexes) {
        if (idx < 0 || idx >= columnCount) {
            throw new Error(`Column index ${idx} is out of range — the CSV has ${columnCount} columns.`);
        }
    }
    const mapping: CsvMapping = {
        nameIndex: args.nameIndex,
        addressIndexes: args.addressIndexes,
        phoneIndex: args.phoneIndex,
        amountIndex: args.amountIndex,
        noteIndex: args.noteIndex,
        skipFirst: args.skipFirst,
        skipLast: args.skipLast
    };
    const header = (i: number): string => raw.headers[i] ?? `column ${i}`;
    const diff: ConfirmationDiffRow[] = [
        { label: "Name", current: "—", proposed: header(mapping.nameIndex) },
        {
            label: "Address",
            current: "—",
            proposed: mapping.addressIndexes.map(header).join(" + ")
        },
        { label: "Phone", current: "—", proposed: header(mapping.phoneIndex) },
        { label: "Amount", current: "—", proposed: header(mapping.amountIndex) },
        {
            label: "Note",
            current: "—",
            proposed: mapping.noteIndex !== null ? header(mapping.noteIndex) : "(none)"
        },
        {
            label: "Trim",
            current: "—",
            proposed: `skip ${mapping.skipFirst} header / ${mapping.skipLast} footer row(s)`
        }
    ];

    const update = (patch: Partial<CopilotToolCall>) => copilot.updateToolCall(ctx.messageId, call.id, patch);
    update({ status: "pending_confirmation" });
    const approved = await ctx.requestConfirmation({
        toolCallId: call.id,
        toolName: call.name,
        humanLabel: "Apply this column mapping and load the batch",
        diff,
        anomalies: [],
        inverseSummary: "Re-upload the CSV to start over."
    });
    if (!approved) {
        update({ status: "rejected", summary: "Mapping cancelled." });
        return;
    }
    ingestion.applyMapping(mapping);
    update({ status: "applied", summary: "Column mapping applied — the editor is loading the batch." });
};

const runUndoLastChange = (call: ParsedToolCall, ctx: ExecutorContext): void => {
    const entry = copilot.peekUndo();
    if (!entry) {
        copilot.updateToolCall(ctx.messageId, call.id, {
            status: "applied",
            summary: "Nothing to undo."
        });
        return;
    }
    entry.revert();
    copilot.markUndone(entry.id);
    copilot.updateToolCall(ctx.messageId, call.id, {
        status: "applied",
        summary: `Reverted: ${entry.label}.`
    });
};

/**
 * Dispatch: validate args (defensive — server validates too), then run the
 * matching tool. Updates the tool card's status/summary/error in copilot store.
 * Defensive failure mode: model-facing error mapped to a friendly user message.
 */
export const executeToolCall = async (call: ParsedToolCall, ctx: ExecutorContext): Promise<void> => {
    const fail = (message: string) =>
        copilot.updateToolCall(ctx.messageId, call.id, { status: "failed", error: message });

    if (!isKnownToolName(call.name)) {
        fail("The Copilot tried an action that isn't available. Please rephrase your request.");
        return;
    }

    const parsed = argSchemas[call.name].safeParse(call.args ?? {});
    if (!parsed.success) {
        fail("The Copilot couldn't complete that action. Please try rephrasing your request.");
        return;
    }
    const data = parsed.data;

    try {
        switch (call.name) {
            case "getBatchSummary":
                runGetBatchSummary(call, ctx);
                break;
            case "getRows":
                runGetRows(call, ctx, data as ArgsOf<"getRows">);
                break;
            case "flagAnomalies":
                runFlagAnomalies(call, ctx);
                break;
            case "editCells":
                await runEditCells(call, ctx, data as ArgsOf<"editCells">);
                break;
            case "setBatchDefaults":
                await runSetBatchDefaults(call, ctx, data as ArgsOf<"setBatchDefaults">);
                break;
            case "addRows":
                await runAddRows(call, ctx, data as ArgsOf<"addRows">);
                break;
            case "deleteRows":
                await runDeleteRows(call, ctx, data as ArgsOf<"deleteRows">);
                break;
            case "autoFixWarnings":
                await runAutoFixWarnings(call, ctx, data as ArgsOf<"autoFixWarnings">);
                break;
            case "updateBrandSettings":
                runUpdateBrandSettings(call, ctx, data as ArgsOf<"updateBrandSettings">);
                break;
            case "proposeCsvColumnMapping":
                await runProposeCsvColumnMapping(call, ctx, data as ArgsOf<"proposeCsvColumnMapping">);
                break;
            case "undoLastChange":
                runUndoLastChange(call, ctx);
                break;
        }
    } catch (err) {
        fail(err instanceof Error ? err.message : "Tool execution failed");
    }
};

export { READ_ONLY_TOOLS };
