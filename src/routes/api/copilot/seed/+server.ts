import { error } from "@sveltejs/kit";
import { env } from "cloudflare:workers";
import type { RequestHandler } from "./$types";
import { KNOWLEDGE_CORPUS } from "#lib/ai/knowledge.js";
import { embedDocuments } from "#lib/ai/embeddings.js";

/**
 * Embeds the full KNOWLEDGE_CORPUS with qwen3 and upserts it into Vectorize for
 * Copilot RAG (warning #25). Re-run after editing knowledge.ts. Not auth-gated by
 * session — guarded by a shared SEED_SECRET via the x-seed-secret header (401 on
 * mismatch/absent, 503 if AI/Vectorize bindings are missing). The vector-count
 * mismatch throw below guards against silently seeding misaligned id↔embedding
 * pairs if the embed call returns fewer rows than the corpus.
 */
export const POST: RequestHandler = async ({ request }) => {
    if (!env?.AI || !env.VECTORIZE) {
        error(503, "AI or Vectorize binding unavailable");
    }
    const secret = env.SEED_SECRET;
    if (!secret || request.headers.get("x-seed-secret") !== secret) {
        error(401, "Unauthorized");
    }

    const texts = KNOWLEDGE_CORPUS.map((chunk) => chunk.text);
    const vectors = await embedDocuments(env, texts);
    const records = KNOWLEDGE_CORPUS.map((chunk, index) => {
        const values = vectors[index];
        if (!values) {
            throw new Error("qwen3 embedding count did not match the knowledge corpus");
        }
        return {
            id: chunk.id,
            values,
            metadata: { text: chunk.text }
        };
    });
    await env.VECTORIZE.upsert(records);

    return Response.json({ seeded: records.length });
};
