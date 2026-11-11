import "server-only";
import type { ClipFormat } from "@/lib/clips";
import type { Db } from "@/lib/db/client";
import { EMBEDDING_MODEL, embeddingCostUsd, embedTexts, toPgVector } from "@/lib/integrations/voyage";
import { shortFormatLabels, type ShortFormat } from "@/lib/youtube-marks";

// The scoring agent's memory: Voyage embeddings of our pipeline clips and every Short on
// the channel, and a pgvector search for the Shorts most similar to a clip.

const PAGE = 1000;
/** Rows embedded and saved per round, so a failure part way loses little. */
const ROUND = 256;
/** Shorts younger than this aren't settled, so they never count as similar past Shorts. */
export const SIMILAR_MIN_AGE_DAYS = 7;
export const SIMILAR_COUNT = 5;

const clipFormatText: Record<ClipFormat, string> = { mock: "Mock interview", conversational: "Conversational" };

/** What a pipeline clip's embedding is made of: format, title, headline, and transcript. */
export function clipEmbeddingText(clip: {
  format: ClipFormat;
  title: string;
  youtube_title: string | null;
  suggested_title: string | null;
  transcript: string | null;
}) {
  return [
    `Format: ${clipFormatText[clip.format]}`,
    `Title: ${clip.youtube_title ?? clip.suggested_title ?? clip.title}`,
    // The headline baked into the video is the suggested factual title.
    `Headline: ${clip.suggested_title ?? clip.title}`,
    `Transcript: ${clip.transcript ?? ""}`,
  ].join("\n");
}

/** What a channel Short's embedding is made of: format, title, and description. No transcripts. */
export function shortEmbeddingText(short: { format: string | null; title: string; description: string }) {
  const format = short.format ? shortFormatLabels[short.format as ShortFormat] : "Unknown";
  return [`Format: ${format}`, `Title: ${short.title}`, `Description: ${short.description}`].join("\n");
}

export type EmbedRun = { clips: number; shorts: number; tokens: number; requests: number; costUsd: number; mock: boolean };

async function loadAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, what: string) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`Failed to load ${what}: ${error.message}`);
    rows.push(...data!);
    if (data!.length < PAGE) break;
  }
  return rows;
}

/**
 * Embeds every clip and Short that has no embedding yet (or all of them with `all`), in
 * batches, and logs the run to agent_runs (kind "embeddings") with tokens and cost.
 * Throws without VOYAGE_API_KEY: mock vectors must never be saved.
 */
export async function embedMissing(db: Db, options: { all?: boolean; log?: (line: string) => void } = {}): Promise<EmbedRun> {
  const log = options.log ?? (() => {});
  const clips = await loadAll(
    (from, to) => {
      let q = db.from("clips").select("id, format, title, youtube_title, suggested_title, transcript");
      if (!options.all) q = q.is("embedding", null);
      return q.order("created_at").range(from, to);
    },
    "clips to embed",
  );
  const shorts = await loadAll(
    (from, to) => {
      // Shorts are embedded with their Claude format label, so wait until they have one.
      let q = db.from("youtube_shorts").select("video_id, format, title, description").not("format", "is", null);
      if (!options.all) q = q.is("embedding", null);
      return q.order("published_at").range(from, to);
    },
    "Shorts to embed",
  );
  const result: EmbedRun = { clips: 0, shorts: 0, tokens: 0, requests: 0, costUsd: 0, mock: false };
  if (clips.length === 0 && shorts.length === 0) {
    log("Every clip and Short already has an embedding.");
    return result;
  }
  log(`Embedding ${clips.length} clips and ${shorts.length} Shorts with ${EMBEDDING_MODEL}.`);

  const { data: run, error: runError } = await db.from("agent_runs").insert({ kind: "embeddings", model: EMBEDDING_MODEL }).select("id").single();
  if (runError) throw new Error(`Failed to start the embeddings run log: ${runError.message}`);

  let fatal: string | null = null;
  try {
    const items = [
      ...clips.map((c) => ({ kind: "clip" as const, id: c.id, text: clipEmbeddingText(c) })),
      ...shorts.map((s) => ({ kind: "short" as const, id: s.video_id, text: shortEmbeddingText(s) })),
    ];
    for (let i = 0; i < items.length; i += ROUND) {
      const round = items.slice(i, i + ROUND);
      const embedded = await embedTexts(round.map((r) => r.text));
      if (embedded.mock) throw new Error("VOYAGE_API_KEY isn't set, so nothing was embedded. Mock vectors are never saved.");
      result.tokens += embedded.tokens;
      result.requests += embedded.requests;
      const embeddedAt = new Date().toISOString();
      // One update per row: vector payloads are large, and a failed row shouldn't sink the round.
      await Promise.all(
        round.map(async (item, j) => {
          const values = { embedding: toPgVector(embedded.vectors[j]), embedding_model: EMBEDDING_MODEL, embedded_at: embeddedAt };
          const { error } =
            item.kind === "clip"
              ? await db.from("clips").update(values).eq("id", item.id)
              : await db.from("youtube_shorts").update(values).eq("video_id", item.id);
          if (error) throw new Error(`Failed to save the embedding for ${item.kind} ${item.id}: ${error.message}`);
          if (item.kind === "clip") result.clips++;
          else result.shorts++;
        }),
      );
      log(`  Embedded ${Math.min(i + ROUND, items.length)} of ${items.length}.`);
    }
  } catch (error) {
    fatal = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    result.costUsd = embeddingCostUsd(result.tokens);
    log(
      `Embedded ${result.clips} clips and ${result.shorts} Shorts in ${result.requests} requests: ${result.tokens} tokens, ` +
        `about $${result.costUsd.toFixed(4)} at list price (Voyage's free allowance covers the first 200M tokens).`,
    );
    const { error } = await db
      .from("agent_runs")
      .update({
        finished_at: new Date().toISOString(),
        items_processed: result.clips + result.shorts,
        input_tokens: result.tokens,
        cost_usd: result.costUsd,
        error: fatal,
      })
      .eq("id", run.id);
    if (error) console.error(`Failed to finish the embeddings run log: ${error.message}`);
  }
  return result;
}

export type SimilarShort = {
  videoId: string;
  title: string;
  format: ShortFormat | null;
  publishedAt: string;
  settledViews: number;
  /** Cosine similarity, 1 is identical. */
  similarity: number;
};

/**
 * The 5 Shorts most similar to a clip, among Shorts with settled views that are at least
 * 7 days old. Empty when the clip has no embedding yet.
 */
export async function findSimilarShorts(db: Db, clip: { id: string; embedding: string | null }, count = SIMILAR_COUNT): Promise<SimilarShort[]> {
  if (!clip.embedding) return [];
  const { data, error } = await db.rpc("match_similar_shorts", {
    query_embedding: clip.embedding,
    match_count: count,
    min_age_days: SIMILAR_MIN_AGE_DAYS,
    exclude_clip_id: clip.id,
  });
  if (error) throw new Error(`Failed to find similar Shorts: ${error.message}`);
  return data.map((r) => ({
    videoId: r.video_id,
    title: r.title,
    format: r.format as ShortFormat | null,
    publishedAt: r.published_at,
    settledViews: r.settled_views,
    similarity: r.similarity,
  }));
}
