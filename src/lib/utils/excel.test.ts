import { describe, expect, it } from "vitest";
import type { SteadFastOrder } from "$lib/types";
import { buildWorkbook } from "./excel";

const order = (overrides: Partial<SteadFastOrder> = {}): SteadFastOrder => ({
    Invoice: "merchant-42",
    Name: "Rahim Uddin",
    Address: "House 12, Road 5, Dhaka",
    Phone: "1712345678",
    Amount: "1500.00",
    Note: "",
    Lot: "",
    "Delivery Type": "Home",
    "Contact Name": "Dhaka Store",
    "Contact Phone": "1711111111",
    ...overrides
});

const EXPECTED_HEADERS = [
    "Invoice",
    "Name",
    "Address",
    "Phone",
    "Amount",
    "Note",
    "Lot",
    "Delivery Type",
    "Contact Name",
    "Contact Phone"
];

describe("buildWorkbook", () => {
    it("creates a single sheet with the requested name", () => {
        const workbook = buildWorkbook([order()], "SteadFast");

        expect(workbook.SheetNames).toEqual(["SteadFast"]);
        expect(workbook.Sheets["SteadFast"]).toBeDefined();
    });

    it("defaults the sheet name to Sheet1", () => {
        expect(buildWorkbook([order()]).SheetNames).toEqual(["Sheet1"]);
    });

    it("writes the SteadFast header row in schema order", () => {
        const sheet = buildWorkbook([order()]).Sheets["Sheet1"];

        const headers = EXPECTED_HEADERS.map((_, index) => sheet?.[`${String.fromCharCode(65 + index)}1`]?.v);

        expect(headers).toEqual(EXPECTED_HEADERS);
        expect(sheet?.["K1"]).toBeUndefined();
    });

    it("addresses the full used range for one row plus header", () => {
        expect(buildWorkbook([order()]).Sheets["Sheet1"]?.["!ref"]).toBe("A1:J2");
    });

    it("addresses the full used range for many rows", () => {
        const workbook = buildWorkbook([order(), order({ Name: "Karim Ahmed" }), order({ Name: "Nusrat Jahan" })]);

        expect(workbook.Sheets["Sheet1"]?.["!ref"]).toBe("A1:J4");
    });

    it("writes one row per order with the mapped values", () => {
        const sheet = buildWorkbook([order({ Note: "Call first" })], "Orders").Sheets["Orders"];

        expect(["A2", "B2", "C2", "D2", "E2", "F2"].map((cell) => sheet?.[cell]?.v)).toEqual([
            "merchant-42",
            "Rahim Uddin",
            "House 12, Road 5, Dhaka",
            "1712345678",
            "1500.00",
            "Call first"
        ]);
        expect(sheet?.["H2"]?.v).toBe("Home");
    });

    it("keeps amounts and phone numbers as text cells (no numeric coercion or data loss)", () => {
        const sheet = buildWorkbook([order({ Amount: "01500.00" })], "Orders").Sheets["Orders"];

        expect(sheet?.["E2"]).toMatchObject({ t: "s", v: "01500.00" });
        expect(sheet?.["D2"]).toMatchObject({ t: "s", v: "1712345678" });
    });

    it("preserves unicode and multi-line cell content", () => {
        const sheet = buildWorkbook([order({ Name: "মোহাম্মদ আলী", Note: "line one\nline two" })], "Orders").Sheets[
            "Orders"
        ];

        expect(sheet?.["B2"]?.v).toBe("মোহাম্মদ আলী");
        expect(sheet?.["F2"]?.v).toBe("line one\nline two");
    });

    it("produces a sheet for an empty batch without throwing", () => {
        const workbook = buildWorkbook([] as SteadFastOrder[]);

        expect(workbook.SheetNames).toHaveLength(1);
        expect(workbook.Sheets["Sheet1"]).toBeDefined();
    });
});
