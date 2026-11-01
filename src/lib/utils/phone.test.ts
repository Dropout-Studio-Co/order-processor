import { describe, expect, it } from "vitest";
import { normalizePhoneNumber } from "./phone";
import { validatePhone } from "./validate";

/**
 * BD mobile normalisation contract (NFR-14): strip formatting, `+`, trunk `0`
 * and the `880` country code, leaving a bare 10-digit number starting with `1`.
 */
describe("normalizePhoneNumber", () => {
    it("strips the +880 country code", () => {
        expect(normalizePhoneNumber("+8801712345678")).toBe("1712345678");
        expect(normalizePhoneNumber("8801712345678")).toBe("1712345678");
    });

    it("strips the trunk zero of a local number", () => {
        expect(normalizePhoneNumber("01712345678")).toBe("1712345678");
    });

    it("strips spaces, dashes and parentheses", () => {
        expect(normalizePhoneNumber("01712-345678")).toBe("1712345678");
        expect(normalizePhoneNumber("01712 345 678")).toBe("1712345678");
        expect(normalizePhoneNumber("(+880) 1712-345678")).toBe("1712345678");
        expect(normalizePhoneNumber(" +880 1712 345 678 ")).toBe("1712345678");
    });

    it("drops any other non-digit character", () => {
        expect(normalizePhoneNumber("tel:01712345678")).toBe("1712345678");
        expect(normalizePhoneNumber("01712345678 ext")).toBe("1712345678");
    });

    it("returns an empty string for blank or digit-free input", () => {
        expect(normalizePhoneNumber("")).toBe("");
        expect(normalizePhoneNumber("   ")).toBe("");
        expect(normalizePhoneNumber("n/a")).toBe("");
        expect(normalizePhoneNumber(undefined as unknown as string)).toBe("");
    });

    it("is idempotent for every supported input form (NFR-14)", () => {
        const inputs = ["+8801712345678", "8801712345678", "01712345678", "01712-345678", "", "abc"];

        for (const input of inputs) {
            const once = normalizePhoneNumber(input);
            expect(normalizePhoneNumber(once)).toBe(once);
        }
    });
});

describe("validatePhone", () => {
    it("accepts every valid BD mobile spelling", () => {
        for (const value of ["01712345678", "+8801712345678", "8801712345678", "01712-345678", " 01712 345 678 "]) {
            expect(validatePhone(value)).toBe(true);
        }
    });

    it("rejects malformed or out-of-contract numbers", () => {
        expect(validatePhone("")).toBe(false);
        expect(validatePhone("0171234567")).toBe(false); // 9 digits after normalising
        expect(validatePhone("017123456789")).toBe(false); // 11 digits after normalising
        expect(validatePhone("02712345678")).toBe(false); // does not start with 1
        expect(validatePhone("+8802712345678")).toBe(false);
        expect(validatePhone("not-a-phone")).toBe(false);
    });
});
