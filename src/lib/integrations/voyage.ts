import "server-only";
import { isIntegrationConnected } from "@/lib/integrations/config";
import { fetchJson, IntegrationError, requireEnv } from "@/lib/integrations/shared";

// Voyage AI text embeddings. Docs: https://docs.voyageai.com/docs/embeddings
// voyage-4-large is Voyage's recommended general-purpose model. Its default output is
// 1024 dimensions, which the clips.embedding and youtube_shorts.embedding columns match.
// Without VOYAGE_API_KEY it returns mock vectors, which callers must never save.

const API = "https://api.voyageai.com/v1/embeddings";
export const EMBEDDING_MODEL = "voyage-4-large";
export const EMBEDDING_DIMENSIONS = 1024;
/** USD per million tokens (the first 200 million tokens per account are free). */
const PRICE_PER_MILLION = 0.12;
/**
 * Voyage allows 1,000 texts and 120K tokens per request for this model, but an account
 * without a payment method is limited to 3 requests and 10K tokens per minute. About
 * 24K characters (roughly 6K tokens) per request fits under both.
 */
const MAX_TEXTS_PER_REQUEST = 128;
const MAX_CHARS_PER_REQUEST = 24_000;
const MAX_ATTEMPTS = 8;
/** After a rate limit, wait out the per-minute window. */
const RATE_LIMIT_WAIT_MS = 61_000;

export const voyageConnected = () => isIntegrationConnected("voyage");

export type EmbeddingResult = { vectors: number[][]; tokens: number; requests: number; mock: boolean };

/** Estimated cost in USD at list price, before the free allowance. */
export const embeddingCostUsd = (tokens: number) => (tokens * PRICE_PER_MILLION) / 1_000_000;

/** Splits texts into requests under Voyage's per-request limits. */
function batches(texts: string[]) {
  const out: number[][] = [];
  let current: number[] = [];
  let chars = 0;
  texts.forEach((text, i) => {
    if (current.length && (current.length >= MAX_TEXTS_PER_REQUEST || chars + text.length > MAX_CHARS_PER_REQUEST)) {
      out.push(current);
      current = [];
      chars = 0;
    }
    current.push(i);
    chars += text.length;
  });
  if (current.length) out.push(current);
  return out;
}

/** Deterministic stand-in vectors, so similarity code runs without a key. */
function mockVector(text: string) {
  let seed = 0;
  for (const ch of text) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const v = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => Math.sin(seed + i * 12.9898));
  const norm = Math.hypot(...v);
  return v.map((x) => x / norm);
}

/**
 * Embeds texts in batches, in order. Every text is embedded as a "document": clips and
 * Shorts are compared with each other, not with search queries.
 */
export async function embedTexts(texts: string[]): Promise<EmbeddingResult> {
  if (!voyageConnected()) return { vectors: texts.map(mockVector), tokens: 0, requests: 0, mock: true };

  const vectors: number[][] = new Array(texts.length);
  let tokens = 0;
  let requests = 0;
  for (const indexes of batches(texts)) {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetchJson<{ data: { embedding: number[]; index: number }[]; usage: { total_tokens: number } }>("Voyage", API, {
          method: "POST",
          headers: { Authorization: `Bearer ${requireEnv("VOYAGE_API_KEY")}`, "Content-Type": "application/json" },
          body: JSON.stringify({ input: indexes.map((i) => texts[i]), model: EMBEDDING_MODEL, input_type: "document" }),
        });
        requests++;
        tokens += res.usage.total_tokens;
        for (const d of res.data) {
          if (d.embedding.length !== EMBEDDING_DIMENSIONS) {
            throw new Error(`Voyage returned ${d.embedding.length} dimensions; the database expects ${EMBEDDING_DIMENSIONS}.`);
          }
          vectors[indexes[d.index]] = d.embedding;
        }
        break;
      } catch (error) {
        // Rate limits and server errors are worth a retry; anything else isn't.
        const rateLimited = error instanceof IntegrationError && error.status === 429;
        const retryable = rateLimited || (error instanceof IntegrationError && (error.status ?? 0) >= 500);
        if (!retryable || attempt >= MAX_ATTEMPTS) throw error;
        await new Promise((r) => setTimeout(r, rateLimited ? RATE_LIMIT_WAIT_MS : 2 ** attempt * 1000));
      }
    }
  }
  return { vectors, tokens, requests, mock: false };
}

/** pgvector's text format, which PostgREST accepts for vector columns and arguments. */
export const toPgVector = (v: number[]) => `[${v.join(",")}]`;
