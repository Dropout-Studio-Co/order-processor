import { describe, expect, it } from "vitest";
import { generateFileName } from "./files";

describe("generateFileName", () => {
    it("builds the download name from the courier enum name", () => {
        expect(generateFileName("SteadFast")).toBe("formatted-orders-steadfast.xlsx");
    });

    it("lowercases the courier segment", () => {
        expect(generateFileName("STEADFAST")).toBe("formatted-orders-steadfast.xlsx");
    });
});
