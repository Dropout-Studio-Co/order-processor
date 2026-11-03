import type { SteadFastOrder, UserInfo } from "#lib/types/index.js";
import { normalizePhoneNumber } from "#lib/utils/index.js";
import { prepareSteadFastOrderData, prepareShopifySteadFastOrderData, isShopifyExport } from "./data-processing";

/**
 * CSV → SteadFast pipeline: auto-detect format → prepare rows → map to schema.
 * Shopify exports take the dedup-by-order path; everything else the legacy
 * header+trailing-trim path (see data-processing.ts). Prepared rows are
 * positional `[Name, Address, Phone, Amount, Note]`; phone is BD-normalized
 * here AND again at download time (idempotent — NFR-14). Lot is blank; Delivery
 * Type is always "Home" (no UI to vary either yet).
 */
export const processOrders = (rawData: string[][], user: UserInfo): SteadFastOrder[] => {
    const header = rawData[0];
    const prepared =
        header && isShopifyExport(header)
            ? prepareShopifySteadFastOrderData(rawData)
            : prepareSteadFastOrderData(rawData);

    return prepared.map((row) => ({
        Invoice: user.merchantId,
        Name: row[0] || "",
        Address: row[1] || "",
        Phone: normalizePhoneNumber(row[2] || ""),
        Amount: row[3] || "",
        Note: row[4] || "",
        Lot: "",
        "Delivery Type": "Home",
        "Contact Name": user.name,
        "Contact Phone": user.phone || ""
    }));
};
