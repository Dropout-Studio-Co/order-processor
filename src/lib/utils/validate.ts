import type { SteadFastOrder } from "#lib/types/index.js";
import type { CellColumn } from "#lib/components/features/output-editor/columns.js";
import { normalizePhoneNumber } from "./phone";

export type WarningCode = "empty" | "phone_format" | "amount_format";

export interface CellWarning {
    rowIndex: number;
    column: CellColumn;
    code: WarningCode;
    message: string;
}

// Valid BD mobile = exactly /^1\d{9}$/ after normalizePhoneNumber. Empty values
// are reported as `empty`, not `phone_format` — caller pre-filters blanks.
export const validatePhone = (value: string): boolean => {
    const normalized = normalizePhoneNumber(value);
    return /^1\d{9}$/.test(normalized);
};

// Positive decimal only. Blank values are reported as `empty` by the caller.
export const validateAmount = (value: string): boolean => {
    if (!value) return false;
    return /^\d+(\.\d+)?$/.test(value.trim());
};

const REQUIRED_COLUMNS: readonly CellColumn[] = ["Name", "Address", "Phone", "Amount"];

export const validateRow = (row: SteadFastOrder, rowIndex: number): CellWarning[] => {
    const warnings: CellWarning[] = [];

    for (const column of REQUIRED_COLUMNS) {
        const value = (row[column as keyof SteadFastOrder] ?? "").toString().trim();
        if (!value) {
            warnings.push({
                rowIndex,
                column,
                code: "empty",
                message: `${column} is empty`
            });
        }
    }

    const phone = (row.Phone ?? "").toString().trim();
    if (phone && !validatePhone(phone)) {
        warnings.push({
            rowIndex,
            column: "Phone",
            code: "phone_format",
            message: "Phone is not a valid Bangladesh mobile number"
        });
    }

    const amount = (row.Amount ?? "").toString().trim();
    if (amount && !validateAmount(amount)) {
        warnings.push({
            rowIndex,
            column: "Amount",
            code: "amount_format",
            message: "Amount is not a valid number"
        });
    }

    return warnings;
};
