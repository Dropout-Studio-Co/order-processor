/**
 * D1 access for Copilot messages. Scoped by `conversationId`, NOT `userId` —
 * tenant isolation is the caller's job (verify conversation ownership before
 * reading/appending). Best-effort like the conversations repo: a write failure
 * must not abort the live chat stream (CLAUDE.md warning #23).
 *
 * `toolCalls` round-trips as a JSON column; `toRow` coerces the untyped JSON
 * back to `AiMessageToolCall[]` and normalizes the absent case to `null`.
 */
import { asc, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { aiMessages } from "#lib/server/schema.js";

type Db = DrizzleD1Database<Record<string, never>>;

export type AiMessageRole = "user" | "assistant";

export interface AiMessageToolCall {
    id: string;
    name: string;
    args: unknown;
}

export interface AiMessageRow {
    id: string;
    conversationId: string;
    role: AiMessageRole;
    content: string;
    toolCalls: AiMessageToolCall[] | null;
    createdAt: Date;
}

export interface AppendMessageInput {
    role: AiMessageRole;
    content: string;
    toolCalls?: AiMessageToolCall[] | null;
}

const toRow = (raw: typeof aiMessages.$inferSelect): AiMessageRow => ({
    id: raw.id,
    conversationId: raw.conversationId,
    role: raw.role,
    content: raw.content,
    toolCalls: (raw.toolCalls as AiMessageToolCall[] | null) ?? null,
    createdAt: raw.createdAt
});

export const appendMessage = async (
    db: Db,
    conversationId: string,
    message: AppendMessageInput
): Promise<AiMessageRow> => {
    const id = crypto.randomUUID();
    const now = new Date();
    await db
        .insert(aiMessages)
        .values({
            id,
            conversationId,
            role: message.role,
            content: message.content,
            toolCalls: message.toolCalls ?? null,
            createdAt: now
        })
        .run();
    return {
        id,
        conversationId,
        role: message.role,
        content: message.content,
        toolCalls: message.toolCalls ?? null,
        createdAt: now
    };
};

export const listMessages = async (db: Db, conversationId: string, limit = 200): Promise<AiMessageRow[]> => {
    const rows = await db
        .select()
        .from(aiMessages)
        .where(eq(aiMessages.conversationId, conversationId))
        .orderBy(asc(aiMessages.createdAt))
        .limit(limit)
        .all();
    return rows.map(toRow);
};
