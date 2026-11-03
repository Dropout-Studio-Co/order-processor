import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { brandSettings } from "#lib/server/schema.js";
import { listConversations } from "#lib/server/repositories/ai-conversations.js";
import type { BrandSettingsState } from "#lib/types/index.js";
import type { PersistedConversationSummary } from "#lib/ai/types.js";
import type { PageServerLoad } from "./$types";

// Auth is OPTIONAL: logged-out visitors get the full app (settings persist to
// localStorage client-side). Signing in unlocks server storage + cross-device
// sync + the Copilot. Server data is loaded ONLY for an authenticated session;
// anonymous visitors get empty defaults and hydrate from localStorage on mount.
// When DB is absent (e.g. `bun run dev` without wrangler bindings) we degrade to
// empty defaults rather than failing the page.
export const load: PageServerLoad = async ({ locals }) => {
    let settings: BrandSettingsState = {
        contactName: null,
        contactPhone: null,
        merchantId: null,
        selectedCourier: null
    };
    let conversations: PersistedConversationSummary[] = [];

    if (locals.user && env.DB) {
        const db = drizzle(env.DB);
        const row = await db.select().from(brandSettings).where(eq(brandSettings.userId, locals.user.id)).get();
        if (row) {
            settings = {
                contactName: row.contactName,
                contactPhone: row.contactPhone,
                merchantId: row.merchantId,
                selectedCourier: row.selectedCourier
            };
        }
        const rows = await listConversations(db, locals.user.id, 50);
        conversations = rows.map((r) => ({
            id: r.id,
            title: r.title,
            createdAt: r.createdAt.toISOString(),
            updatedAt: r.updatedAt.toISOString()
        }));
    }

    return {
        user: locals.user,
        currentUser: locals.currentUser,
        brandSettings: settings,
        copilotConversations: conversations
    };
};
