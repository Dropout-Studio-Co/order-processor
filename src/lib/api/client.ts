/**
 * Client-side HTTP layer. Two exports:
 * - `api`: a typed fetch wrapper that THROWS on any non-2xx (callers don't
 *   check `res.ok`); 204/non-JSON responses resolve to `undefined`.
 * - `debounceSync`: per-key debounce so simultaneous edits to different fields
 *   never cancel each other (same key resets the timer).
 */

import type { SaveState } from "#lib/types/index.js";

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

// Throws Error(text || "<METHOD> <path> failed with <status>") on non-2xx. The
// `T` cast is unchecked — there is no runtime validation of the response body.
const send = async <T>(method: Method, path: string, body?: unknown): Promise<T> => {
    const init: RequestInit = { method };
    if (body !== undefined) {
        init.headers = { "content-type": "application/json" };
        init.body = JSON.stringify(body);
    }
    const res = await fetch(path, init);
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `${method} ${path} failed with ${res.status}`);
    }
    if (res.status === 204) return undefined as T;
    const ct = res.headers.get("content-type") ?? "";
    return ct.includes("application/json") ? ((await res.json()) as T) : (undefined as T);
};

export const api = {
    get: <T>(path: string) => send<T>("GET", path),
    patch: <T>(path: string, body?: unknown) => send<T>("PATCH", path, body),
    delete: <T>(path: string) => send<T>("DELETE", path)
};

export interface SyncOptions {
    onState?: (state: SaveState, err?: Error) => void;
}

const pending = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Schedule fn to run after delayMs of quiet on `key`. Subsequent calls with
 * the same key reset the timer; calls with different keys run independently.
 * Fire-and-forget: never throws/rejects — fn failures are caught and surfaced
 * via `onState("error", err)`, with progress reported as saving → saved/error.
 */
export const debounceSync = <T>(
    key: string,
    delayMs: number,
    fn: () => Promise<T>,
    options: SyncOptions = {}
): void => {
    const existing = pending.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(async () => {
        pending.delete(key);
        options.onState?.("saving");
        try {
            await fn();
            options.onState?.("saved");
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            console.error("[sync]", key, error);
            options.onState?.("error", error);
        }
    }, delayMs);
    pending.set(key, timer);
};
