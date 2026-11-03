import type { RequestHandler } from "./$types";
import { error } from "@sveltejs/kit";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { loadCloudflareConfig, resolveCloudflareCreds } from "#lib/server/ai/cloudflare-config.js";
import { listChatModels, type CfModel } from "#lib/server/ai/run-rest.js";
import { describeCloudflareError } from "#lib/server/ai/errors.js";

/**
 * GET /api/cf/models — the function-calling chat models on the user's connected
 * Cloudflare account, for the settings model picker. This tool has NO KV binding,
 * so the list is fetched LIVE on every call (no cache). `?refresh=1` is accepted
 * for parity with the settings UI but is a no-op here. Always the USER's models.
 */
export const GET: RequestHandler = async ({ locals }) => {
    if (!locals.user) {
        error(401, "Not authenticated");
    }
    if (!env.DB) {
        error(503, "Database unavailable");
    }

    const db = drizzle(env.DB);
    const cfg = await loadCloudflareConfig(db, locals.user.id);
    if (!cfg.accountId) {
        return Response.json({ models: [] as CfModel[], connected: false });
    }

    const key = env.TOKEN_ENCRYPTION_KEY;
    if (!key) {
        return Response.json({ models: [] as CfModel[], connected: false });
    }

    const resolved = await resolveCloudflareCreds(key, cfg).catch(() => null);
    if (!resolved) {
        return Response.json({ models: [] as CfModel[], connected: false });
    }

    try {
        const models = await listChatModels(resolved.creds);
        return Response.json({ models, connected: true, cached: false });
    } catch (e) {
        return Response.json({ models: [] as CfModel[], connected: true, error: describeCloudflareError(e) });
    }
};
