/**
 * Thin facades over brandSettings for the rest of the app.
 *
 * courierService reads selectedCourier on the brand-settings store, resolving
 * to the SteadFast default when nothing has been persisted.
 */

import { Courier } from "#lib/types/index.js";
import { brandSettings } from "./brand-settings.svelte";

const DEFAULT_COURIER: string = Courier.SteadFast;

export const courierService = {
    get value(): string {
        return brandSettings.value.selectedCourier ?? DEFAULT_COURIER;
    }
};

/** True when the merchant has saved a non-empty merchantId. */
export const hasMerchantId = (): boolean => {
    const id = brandSettings.value.merchantId;
    return id !== null && id.trim().length > 0;
};
