/**
 * D1 access for Copilot conversation threads. Every read/mutate is scoped by
 * `userId` (tenant isolation invariant) — `id` alone is never trusted, so one
 * user cannot touch another's thread even with a guessed id. Callers (the
 * /api/copilot routes) treat these as best-effort: a failure must not abort the
 * live chat stream (CLAUDE.md warning #23).
 *
 * `renameConversation`/`touchUpdatedAt` set `updatedAt` via SQL `unixepoch()`
 * (DB-side clock) rather than a JS `Date`, matching the integer-timestamp
 * column without a round-trip.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { aiConversations } from "#lib/server/schema.js";

type Db = DrizzleD1Database<Record<string, never>>;

export interface AiConversationRow {
    id: string;
    userId: string;
    title: string;
    createdAt: Date;
    updatedAt: Date;
}

export const createConversation = async (db: Db, userId: string, title: string): Promise<AiConversationRow> => {
    const id = crypto.randomUUID();
    const now = new Date();
    await db.insert(aiConversations).values({ id, userId, title, createdAt: now, updatedAt: now }).run();
    return { id, userId, title, createdAt: now, updatedAt: now };
};

export const listConversations = async (db: Db, userId: string, limit = 50): Promise<AiConversationRow[]> => {
    const rows = await db
        .select()
        .from(aiConversations)
        .where(eq(aiConversations.userId, userId))
        .orderBy(desc(aiConversations.updatedAt))
        .limit(limit)
        .all();
    return rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        title: r.title,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt
    }));
};

export const getConversation = async (db: Db, userId: string, id: string): Promise<AiConversationRow | null> => {
    const row = await db
        .select()
        .from(aiConversations)
        .where(and(eq(aiConversations.id, id), eq(aiConversations.userId, userId)))
        .get();
    if (!row) return null;
    return {
        id: row.id,
        userId: row.userId,
        title: row.title,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
    };
};

// Returns false when no row matched (wrong id, or not this user's) — lets the
// caller answer 404 vs 200 without a separate existence check.
export const renameConversation = async (db: Db, userId: string, id: string, title: string): Promise<boolean> => {
    const result = await db
        .update(aiConversations)
        .set({ title, updatedAt: sql`(unixepoch())` })
        .where(and(eq(aiConversations.id, id), eq(aiConversations.userId, userId)))
        .run();
    return (result.meta?.changes ?? 0) > 0;
};

export const deleteConversation = async (db: Db, userId: string, id: string): Promise<void> => {
    await db
        .delete(aiConversations)
        .where(and(eq(aiConversations.id, id), eq(aiConversations.userId, userId)))
        .run();
};

// Bumps a thread to the top of the list after a new turn. Scoped by `userId`
// like every other mutation here — the tenant-isolation invariant holds even if
// a future caller passes an unverified id.
export const touchUpdatedAt = async (db: Db, userId: string, id: string): Promise<void> => {
    await db
        .update(aiConversations)
        .set({ updatedAt: sql`(unixepoch())` })
        .where(and(eq(aiConversations.id, id), eq(aiConversations.userId, userId)))
        .run();
};
