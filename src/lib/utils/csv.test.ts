import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isShopifyExport } from "$lib/services/data-processing";
import { parseCSV } from "./csv";

/**
 * PapaParse's File path needs a browser `FileReader`. Node has `File`/`Blob` but
 * no reader, so tests shim the single method Papa calls (`readAsText`) instead of
 * changing the production parser or pulling in a DOM environment.
 */
class TestFileReader {
    onload: ((event: { target: { result: string } }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;

    readAsText(blob: Blob): void {
        blob.text().then(
            (text) => this.onload?.({ target: { result: text } }),
            () => this.onerror?.({})
        );
    }
}

const hadFileReader = "FileReader" in globalThis;

beforeAll(() => {
    (globalThis as { FileReader?: unknown }).FileReader = TestFileReader;
});

afterAll(() => {
    if (!hadFileReader) delete (globalThis as { FileReader?: unknown }).FileReader;
});

const parse = (csv: string) => parseCSV(new File([csv], "orders.csv", { type: "text/csv" }));

const SHOPIFY_HEADER = ["Name", "Email", "Shipping Name", "Billing Name", "Financial Status"];

describe("parseCSV", () => {
    it("keeps header mode off so rows stay positional", async () => {
        const result = await parse(`${SHOPIFY_HEADER.join(",")}\n#1001,a@b.co,Ship,Bill,paid`);

        expect(result.data[0]).toEqual(SHOPIFY_HEADER);
        expect(result.data).toHaveLength(2);
        expect(result.errors).toEqual([]);
    });

    it("parses quoted fields containing commas", async () => {
        const result = await parse(`Name,Address\n#1001,"House 12, Road 5, Dhaka"`);

        expect(result.data[1]?.[1]).toBe("House 12, Road 5, Dhaka");
        expect(result.data).toHaveLength(2);
    });

    it("parses quoted fields containing newlines as one cell", async () => {
        const result = await parse(`Name,Note\n#1001,"first line\nsecond line"\n#1002,plain`);

        expect(result.data).toHaveLength(3);
        expect(result.data[1]?.[1]).toBe("first line\nsecond line");
        expect(result.data[2]).toEqual(["#1002", "plain"]);
    });

    it("unescapes doubled quotes", async () => {
        const result = await parse(`Name,Note\n#1001,"He said ""delivered"" today"`);

        expect(result.data[1]?.[1]).toBe('He said "delivered" today');
    });

    it("detects CRLF and leaves no carriage returns in cells", async () => {
        const result = await parse("Name,Amount\r\n#1001,1500\r\n");

        expect(result.meta.linebreak).toBe("\r\n");
        expect(result.data[1]).toEqual(["#1001", "1500"]);
        expect(result.data.every((row) => row.every((cell) => !cell.includes("\r")))).toBe(true);
    });

    it("strips a UTF-8 BOM so the first header cell stays clean", async () => {
        const result = await parse(`\uFEFF${SHOPIFY_HEADER.join(",")}\n#1001,a@b.co,Ship,Bill,paid`);

        expect(result.data[0]?.[0]).toBe("Name");
        expect(isShopifyExport(result.data[0] ?? [])).toBe(true);
    });

    it("strips a UTF-8 BOM for string input too", async () => {
        const result = await parseCSV("\uFEFFName,Amount\n#1001,1500");

        expect(result.data[0]).toEqual(["Name", "Amount"]);
    });

    it("keeps a trailing blank row when the file ends with a newline", async () => {
        const result = await parse("Name,Amount\n#1001,1500\n");

        expect(result.data).toHaveLength(3);
        expect(result.data[2]).toEqual([""]);
    });

    it("keeps blank lines between records", async () => {
        const result = await parse("Name,Amount\n\n#1001,1500");

        expect(result.data[1]).toEqual([""]);
        expect(result.data[2]).toEqual(["#1001", "1500"]);
    });

    it("does not trim cell whitespace (trimming happens downstream)", async () => {
        const result = await parse('Name,Address\n#1001,"  Road 5 , Dhaka  "');

        expect(result.data[1]?.[1]).toBe("  Road 5 , Dhaka  ");
    });

    it("preserves unicode names and notes", async () => {
        const result = await parse("Name,Note\n#1001,মোহাম্মদ আলী — José Álvarez");

        expect(result.data[1]?.[1]).toBe("মোহাম্মদ আলী — José Álvarez");
    });

    it("returns no rows for an empty file and surfaces the delimiter diagnostic", async () => {
        const result = await parse("");

        expect(result.data).toEqual([]);
        expect(result.meta.delimiter).toBe(",");
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]?.code).toBe("UndetectableDelimiter");
    });

    it("flags a single-column file as having no detectable delimiter", async () => {
        const result = await parse("Name\n#1001\n#1002");

        expect(result.data).toEqual([["Name"], ["#1001"], ["#1002"]]);
        expect(result.errors.map((error) => error.code)).toEqual(["UndetectableDelimiter"]);
    });
});
