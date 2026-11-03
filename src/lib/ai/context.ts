/**
 * Renders editor + brand state into the CURRENT STATE block shipped to the
 * stateless chat endpoint each turn. Row listing capped at MAX_LISTED_ROWS to
 * stay under the model context limit; the model uses getRows() to inspect more.
 */
import type { BrandSettingsState } from "#lib/types/index.js";
import type { EditorController, RawCsv } from "./types";

const MAX_LISTED_ROWS = 60;

const truncate = (value: string, max: number): string => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

// Indexed headers + 2 sample rows — supplies the model with the data it needs
// to call proposeCsvColumnMapping correctly for unrecognized layouts.
const renderRawCsv = (raw: RawCsv): string => {
    const lines: string[] = [
        "",
        "RAW CSV (uploaded file — use proposeCsvColumnMapping if the batch above looks wrong):"
    ];
    lines.push(`Columns (${raw.headers.length}): ${raw.headers.map((h, i) => `[${i}] ${h || "(blank)"}`).join(" · ")}`);
    raw.rows.slice(0, 2).forEach((row, i) => {
        lines.push(`Sample row ${i}: ${row.map((c, ci) => `[${ci}]${truncate(c, 24)}`).join(" · ")}`);
    });
    return lines.join("\n");
};

export const projectBatchState = (
    editor: EditorController | null,
    brand: BrandSettingsState,
    rawCsv: RawCsv | null = null,
    undoAvailable = false
): string => {
    const brandLine = `Brand settings: contactName=${brand.contactName ?? "(unset)"}, contactPhone=${brand.contactPhone ?? "(unset)"}, merchantId=${brand.merchantId ?? "(unset)"}.`;
    const rawSuffix = rawCsv ? renderRawCsv(rawCsv) : "";

    if (!editor) {
        return (
            [
                "No CSV batch is loaded — the output editor is not open.",
                brandLine,
                "Grid tools (editCells, addRows, etc.) cannot run yet. Guide the user to pick a courier, set a Merchant ID if it is unset, and upload a Shopify order CSV."
            ].join("\n") + rawSuffix
        );
    }

    const rows = editor.getRows();
    const defaults = editor.getDefaults();
    const warnings = editor.getWarnings();

    const warningsByRow = new Map<number, string[]>();
    for (const w of warnings) {
        const list = warningsByRow.get(w.rowIndex) ?? [];
        list.push(w.code);
        warningsByRow.set(w.rowIndex, list);
    }

    let total = 0;
    let collectCount = 0;
    for (const row of rows) {
        const amount = Number.parseFloat(row.Amount);
        if (Number.isFinite(amount)) {
            total += amount;
            if (amount > 0) collectCount++;
        }
    }

    const lines: string[] = [];
    lines.push(`Batch: ${rows.length} row${rows.length === 1 ? "" : "s"}, output file "${editor.getFileName()}".`);
    lines.push(
        `Batch defaults: Invoice="${defaults.Invoice}", Contact Name="${defaults["Contact Name"]}", Contact Phone="${defaults["Contact Phone"]}", Delivery Type="${defaults["Delivery Type"]}", Lot="${defaults.Lot}".`
    );
    lines.push(brandLine);
    lines.push(
        `Totals: Amount sum=${total}, ${collectCount} row(s) with a collection amount, ${rows.length - collectCount} with amount 0 or blank.`
    );
    lines.push(`Validation: ${warnings.length} warning(s) across ${warningsByRow.size} row(s).`);
    if (undoAvailable) {
        lines.push("A change you applied earlier this session can still be reverted with undoLastChange.");
    }

    if (rows.length === 0) {
        lines.push("The grid is empty — add rows with addRows or tell the user to add them manually.");
        return lines.join("\n") + rawSuffix;
    }

    lines.push("Rows (index · Name · Phone · Amount · Address · Note · warnings):");
    const shown = Math.min(rows.length, MAX_LISTED_ROWS);
    for (let i = 0; i < shown; i++) {
        const row = rows[i];
        if (!row) continue;
        const codes = warningsByRow.get(i);
        const note = row.Note ? truncate(row.Note, 30) : "—";
        const warnText = codes ? ` · ⚠ ${codes.join(",")}` : "";
        lines.push(
            `  ${i} · ${row.Name || "(empty)"} · ${row.Phone || "(empty)"} · ${row.Amount || "(empty)"} · ${truncate(row.Address || "(empty)", 50)} · ${note}${warnText}`
        );
    }
    if (rows.length > shown) {
        lines.push(`  …and ${rows.length - shown} more row(s) — use getRows with indexes to inspect them.`);
    }

    return lines.join("\n") + rawSuffix;
};
