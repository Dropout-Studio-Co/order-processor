/**
 * Anomaly detectors for batch delivery-risk rows. Output feeds:
 *   - `flagAnomalies` tool result
 *   - executor.ts confirmation panels (warnings before a mutation applies)
 * Thresholds are conservative defaults — tune against real batch distributions.
 */
import type { SteadFastOrder } from "#lib/types/index.js";
import { normalizePhoneNumber } from "#lib/utils/index.js";
import type { AnomalyResult } from "./types";

const AMOUNT_OUTLIER_MIN_SAMPLES = 4;
const AMOUNT_OUTLIER_LOW = 0.2;
const AMOUNT_OUTLIER_HIGH = 5;
const MIN_ADDRESS_LENGTH = 18;

// English + Bengali cancellation/return phrasing.
const CANCELLATION_RE =
    /\b(cancel(?:led|ed)?|return(?:ed)?|refund|do not (?:deliver|send)|hold)\b|বাতিল|ফেরত|হোল্ড|ক্যান্সেল/iu;

const median = (nums: number[]): number => {
    if (nums.length === 0) return 0;
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
    }
    return sorted[mid] ?? 0;
};

/** Runs all detectors. One row may yield multiple AnomalyResult entries. */
export const detectAnomalies = (rows: SteadFastOrder[]): AnomalyResult[] => {
    const out: AnomalyResult[] = [];

    // Amount outliers vs batch median; needs >= AMOUNT_OUTLIER_MIN_SAMPLES to avoid false positives on small batches.
    const amounts: number[] = [];
    for (const row of rows) {
        const n = Number.parseFloat(row.Amount);
        if (Number.isFinite(n) && n > 0) amounts.push(n);
    }
    const med = median(amounts);
    if (amounts.length >= AMOUNT_OUTLIER_MIN_SAMPLES && med > 0) {
        rows.forEach((row, i) => {
            const n = Number.parseFloat(row.Amount);
            if (!Number.isFinite(n) || n <= 0) return;
            if (n < med * AMOUNT_OUTLIER_LOW || n > med * AMOUNT_OUTLIER_HIGH) {
                out.push({
                    kind: "amount_outlier",
                    rowIndex: i,
                    reason: `Amount ${n} is far from the batch median of ${med} — verify it.`
                });
            }
        });
    }

    rows.forEach((row, i) => {
        const addr = (row.Address ?? "").trim();
        if (addr.length > 0 && addr.length < MIN_ADDRESS_LENGTH) {
            out.push({
                kind: "short_address",
                rowIndex: i,
                reason: `Address is only ${addr.length} characters — likely missing the area or thana.`
            });
        }
    });

    rows.forEach((row, i) => {
        if (row.Note && CANCELLATION_RE.test(row.Note)) {
            out.push({
                kind: "cancellation_language",
                rowIndex: i,
                reason: "Note mentions cancellation/return language — confirm before dispatching."
            });
        }
    });

    // BD mobile contract: normalized number must match /^1\d{9}$/ — anything else is landline/malformed.
    rows.forEach((row, i) => {
        const norm = normalizePhoneNumber(row.Phone ?? "");
        if (norm.length > 0 && !/^1\d{9}$/.test(norm)) {
            out.push({
                kind: "landline_phone",
                rowIndex: i,
                reason: `Phone "${row.Phone}" is not a deliverable Bangladesh mobile (landline or malformed).`
            });
        }
    });

    // Dedup keyed on normalized phone; flags every row after the first occurrence.
    const seen = new Map<string, number>();
    rows.forEach((row, i) => {
        const norm = normalizePhoneNumber(row.Phone ?? "");
        if (!norm) return;
        const firstIdx = seen.get(norm);
        if (firstIdx === undefined) {
            seen.set(norm, i);
            return;
        }
        out.push({
            kind: "duplicate_recipient",
            rowIndex: i,
            reason: `Same phone as row ${firstIdx + 1} (${rows[firstIdx]?.Name || "unnamed"}) — possible duplicate order.`
        });
    });

    return out;
};
