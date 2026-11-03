/**
 * Copilot RAG retrieval over the `order-processor-kb` Vectorize index. The chat
 * endpoint calls `retrieveAppKnowledge` best-effort per turn and folds the
 * result into the user message as "APP KNOWLEDGE" — a Vectorize/AI outage must
 * degrade silently to plain chat, never abort the turn (CLAUDE.md warning #16).
 *
 * The per-QUERY embedding runs on the END USER's own Cloudflare account (BYO,
 * billed to them) via the Workers AI REST API — NOT the owner's bound `env.AI`.
 * The Vectorize index itself is the owner's static knowledge store, queried with
 * the user-account-embedded query vector. (The one-time owner SEED route still
 * embeds the corpus with `env.AI`.)
 */
import { EMBEDDING_MODEL } from "./embeddings";
import { runEmbeddingViaRest, type CloudflareCreds } from "#lib/server/ai/run-rest.js";

export interface RagChunk {
    id: string;
    text: string;
    score: number;
}

const QUERY_INSTRUCTION =
    "Given a question about using the order processor (CSV order batches, courier mapping, validation), retrieve the most relevant help passages.";

/** Owner-side cross-encoder that reorders the widened candidate pool by true relevance. */
const RERANK_MODEL = "@cf/baai/bge-reranker-base" as const;

// Retrieve-wide → rerank → narrow. Pull a wide candidate pool from Vectorize, let
// the cross-encoder decide relevance, then keep the best `topK`.
const CANDIDATE_TOPK = 12;

// Pre-rerank cosine floor — drops obvious junk before paying for the reranker,
// deliberately looser than the old 0.4 gate so the cross-encoder (not raw cosine)
// makes the final relevance call. Loosen only if recall suffers.
const PRE_RERANK_COSINE_FLOOR = 0.3;

// Post-rerank keep threshold on the SIGMOID-mapped reranker logit (0..1). The
// reranker emits logits; sigmoid(0) = 0.5 is the natural relevance boundary, so
// 0.3 (logit ≳ -0.85) keeps mildly-relevant help while dropping the rest — tuned
// for recall since this RAG is best-effort help context.
const MIN_RERANK_SCORE = 0.3;

// ~512-token reranker input cap (~2000 chars) applied PER CONTEXT for the reranker
// call ONLY — the full chunk text still rides through to the LLM afterward.
const RERANK_CTX_CHARS = 2000;

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/**
 * Reorders `candidates` with the bge-reranker-base cross-encoder on the OWNER's
 * `env.AI` binding, keeping the top `keep` whose sigmoid-mapped relevance clears
 * MIN_RERANK_SCORE (in rerank order, each carrying its 0..1 score). Fails open:
 * any reranker error falls back to the pre-rerank cosine order (already sorted by
 * Vectorize), trimmed to `keep`, so a reranker outage never breaks the chat. Each
 * context is truncated for the reranker's 512-token limit; the FULL chunk text is
 * preserved on the returned RagChunk for the LLM.
 */
const rerankChunks = async (ai: Ai, query: string, candidates: RagChunk[], keep: number): Promise<RagChunk[]> => {
    try {
        // The generated Workers AI types drop the required `query` field on the
        // reranker input (upstream codegen bug), so build the payload as a variable
        // — a direct object literal would trip the excess-property check on `query`.
        const rerankInput = {
            query,
            contexts: candidates.map((c) => ({ text: c.text.slice(0, RERANK_CTX_CHARS) })),
            top_k: candidates.length
        };
        const res = await ai.run(RERANK_MODEL, rerankInput);
        const ranked = res.response ?? [];
        if (ranked.length === 0) return candidates.slice(0, keep);

        const out: RagChunk[] = [];
        for (const r of ranked) {
            // `id` is the INDEX into the contexts array we passed — resolve it back
            // to the parallel candidate match; `score` is a logit → sigmoid to 0..1.
            if (typeof r.id !== "number" || typeof r.score !== "number") continue;
            const source = candidates[r.id];
            if (!source) continue;
            const score = sigmoid(r.score);
            if (score < MIN_RERANK_SCORE) continue;
            out.push({ ...source, score });
            if (out.length >= keep) break;
        }
        return out;
    } catch {
        // Fail open — never break the chat on a reranker outage.
        return candidates.slice(0, keep);
    }
};

/**
 * Embeds the query on the user's account, retrieves a WIDE candidate pool (above a
 * loose cosine floor) from the owner's Vectorize index, then reranks with the
 * owner's `env.AI` cross-encoder and returns the top `topK` chunks. Empty chunk
 * text is filtered (metadata may be absent). Reranking fails open to cosine order.
 */
export const retrieveAppKnowledge = async (
    vectorize: VectorizeIndex,
    ai: Ai,
    creds: CloudflareCreds,
    query: string,
    topK = 4
): Promise<RagChunk[]> => {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];
    const vector = await runEmbeddingViaRest(creds, EMBEDDING_MODEL, {
        text: [trimmed],
        instruction: QUERY_INSTRUCTION
    });
    const result = await vectorize.query(vector, { topK: CANDIDATE_TOPK, returnMetadata: "all" });
    const candidates = (result.matches ?? [])
        .filter((m) => typeof m.score === "number" && m.score >= PRE_RERANK_COSINE_FLOOR)
        .map((m) => ({
            id: m.id,
            text: typeof m.metadata?.text === "string" ? m.metadata.text : "",
            score: m.score
        }))
        .filter((c) => c.text.length > 0);
    if (candidates.length === 0) return [];
    return rerankChunks(ai, trimmed, candidates, topK);
};

export const formatKnowledge = (chunks: RagChunk[]): string => {
    if (chunks.length === 0) return "";
    return chunks.map((chunk, index) => `[${index + 1}] ${chunk.text}`).join("\n");
};
