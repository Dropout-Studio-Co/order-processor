import { fail, redirect } from "@sveltejs/kit";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { userSettings } from "#lib/server/schema.js";
import { deriveTokenKey, encryptToken, decryptToken, maskToken } from "#lib/server/crypto.js";
import { listChatModels, DEFAULT_MODEL, type CfModel } from "#lib/server/ai/run-rest.js";
import {
    loadCloudflareConfig,
    resolveCloudflareCreds,
    isCloudflareConnected
} from "#lib/server/ai/cloudflare-config.js";
import { describeCloudflareError } from "#lib/server/ai/errors.js";
import type { Actions, PageServerLoad } from "./$types";

/**
 * Settings page server module — the bring-your-own Cloudflare account form.
 *
 *   load → 303 /login when signed out; otherwise the connection status, a masked
 *          token, the account id, the selected model, and the live model list.
 *   save → validates a newly-supplied token by listing the account's models
 *          (proves token + account + Workers AI permission), encrypts it with
 *          TOKEN_ENCRYPTION_KEY, and upserts the row. Empty token preserves the
 *          existing blob.
 *   reset → DELETE FROM user_settings (does not touch the Copilot history).
 *
 * INVARIANT: this module is the only place that decrypts the token on a load —
 * and only to mask it. The raw secret never leaves the server.
 */
export const load: PageServerLoad = async ({ locals, request }) => {
    if (!locals.user) {
        redirect(303, "/login");
    }
    const platformHint =
        request.headers.get("sec-ch-ua-platform")?.replace(/^"|"$/g, "") || request.headers.get("user-agent") || "";
    if (!env.DB) {
        return {
            connected: false,
            accountId: "",
            maskedToken: "",
            model: DEFAULT_MODEL,
            models: [] as CfModel[],
            platformHint
        };
    }

    const db = drizzle(env.DB);
    const cfg = await loadCloudflareConfig(db, locals.user.id);
    const connected = isCloudflareConnected(cfg);

    const key = env.TOKEN_ENCRYPTION_KEY;
    let maskedToken = "";
    if (cfg.tokenEncrypted && key) {
        try {
            maskedToken = maskToken(await decryptToken(cfg.tokenEncrypted, await deriveTokenKey(key)));
        } catch {
            maskedToken = "(decrypt error)";
        }
    }

    // Fetch the model list live (no KV cache in this tool). Best-effort — an
    // outage just leaves the dropdown with the default option.
    let models: CfModel[] = [];
    if (connected && key) {
        try {
            const resolved = await resolveCloudflareCreds(key, cfg);
            if (resolved) models = await listChatModels(resolved.creds);
        } catch {
            // ignore — picker falls back to the default option
        }
    }

    return {
        connected,
        accountId: cfg.accountId ?? "",
        maskedToken,
        model: cfg.model ?? DEFAULT_MODEL,
        models,
        platformHint
    };
};

export const actions: Actions = {
    save: async ({ request, locals }) => {
        if (!locals.user) {
            return fail(401, { error: "Not authenticated" });
        }
        if (!env.DB) {
            return fail(503, { error: "Database unavailable" });
        }

        const data = await request.formData();
        const token = (data.get("cloudflareToken") ?? "").toString().trim();
        const accountId = (data.get("cloudflareAccountId") ?? "").toString().trim();
        const model = (data.get("cloudflareModel") ?? "").toString().trim() || DEFAULT_MODEL;

        const tokenProvided = token.length > 0;
        if (tokenProvided && !accountId) {
            return fail(400, { error: "Enter your Cloudflare Account ID alongside the API token." });
        }

        const db = drizzle(env.DB);
        const key = env.TOKEN_ENCRYPTION_KEY;

        // When a new token is provided, validate it by listing the account's models
        // (proves token + account + Workers AI permission) before encrypting it.
        let tokenBlob: Uint8Array | null = null;
        if (tokenProvided) {
            if (!key) {
                return fail(500, { error: "Encryption key not configured." });
            }
            try {
                await listChatModels({ accountId, apiToken: token });
            } catch (e) {
                return fail(400, { error: describeCloudflareError(e) });
            }
            tokenBlob = await encryptToken(token, await deriveTokenKey(key));
        }

        const updateData: Partial<typeof userSettings.$inferInsert> = {
            cloudflareAccountId: accountId || null,
            cloudflareModel: model
        };
        if (tokenBlob) {
            updateData.cloudflareTokenEncrypted = tokenBlob;
        }

        const existing = await db
            .select({ userId: userSettings.userId })
            .from(userSettings)
            .where(eq(userSettings.userId, locals.user.id))
            .limit(1);

        if (existing.length === 0) {
            await db.insert(userSettings).values({ userId: locals.user.id, ...updateData });
        } else {
            await db.update(userSettings).set(updateData).where(eq(userSettings.userId, locals.user.id));
        }

        return { success: true };
    },

    reset: async ({ locals }) => {
        if (!locals.user) {
            return fail(401, { error: "Not authenticated" });
        }
        if (!env.DB) {
            return fail(503, { error: "Database unavailable" });
        }
        const db = drizzle(env.DB);
        await db.delete(userSettings).where(eq(userSettings.userId, locals.user.id));
        return { success: true, reset: true };
    }
};
