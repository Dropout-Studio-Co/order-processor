import { describe, expect, it } from "vitest";
import { processOrders } from "./courier-service";
import { parseCSV } from "#lib/utils/csv.js";
import type { UserInfo } from "#lib/types/index.js";

const user: UserInfo = {
    name: "Dhaka Store",
    phone: "01711111111",
    merchantId: "merchant-42"
};

const WIDTH = 46;

interface RowInput {
    order: string;
    name?: string;
    address1?: string;
    address2?: string;
    city?: string;
    phone?: string;
    total?: string;
    note?: string;
}

const row = ({
    order,
    name = "Rahim Uddin",
    address1 = "House 12, Road 5",
    address2 = "Mirpur",
    city = "Dhaka",
    phone = "01712345678",
    total = "1500.00",
    note = ""
}: RowInput): string[] => {
    const cells = Array.from({ length: WIDTH }, () => "");
    cells[0] = order;
    cells[11] = total;
    cells[34] = name;
    cells[36] = address1;
    cells[37] = address2;
    cells[39] = city;
    cells[43] = phone;
    cells[44] = note;
    return cells;
};

const header = (): string[] => {
    const cells = Array.from({ length: WIDTH }, () => "");
    cells[0] = "Name";
    cells[1] = "Email";
    cells[2] = "Financial Status";
    cells[34] = "Shipping Name";
    cells[35] = "Billing Name";
    return cells;
};

describe("processOrders", () => {
    it("maps a Shopify export to the SteadFast fields", () => {
        const orders = processOrders([header(), row({ order: "#1001", note: "Gift wrap" })], user);

        expect(orders).toHaveLength(1);
        expect(orders[0]).toEqual({
            Invoice: "merchant-42",
            Name: "Rahim Uddin",
            Address: "House 12, Road 5, Mirpur, Dhaka",
            Phone: "1712345678",
            Amount: "1500.00",
            Note: "Gift wrap",
            Lot: "",
            "Delivery Type": "Home",
            "Contact Name": "Dhaka Store",
            "Contact Phone": "01711111111"
        });
    });

    it("normalizes local, +880 and punctuated phone spellings", () => {
        const phones = ["01712345678", "+8801712345678", "880-1712-345678", " 01712 345 678 "];
        const orders = processOrders(
            [header(), ...phones.map((phone, index) => row({ order: `#100${index}`, phone }))],
            user
        );

        expect(orders.map((order) => order.Phone)).toEqual(["1712345678", "1712345678", "1712345678", "1712345678"]);
    });

    it("collapses line items into one order each", () => {
        const orders = processOrders(
            [
                header(),
                row({ order: "#1001" }),
                row({ order: "#1001" }),
                row({ order: "#1002", name: "Karim Ahmed" }),
                row({ order: "#1002", name: "Karim Ahmed" })
            ],
            user
        );

        expect(orders).toHaveLength(2);
        expect(orders.map((order) => order.Name)).toEqual(["Rahim Uddin", "Karim Ahmed"]);
    });

    it("keeps unicode recipient names and notes intact", () => {
        const orders = processOrders(
            [header(), row({ order: "#1001", name: "মোহাম্মদ আলী", note: "দুপুরের আগে" })],
            user
        );

        expect(orders[0]?.Name).toBe("মোহাম্মদ আলী");
        expect(orders[0]?.Note).toBe("দুপুরের আগে");
    });

    it("falls back to the legacy path for non-Shopify headers", () => {
        const orders = processOrders(
            [row({ order: "Order" }), row({ order: "#1001", total: "999" }), row({ order: "Total" })],
            user
        );

        expect(orders).toHaveLength(1);
        expect(orders[0]?.Amount).toBe("999");
    });

    it("leaves the contact phone blank when the merchant has not set one", () => {
        const orders = processOrders([header(), row({ order: "#1001" })], {
            name: "Dhaka Store",
            phone: "",
            merchantId: "merchant-42"
        });

        expect(orders[0]?.["Contact Phone"]).toBe("");
    });

    it("returns no orders for an empty or header-only export", () => {
        expect(processOrders([], user)).toEqual([]);
        expect(processOrders([header()], user)).toEqual([]);
    });
});

describe("CSV → SteadFast pipeline", () => {
    const toCsv = (rows: string[][]): string =>
        rows
            .map((cells) =>
                cells.map((cell) => (/[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell)).join(",")
            )
            .join("\r\n");

    it("detects a Shopify export and maps it end to end", async () => {
        const csv = toCsv([
            header(),
            row({ order: "#2001", name: "Nusrat Jahan", address2: "Uttara", phone: "+880 1812-345678" }),
            row({ order: "#2002", name: "Tanvir Hasan", address1: 'Plot "A", Sector 7', city: "Chattogram" }),
            row({ order: "#2002", name: "Tanvir Hasan", address1: 'Plot "A", Sector 7', city: "Chattogram" })
        ]);

        const parsed = await parseCSV(csv);
        const orders = processOrders(parsed.data, user);

        expect(parsed.errors).toEqual([]);
        expect(orders).toHaveLength(2);
        expect(orders.map((order) => [order.Name, order.Address, order.Phone])).toEqual([
            ["Nusrat Jahan", "House 12, Road 5, Uttara, Dhaka", "1812345678"],
            ["Tanvir Hasan", 'Plot "A", Sector 7, Mirpur, Chattogram', "1712345678"]
        ]);
        expect(orders.every((order) => order.Invoice === "merchant-42")).toBe(true);
    });
});
