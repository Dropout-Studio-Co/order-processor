import { describe, expect, it } from "vitest";
import { isShopifyExport, prepareShopifySteadFastOrderData, prepareSteadFastOrderData } from "./data-processing";

// Shopify's export column indexes that the pipeline depends on (see warnings #5
// in the project reference): 34 Shipping Name, 36/37/39 address parts, 43 Phone,
// 11 Total, 44 Notes. Rows are padded so the positional mapping is exercised
// exactly as PapaParse hands it over.
const SHOPIFY_WIDTH = 46;

interface ShopifyRowInput {
    order: string;
    name?: string;
    address1?: string;
    address2?: string;
    city?: string;
    phone?: string;
    total?: string;
    note?: string;
}

const shopifyRow = ({
    order,
    name = "Rahim Uddin",
    address1 = "House 12, Road 5",
    address2 = "Mirpur",
    city = "Dhaka",
    phone = "01712345678",
    total = "1500.00",
    note = ""
}: ShopifyRowInput): string[] => {
    const row = Array.from({ length: SHOPIFY_WIDTH }, () => "");
    row[0] = order;
    row[11] = total;
    row[34] = name;
    row[36] = address1;
    row[37] = address2;
    row[39] = city;
    row[43] = phone;
    row[44] = note;
    return row;
};

const shopifyHeader = (): string[] => {
    const header = Array.from({ length: SHOPIFY_WIDTH }, () => "");
    header[0] = "Name";
    header[1] = "Email";
    header[2] = "Financial Status";
    header[34] = "Shipping Name";
    header[35] = "Billing Name";
    return header;
};

const SHOPIFY_HEADER = shopifyHeader();

describe("isShopifyExport", () => {
    it("accepts the Shopify header set", () => {
        expect(isShopifyExport(["Name", "Email", "Shipping Name", "Billing Name", "Financial Status"])).toBe(true);
        expect(isShopifyExport(["#", "Name", "email", "SHIPPING NAME", "billing name", "financial status"])).toBe(true);
    });

    it("rejects legacy and partial headers", () => {
        expect(isShopifyExport(["Order", "Customer", "Total"])).toBe(false);
        expect(isShopifyExport(["Name", "Email", "Shipping Name"])).toBe(false);
        expect(isShopifyExport([])).toBe(false);
        // Extra columns are allowed; only the fixed set must be present.
        expect(isShopifyExport(["Name", "Email", "Shipping Name", "Billing Name", "Financial Status", "Tags"])).toBe(
            true
        );
    });
});

