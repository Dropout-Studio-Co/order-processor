/**
 * Closure-based runes store (project pattern; NOT a Svelte `writable()`). The
 * exported `brandSettings` is a module singleton.
 *
 * HYDRATION: `+page.svelte` calls `hydrate()` synchronously via `untrack()`
 * during its own setup so children read canonical server values on first mount.
 * Do NOT move hydration into an `$effect` — that reintroduces the mount race
 * fixed in commit 6d9d68b (children would briefly see EMPTY).
 *
 * Each field owns an independent SaveState + retry budget so a slow/failing
 * field never blocks another; the aggregate `saveState`/`saveError` getters
 * roll them up for the beforeunload guard.
 */
import type { BrandSettingsState, BrandSettingsPatch, SaveState } from "#lib/types/index.js";
import { api, debounceSync } from "#lib/api/client.js";
import { readLocal, writeLocal, clearLocal } from "#lib/persistence/local.js";

const EMPTY: BrandSettingsState = {
    contactName: null,
    contactPhone: null,
    merchantId: null,
    selectedCourier: null
};

// Versioned localStorage key holding the logged-out user's settings.
const GUEST_KEY = "order-processor:guest:v1";

type FieldKey = keyof BrandSettingsState;

const TEXT_DEBOUNCE_MS = 500;
const SAVED_LINGER_MS = 2000;
const RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

// Retry budget is per-call; one field's failure never blocks another.
// Delays: 1s, 2s, 4s — up to 4 attempts total.
const persistWithRetry = async (patch: BrandSettingsPatch): Promise<void> => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        try {
            await api.patch<void>("/api/brand-settings", patch);
            return;
        } catch (err) {
            lastError = err;
            const delay = RETRY_DELAYS_MS[attempt];
            if (delay === undefined) break;
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

const createBrandSettingsStore = () => {
    let value = $state<BrandSettingsState>({ ...EMPTY });
    // Set once at hydration. Authed → settings PATCH to D1 (cross-device).
    // Guest → settings persist to localStorage on this device only.
    let authed = false;
    // Per-field SaveState so each input renders independently — no cross-field bleed.
    let fieldStates = $state<Partial<Record<FieldKey, SaveState>>>({});
    let fieldErrors = $state<Partial<Record<FieldKey, string>>>({});
    // Non-reactive (plain object): timers are bookkeeping, no UI reads them.
    const fieldTimers: Partial<Record<FieldKey, ReturnType<typeof setTimeout>>> = {};

    const setSavedTransient = (field: FieldKey) => {
        fieldStates[field] = "saved";
        delete fieldErrors[field];
        const existing = fieldTimers[field];
        if (existing) clearTimeout(existing);
        fieldTimers[field] = setTimeout(() => {
            if (fieldStates[field] === "saved") fieldStates[field] = "idle";
            delete fieldTimers[field];
        }, SAVED_LINGER_MS);
    };

    const onState = (field: FieldKey) => (next: SaveState, err?: Error) => {
        if (next === "saving") {
            fieldStates[field] = "saving";
            delete fieldErrors[field];
        } else if (next === "saved") {
            setSavedTransient(field);
        } else if (next === "error") {
            fieldStates[field] = "error";
            fieldErrors[field] = err?.message ?? "Save failed";
        }
    };

    const hydrate = (initial: BrandSettingsState, opts?: { authed?: boolean }) => {
        value = { ...initial };
        authed = opts?.authed ?? false;
        fieldStates = {};
        fieldErrors = {};
        for (const key of Object.keys(fieldTimers) as FieldKey[]) {
            const t = fieldTimers[key];
            if (t) clearTimeout(t);
            delete fieldTimers[key];
        }
    };

    // Browser-only: re-seed the guest store from localStorage after mount (SSR
    // can't read it). Called from +page.svelte's onMount when there's no session.
    // Additive over the empty server state — does not re-run server hydration, so
    // the single-untrack-site invariant for authed data stays intact.
    const loadGuest = () => {
        const guest = readLocal<BrandSettingsState>(GUEST_KEY);
        if (guest) value = { ...EMPTY, ...guest };
    };

    // Browser-only: on first authed load, fold any guest settings into the empty
    // account, then drop the guest key so it never re-imports. Existing account
    // settings are never clobbered (import targets an empty account only).
    const migrateGuestToServer = async () => {
        const guest = readLocal<BrandSettingsState>(GUEST_KEY);
        if (!guest) return;
        const accountEmpty =
            value.contactName === null &&
            value.contactPhone === null &&
            value.merchantId === null &&
            value.selectedCourier === null;
        if (accountEmpty) {
            const patch: BrandSettingsPatch = {};
            if (guest.contactName) patch.contactName = guest.contactName;
            if (guest.contactPhone) patch.contactPhone = guest.contactPhone;
            if (guest.merchantId) patch.merchantId = guest.merchantId;
            if (guest.selectedCourier) patch.selectedCourier = guest.selectedCourier;
            if (Object.keys(patch).length > 0) {
                try {
                    await api.patch<void>("/api/brand-settings", patch);
                    value = { ...value, ...patch };
                } catch (err) {
                    console.error("[migrate] brand-settings", err);
                    return; // keep guest data so the next load can retry
                }
            }
        }
        clearLocal(GUEST_KEY);
    };

    const updateField = <K extends FieldKey>(field: K, next: BrandSettingsState[K]) => {
        value = { ...value, [field]: next };
        // Same debounce + per-field SaveState pipeline either way; only the sink
        // differs — D1 PATCH when authed, localStorage when guest.
        const persist = authed ? () => persistWithRetry({ [field]: next }) : async () => writeLocal(GUEST_KEY, value);
        debounceSync(`brand:${field}`, TEXT_DEBOUNCE_MS, persist, { onState: onState(field) });
    };

    const dismissError = (field: FieldKey) => {
        if (fieldStates[field] === "error") fieldStates[field] = "idle";
        delete fieldErrors[field];
    };

    const fieldState = (field: FieldKey): SaveState => fieldStates[field] ?? "idle";
    const fieldError = (field: FieldKey): string | null => fieldErrors[field] ?? null;

    return {
        get value() {
            return value;
        },
        // Aggregate roll-up used by the beforeunload guard.
        // Precedence: saving > error > saved > idle.
        get saveState(): SaveState {
            const states = Object.values(fieldStates);
            if (states.includes("saving")) return "saving";
            if (states.includes("error")) return "error";
            if (states.includes("saved")) return "saved";
            return "idle";
        },
        get saveError(): string | null {
            for (const err of Object.values(fieldErrors)) if (err) return err;
            return null;
        },
        fieldState,
        fieldError,
        hydrate,
        loadGuest,
        migrateGuestToServer,
        updateField,
        dismissError
    };
};

export const brandSettings = createBrandSettingsStore();
