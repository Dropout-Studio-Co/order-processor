import { error } from "@sveltejs/kit";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { brandSettings } from "#lib/server/schema.js";
import { Courier } from "#lib/types/index.js";
import type { BrandSettingsPatch } from "#lib/types/index.js";
import type { RequestHandler } from "./$types";

function requireAuth(locals: App.Locals) {
    if (!locals.user) {
        error(401, "Not authenticated");
    }
    return locals.user;
}

export const GET: RequestHandler = async ({ locals }) => {
    const user = requireAuth(locals);

    if (!env.DB) {
        error(503, "Database unavailable");
    }

    const db = drizzle(env.DB);
    const settings = await db.select().from(brandSettings).where(eq(brandSettings.userId, user.id)).get();

    return Response.json({
        success: true,
        data: settings ?? {
            userId: user.id,
            contactName: null,
            contactPhone: null,
            merchantId: null,
            selectedCourier: null
        }
    });
};

const ALLOWED_KEYS = new Set<keyof BrandSettingsPatch>([
    "contactName",
    "contactPhone",
    "merchantId",
    "selectedCourier"
]);

const ALLOWED_COURIERS = new Set<string>(Object.values(Courier));

export const PATCH: RequestHandler = async ({ locals, request }) => {
    const user = requireAuth(locals);

    if (!env.DB) {
        error(503, "Database unavailable");
    }

    let rawBody: unknown;
    try {
        rawBody = await request.json();
    } catch {
        error(400, "Invalid JSON body");
    }

    if (typeof rawBody !== "object" || rawBody === null || Array.isArray(rawBody)) {
        error(400, "Invalid request body");
    }

    const patch: BrandSettingsPatch = {};
    for (const [key, value] of Object.entries(rawBody as Record<string, unknown>)) {
        if (!ALLOWED_KEYS.has(key as keyof BrandSettingsPatch)) {
            error(400, `Unknown field: ${key}`);
        }
        if (typeof value !== "string") {
            error(400, `Field ${key} must be a string`);
        }
        (patch as Record<string, string>)[key] = value;
    }

    if (patch.merchantId !== undefined && patch.merchantId.trim().length === 0) {
        error(400, "Merchant ID cannot be empty");
    }

    if (patch.selectedCourier !== undefined && !ALLOWED_COURIERS.has(patch.selectedCourier)) {
        error(400, `Unknown courier: ${patch.selectedCourier}`);
    }

    const db = drizzle(env.DB);
    const now = new Date();

    // Ensure row exists; insert is a no-op when one is already there.
    await db
        .insert(brandSettings)
        .values({
            id: crypto.randomUUID(),
            userId: user.id,
            createdAt: now,
            updatedAt: now
        })
        .onConflictDoNothing({ target: brandSettings.userId });

    // Build selective UPDATE — only fields present in the patch.
    const updates: Record<string, string | Date> = { updatedAt: now };
    if (patch.contactName !== undefined) updates.contactName = patch.contactName;
    if (patch.contactPhone !== undefined) updates.contactPhone = patch.contactPhone;
    if (patch.merchantId !== undefined) updates.merchantId = patch.merchantId;
    if (patch.selectedCourier !== undefined) updates.selectedCourier = patch.selectedCourier;

    await db.update(brandSettings).set(updates).where(eq(brandSettings.userId, user.id));

    return new Response(null, { status: 204 });
};
