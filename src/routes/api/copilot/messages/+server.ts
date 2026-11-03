import { error } from "@sveltejs/kit";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { getConversation } from "#lib/server/repositories/ai-conversations.js";
import { listMessages } from "#lib/server/repositories/ai-messages.js";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ locals, url }) => {
    if (!locals.user) error(401, "Not authenticated");
    if (!env.DB) error(503, "Database unavailable");

    const conversationId = url.searchParams.get("conversationId");
    if (!conversationId) error(400, "Missing conversationId");

    // Ownership check before reading messages: getConversation scopes by user id,
    // so a foreign/unknown id 404s rather than leaking another user's history.
    const db = drizzle(env.DB);
    const conversation = await getConversation(db, locals.user.id, conversationId);
    if (!conversation) error(404, "Conversation not found");

    const rows = await listMessages(db, conversationId, 500);
    return Response.json(
        rows.map((r) => ({
            id: r.id,
            role: r.role,
            content: r.content,
            toolCalls: r.toolCalls,
            createdAt: r.createdAt.toISOString()
        }))
    );
};