describe("prepareShopifySteadFastOrderData", () => {
    it("maps Shopify column indexes to [Name, Address, Phone, Amount, Note]", () => {
        const rows = prepareShopifySteadFastOrderData([
            SHOPIFY_HEADER,
            shopifyRow({ order: "#1001", note: "Call before delivery" })
        ]);

        expect(rows).toEqual([
            ["Rahim Uddin", "House 12, Road 5, Mirpur, Dhaka", "01712345678", "1500.00", "Call before delivery"]
        ]);
    });

    it("collapses repeated line items into one row per order", () => {
        const rows = prepareShopifySteadFastOrderData([
            SHOPIFY_HEADER,
            shopifyRow({ order: "#1001" }),
            shopifyRow({ order: "#1001", total: "1500.00" }),
            shopifyRow({ order: "#1001", total: "1500.00" }),
            shopifyRow({ order: "#1002", name: "Karim Ahmed" })
        ]);

        expect(rows).toHaveLength(2);
        expect(rows.map((row) => row[0])).toEqual(["Rahim Uddin", "Karim Ahmed"]);
    });

    it("keeps the first line item's values and the original order", () => {
        const rows = prepareShopifySteadFastOrderData([
            SHOPIFY_HEADER,
            shopifyRow({ order: "#1002", name: "First Seen" }),
            shopifyRow({ order: "#1001", name: "Other Order" }),
            shopifyRow({ order: "#1002", name: "Later Line Item" })
        ]);

        expect(rows.map((row) => row[0])).toEqual(["First Seen", "Other Order"]);
    });

    it("joins address parts, trimming each and skipping blanks", () => {
        const withBlank = prepareShopifySteadFastOrderData([
            SHOPIFY_HEADER,
            shopifyRow({ order: "#1001", address1: "  House 12 ", address2: "", city: "  Dhaka  " })
        ]);
        const allBlank = prepareShopifySteadFastOrderData([
            SHOPIFY_HEADER,
            shopifyRow({ order: "#1001", address1: "", address2: "", city: "" })
        ]);

        expect(withBlank[0]?.[1]).toBe("House 12, Dhaka");
        expect(allBlank[0]?.[1]).toBe("");
    });

    it("skips rows without a #-prefixed order number or without a shipping name", () => {
        const rows = prepareShopifySteadFastOrderData([
            SHOPIFY_HEADER,
            shopifyRow({ order: "1001" }), // no leading #
            shopifyRow({ order: "#1002", name: "" }), // no recipient
            shopifyRow({ order: "#1003", name: "Kept" })
        ]);

        expect(rows).toHaveLength(1);
        expect(rows[0]?.[0]).toBe("Kept");
    });

    it("returns nothing for a header-only file", () => {
        expect(prepareShopifySteadFastOrderData([SHOPIFY_HEADER])).toEqual([]);
        expect(prepareShopifySteadFastOrderData([])).toEqual([]);
    });

    it("preserves unicode names and notes", () => {
        const rows = prepareShopifySteadFastOrderData([
            SHOPIFY_HEADER,
            shopifyRow({ order: "#1001", name: "মোহাম্মদ আলী", note: "দুপুরে ডেলিভারি" })
        ]);

        expect(rows[0]?.[0]).toBe("মোহাম্মদ আলী");
        expect(rows[0]?.[4]).toBe("দুপুরে ডেলিভারি");
    });
});

describe("prepareSteadFastOrderData (legacy)", () => {
    const legacyRow = (order: string, amount = "1500") => shopifyRow({ order, total: amount });

    it("drops the header row and the trailing totals row", () => {
        const rows = prepareSteadFastOrderData([legacyRow("Order"), legacyRow("#1001"), legacyRow("Total: 1500")]);

        expect(rows).toHaveLength(1);
        expect(rows[0]?.[3]).toBe("1500");
    });

    it("dedups by the first column", () => {
        const rows = prepareSteadFastOrderData([
            legacyRow("Order"),
            legacyRow("#1001", "100"),
            legacyRow("#1001", "100"),
            legacyRow("#1002", "200"),
            legacyRow("Total")
        ]);

        expect(rows).toHaveLength(2);
        expect(rows.map((row) => row[3])).toEqual(["100", "200"]);
    });

    it("skips rows with an empty first column", () => {
        const rows = prepareSteadFastOrderData([
            legacyRow("Order"),
            legacyRow(""),
            legacyRow("#1001"),
            legacyRow("Total")
        ]);

        expect(rows.map((row) => row[3])).toEqual(["1500"]);
    });

    it("returns nothing when there is no room for a header and a data row", () => {
        expect(prepareSteadFastOrderData([])).toEqual([]);
        expect(prepareSteadFastOrderData([legacyRow("Order")])).toEqual([]);
        expect(prepareSteadFastOrderData([legacyRow("Order"), legacyRow("#1001")])).toEqual([]);
    });

    it("applies the same column mapping as the Shopify path", () => {
        const rows = prepareSteadFastOrderData([
            legacyRow("Order"),
            shopifyRow({ order: "#1001", address1: "Road 1", address2: "Block B", city: "Chattogram" }),
            legacyRow("Total")
        ]);

        expect(rows[0]).toEqual(["Rahim Uddin", "Road 1, Block B, Chattogram", "01712345678", "1500.00", ""]);
    });
});
