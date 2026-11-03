import { error } from "@sveltejs/kit";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import { deleteConversation, renameConversation } from "#lib/server/repositories/ai-conversations.js";
import type { RequestHandler } from "./$types";

// Ownership is enforced in the repository layer: both calls scope by locals.user.id,
// so another user's id yields no match. rename → 404 (we report the miss); delete is
// idempotent (no 404 — deleting an absent/foreign row is a silent no-op).

const renameSchema = z.object({ title: z.string().min(1).max(120) });

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
    if (!locals.user) error(401, "Not authenticated");
    if (!env.DB) error(503, "Database unavailable");
    if (!params.id) error(400, "Missing id");

    let body: z.infer<typeof renameSchema>;
    try {
        body = renameSchema.parse(await request.json());
    } catch (err) {
        error(400, err instanceof Error ? err.message : "Invalid request body");
    }

    const db = drizzle(env.DB);
    const success = await renameConversation(db, locals.user.id, params.id, body.title);
    if (!success) error(404, "Conversation not found");
    return new Response(null, { status: 204 });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
    if (!locals.user) error(401, "Not authenticated");
    if (!env.DB) error(503, "Database unavailable");
    if (!params.id) error(400, "Missing id");

    const db = drizzle(env.DB);
    await deleteConversation(db, locals.user.id, params.id);
    return new Response(null, { status: 204 });
};
