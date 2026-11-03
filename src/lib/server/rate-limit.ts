/**
 * Per-user, D1-backed rate limiter for the Copilot chat endpoint. Each chat turn
 * drives real Workers AI (gateway chain + corrective retry + RAG embedding), so
 * an authenticated user could otherwise drive unbounded model spend
 * (FINDINGS.md #2). We reuse Better Auth's `rate_limits` table under a distinct
 * `copilot-chat:<userId>` key namespace — no migration, and no collision with
 * Better Auth's own per-route keys.
 *
 * Fixed window: `last_request` marks the window start and is NOT bumped on each
 * request, so a steady stream of calls cannot slide the window open forever. The
 * read-modify-write is non-atomic (two concurrent turns may both pass at the
 * boundary) — acceptable for a cost guard, and the same trade-off Better Auth's
 * own DB limiter makes.
 */
import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { rateLimits } from "#lib/server/schema.js";

type Db = DrizzleD1Database<Record<string, never>>;

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 20;

const keyFor = (userId: string): string => `copilot-chat:${userId}`;

/**
 * Records a chat turn against the user's budget and returns whether it is
 * allowed. `false` means the user has exceeded {@link MAX_REQUESTS} within the
 * current {@link WINDOW_MS} window; the caller should answer 429.
 */
export const checkChatRateLimit = async (db: Db, userId: string): Promise<boolean> => {
    const key = keyFor(userId);
    const now = Date.now(); // `last_request` is stored as Unix-ms (see schema.ts).

    const row = await db.select().from(rateLimits).where(eq(rateLimits.key, key)).get();

    // First request, or the previous window has fully elapsed → start fresh.
    if (!row || now - row.lastRequest > WINDOW_MS) {
        if (row) {
            await db.update(rateLimits).set({ count: 1, lastRequest: now }).where(eq(rateLimits.key, key)).run();
        } else {
            await db.insert(rateLimits).values({ id: crypto.randomUUID(), key, count: 1, lastRequest: now }).run();
        }
        return true;
    }

    if (row.count >= MAX_REQUESTS) return false;

    // Within the window and under budget — count it, but leave `last_request` at
    // the window start so the window stays fixed rather than sliding.
    await db
        .update(rateLimits)
        .set({ count: row.count + 1 })
        .where(eq(rateLimits.key, key))
        .run();
    return true;
};
