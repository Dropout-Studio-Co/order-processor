import type { CurrentUser } from "#lib/types/index.js";

/**
 * Derive CurrentUser from an authenticated session user.
 * Any authenticated Google user is authorized — authentication is the only gate.
 */
export const getCurrentUser = (user: { name: string; email: string } | null | undefined): CurrentUser | null => {
    if (!user) return null;
    return { name: user.name, email: user.email };
};
