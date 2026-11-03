import { describe, expect, it } from "vitest";
import type { SteadFastOrder } from "#lib/types/index.js";
import { validateAmount, validateRow } from "./validate";

const makeRow = (overrides: Partial<SteadFastOrder> = {}): SteadFastOrder => ({
    Invoice: "merchant-1",
    Name: "Rahim Uddin",
    Address: "House 12, Road 5, Dhaka",
    Phone: "1712345678",
    Amount: "1500.00",
    Note: "",
    Lot: "",
    "Delivery Type": "Home",
    "Contact Name": "Merchant",
    "Contact Phone": "1711111111",
    ...overrides
});

describe("validateAmount", () => {
    it("accepts positive integers and decimals", () => {
        expect(validateAmount("1500")).toBe(true);
        expect(validateAmount("1500.00")).toBe(true);
        expect(validateAmount("0.5")).toBe(true);
        expect(validateAmount(" 1500 ")).toBe(true);
    });

    it("rejects blank, signed, grouped or non-numeric amounts", () => {
        expect(validateAmount("")).toBe(false);
        expect(validateAmount("-5")).toBe(false);
        expect(validateAmount("1,200")).toBe(false); // thousands separators are not stripped
        expect(validateAmount("12.3.4")).toBe(false);
        expect(validateAmount("BDT 1500")).toBe(false);
        expect(validateAmount(".")).toBe(false);
    });
});

describe("validateRow", () => {
    it("reports no warnings for a complete order", () => {
        expect(validateRow(makeRow(), 0)).toEqual([]);
    });

    it("flags every empty required column with its row index", () => {
        const warnings = validateRow(makeRow({ Name: "", Address: "  ", Phone: "", Amount: "" }), 3);

        expect(warnings).toHaveLength(4);
        expect(warnings.map((warning) => warning.column)).toEqual(["Name", "Address", "Phone", "Amount"]);
        expect(warnings.every((warning) => warning.code === "empty")).toBe(true);
        expect(warnings.every((warning) => warning.rowIndex === 3)).toBe(true);
        expect(warnings[0]?.message).toBe("Name is empty");
    });

    it("does not double-report a blank phone as a format error", () => {
        const warnings = validateRow(makeRow({ Phone: "" }), 1);

        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatchObject({ column: "Phone", code: "empty" });
    });

    it("reports an unparseable phone as phone_format", () => {
        const warnings = validateRow(makeRow({ Phone: "12345" }), 2);

        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatchObject({
            rowIndex: 2,
            column: "Phone",
            code: "phone_format",
            message: "Phone is not a valid Bangladesh mobile number"
        });
    });

    it("reports a non-numeric amount as amount_format", () => {
        const warnings = validateRow(makeRow({ Amount: "twelve hundred" }), 4);

        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatchObject({
            rowIndex: 4,
            column: "Amount",
            code: "amount_format",
            message: "Amount is not a valid number"
        });
    });

    it("ignores optional columns and batch constants", () => {
        const warnings = validateRow(
            makeRow({ Note: "", Invoice: "", Lot: "", "Delivery Type": "", "Contact Name": "", "Contact Phone": "" }),
            0
        );

        expect(warnings).toEqual([]);
    });

    it("collects empty and format warnings together", () => {
        const warnings = validateRow(makeRow({ Name: "", Phone: "0000", Amount: "1,200" }), 5);

        expect(warnings.map((warning) => warning.code)).toEqual(["empty", "phone_format", "amount_format"]);
    });
});
