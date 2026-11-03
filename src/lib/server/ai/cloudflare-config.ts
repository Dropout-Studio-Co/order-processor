/**
 * Per-user Cloudflare credentials loader (the BYO-account layer behind the
 * Copilot).
 *
 * The user's API token is stored AES-GCM encrypted in `user_settings` (keyed by
 * env.TOKEN_ENCRYPTION_KEY). `loadCloudflareConfig` reads the raw row;
 * `resolveCloudflareCreds` decrypts the token into usable creds + the resolved
 * model id (the user's selection, or the default).
 */

import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { userSettings } from "#lib/server/schema.js";
import { deriveTokenKey, decryptToken } from "#lib/server/crypto.js";
import { DEFAULT_MODEL, type CloudflareCreds } from "./run-rest";

/** Raised by the chat gate when a user has not connected their Cloudflare account. */
export class CloudflareNotConnectedError extends Error {
    constructor(message = "Connect your Cloudflare account in Settings to use the copilot.") {
        super(message);
        this.name = "CloudflareNotConnectedError";
    }
}

export interface CloudflareConfig {
    tokenEncrypted: Uint8Array | null;
    accountId: string | null;
    model: string | null;
}

type Db = DrizzleD1Database<Record<string, never>>;

export async function loadCloudflareConfig(db: Db, userId: string): Promise<CloudflareConfig> {
    const rows = await db
        .select({
            tok: userSettings.cloudflareTokenEncrypted,
            acct: userSettings.cloudflareAccountId,
            model: userSettings.cloudflareModel
        })
        .from(userSettings)
        .where(eq(userSettings.userId, userId))
        .limit(1);
    const s = rows[0];
    if (!s) return { tokenEncrypted: null, accountId: null, model: null };
    return {
        tokenEncrypted: s.tok ? new Uint8Array(s.tok as ArrayBuffer) : null,
        accountId: s.acct,
        model: s.model
    };
}

/** A connection is "complete" only with BOTH a token blob and an account id. */
export function isCloudflareConnected(cfg: CloudflareConfig): boolean {
    return Boolean(cfg.tokenEncrypted && cfg.accountId);
}

/**
 * Decrypts the token and returns usable creds + the resolved model id, or `null`
 * when the user hasn't connected an account. `encryptionKey` is
 * `env.TOKEN_ENCRYPTION_KEY`.
 */
export async function resolveCloudflareCreds(
    encryptionKey: string,
    cfg: CloudflareConfig
): Promise<{ creds: CloudflareCreds; model: string } | null> {
    if (!cfg.tokenEncrypted || !cfg.accountId) return null;
    const key = await deriveTokenKey(encryptionKey);
    const apiToken = await decryptToken(cfg.tokenEncrypted, key);
    return { creds: { accountId: cfg.accountId, apiToken }, model: cfg.model ?? DEFAULT_MODEL };
}
