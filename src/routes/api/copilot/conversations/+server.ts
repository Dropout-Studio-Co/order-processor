import { error } from "@sveltejs/kit";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import { createConversation, listConversations } from "#lib/server/repositories/ai-conversations.js";
import { titleFromMessage } from "#lib/ai/prompts.js";
import type { RequestHandler } from "./$types";

const createSchema = z.object({ title: z.string().min(1).max(120).optional() });

export const GET: RequestHandler = async ({ locals }) => {
    if (!locals.user) error(401, "Not authenticated");
    if (!env.DB) error(503, "Database unavailable");

    const db = drizzle(env.DB);
    const rows = await listConversations(db, locals.user.id, 50);
    return Response.json(
        rows.map((r) => ({
            id: r.id,
            title: r.title,
            createdAt: r.createdAt.toISOString(),
            updatedAt: r.updatedAt.toISOString()
        }))
    );
};

export const POST: RequestHandler = async ({ locals, request }) => {
    if (!locals.user) error(401, "Not authenticated");
    if (!env.DB) error(503, "Database unavailable");

    let body: z.infer<typeof createSchema>;
    try {
        body = createSchema.parse(await request.json().catch(() => ({})));
    } catch (err) {
        error(400, err instanceof Error ? err.message : "Invalid request body");
    }

    const db = drizzle(env.DB);
    const title = body.title ?? titleFromMessage("New chat");
    const row = await createConversation(db, locals.user.id, title);
    return Response.json({
        id: row.id,
        title: row.title,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString()
    });
};
