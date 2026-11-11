import "server-only";
import type { Db } from "@/lib/db/client";
import { addUsage, emptyUsage, estimateCostUsd, LABEL_MODEL, labelShortFormat, type ShortForLabel, type TokenUsage } from "@/lib/integrations/claude";
import { isIntegrationConnected } from "@/lib/integrations/config";

// Labels each YouTube Short's content format (mock interview, conversational, explainer,
// or other) with Claude Haiku from its title, description, and thumbnail. Each run is
// logged to agent_runs (kind "short_labels") with its token usage and estimated cost.

const CONCURRENCY = 8;
const PAGE = 1000;

export type LabelRun = {
  model: string;
  labeled: number;
  failed: { videoId: string; title: string; error: string }[];
  usage: TokenUsage;
  costUsd: number | null;
};

type Row = { video_id: string; title: string; description: string; thumbnail_url: string | null };

async function fetchThumbnail(row: Row): Promise<ShortForLabel["thumbnail"]> {
  const url = row.thumbnail_url ?? `https://i.ytimg.com/vi/${row.video_id}/hqdefault.jpg`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "image/jpeg";
    const mediaType = type.includes("png") ? "image/png" : type.includes("webp") ? "image/webp" : "image/jpeg";
    return { data: Buffer.from(await res.arrayBuffer()), mediaType };
  } catch {
    // The title and description still get a label without the thumbnail.
    return null;
  }
}

/** Labels Shorts that have no label yet, or every Short with `all`. Skips quietly when Claude isn't connected. */
export async function labelShorts(db: Db, options: { all?: boolean; log?: (line: string) => void } = {}): Promise<LabelRun | null> {
  const log = options.log ?? (() => {});
  if (!isIntegrationConnected("claude")) {
    log("Claude isn't connected, so new Shorts weren't labeled.");
    return null;
  }

  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = db.from("youtube_shorts").select("video_id, title, description, thumbnail_url").order("published_at", { ascending: false });
    if (!options.all) query = query.is("format", null);
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) throw new Error(`Failed to load Shorts to label: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  if (rows.length === 0) {
    log("Every Short already has a format label.");
    return { model: LABEL_MODEL, labeled: 0, failed: [], usage: emptyUsage(), costUsd: 0 };
  }

  const { data: run, error: runError } = await db.from("agent_runs").insert({ kind: "short_labels", model: LABEL_MODEL }).select("id").single();
  if (runError) throw new Error(`Failed to start the labeling run log: ${runError.message}`);

  const result: LabelRun = { model: LABEL_MODEL, labeled: 0, failed: [], usage: emptyUsage(), costUsd: 0 };
  let next = 0;
  async function worker() {
    while (next < rows.length) {
      const row = rows[next++];
      try {
        const label = await labelShortFormat({ title: row.title, description: row.description, thumbnail: await fetchThumbnail(row) });
        result.usage = addUsage(result.usage, label.usage);
        const { error } = await db
          .from("youtube_shorts")
          .update({
            format: label.format,
            format_confidence: label.confidence,
            format_reason: label.reason,
            format_model: LABEL_MODEL,
            format_labeled_at: new Date().toISOString(),
          })
          .eq("video_id", row.video_id);
        if (error) throw new Error(`couldn't save: ${error.message}`);
        result.labeled++;
        if (result.labeled % 50 === 0) log(`  Labeled ${result.labeled} of ${rows.length}.`);
      } catch (e) {
        result.failed.push({ videoId: row.video_id, title: row.title, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));

  result.costUsd = estimateCostUsd(LABEL_MODEL, result.usage);
  const { usage } = result;
  log(
    `Labeled ${result.labeled} Shorts with ${LABEL_MODEL}, ${result.failed.length} failed. Tokens: ${usage.input} input, ${usage.output} output. ` +
      `Estimated cost: ${result.costUsd === null ? "unknown" : `$${result.costUsd.toFixed(4)}`}.`,
  );
  const { error } = await db
    .from("agent_runs")
    .update({
      finished_at: new Date().toISOString(),
      items_processed: result.labeled,
      items_failed: result.failed.length,
      input_tokens: usage.input,
      output_tokens: usage.output,
      cache_read_input_tokens: usage.cacheRead,
      cache_creation_input_tokens: usage.cacheWrite,
      cost_usd: result.costUsd,
      error: result.failed.length ? result.failed.map((f) => `${f.title}: ${f.error}`).join("\n") : null,
    })
    .eq("id", run.id);
  if (error) console.error(`Failed to finish the labeling run log: ${error.message}`);
  return result;
}
