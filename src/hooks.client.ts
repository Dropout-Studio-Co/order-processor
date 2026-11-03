import type { HandleClientError } from "@sveltejs/kit/hooks";

// Client mirror of hooks.server.ts handleError: log the full error against an
// errorId for correlation, but only surface raw messages for < 500 — 5xx are
// genericised so internal details never reach the user. errorId flows to the
// shape declared on App.Error and is rendered by +error.svelte.
export const handleError: HandleClientError = ({ kind, error }) => {
    const errorId = crypto.randomUUID();
    const normalized =
        kind === "app" || kind === "framework"
            ? { status: error.status, message: error.message, cause: error }
            : { status: 500, message: "Internal Error", cause: error };

    console.error(`[${errorId}] Client error:`, {
        kind,
        status: normalized.status,
        message: normalized.message,
        error:
            normalized.cause instanceof Error
                ? { name: normalized.cause.name, message: normalized.cause.message }
                : normalized.cause
    });

    return {
        message: normalized.status >= 500 ? "An unexpected error occurred" : normalized.message,
        errorId
    };
};
