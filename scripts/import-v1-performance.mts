/**
 * Imports V1 clip performance from a CSV into source_videos, clips, posts, and metrics.
 *
 *   npm run import:v1 -- <path-to.csv> [--dry-run]
 *
 * One row per clip per platform. See data/v1-clip-performance.sample.csv for the columns.
 * The whole file is validated before anything is written. Re-running the same file is safe:
 * videos, clips, and posts are matched and updated, and a metrics snapshot is only added
 * once per post and captured_at. Without Supabase env vars it validates and stops (dry run).
 */
import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/database.types.ts";

type Format = Database["public"]["Enums"]["clip_format"];
type Platform = Database["public"]["Enums"]["platform"];

const FORMATS: Format[] = ["mock", "conversational"];
const PLATFORMS: Platform[] = ["youtube", "tiktok", "instagram"];
const METRIC_COLUMNS = ["views", "avg_percent_watched", "shares", "saves", "follows_gained", "comments"] as const;
const REQUIRED_COLUMNS = [
  "source_video_url",
  "source_video_title",
  "source_video_channel",
  "clip_title",
  "format",
  "platform",
  "posted_at",
] as const;
const ALL_COLUMNS = [
  ...REQUIRED_COLUMNS,
  "platform_post_id",
  "caption",
  "captured_at",
  ...METRIC_COLUMNS,
];

type Metrics = Record<(typeof METRIC_COLUMNS)[number], number | null>;

type ImportRow = {
  line: number;
  videoUrl: string;
  videoTitle: string;
  channel: string;
  clipTitle: string;
  format: Format;
  platform: Platform;
  platformPostId: string | null;
  postedAt: string;
  caption: string | null;
  capturedAt: string | null;
  metrics: Metrics | null;
};

function fail(message: string): never {
  console.error(`\n${message}`);
  process.exit(1);
}

// Parsing and validation ------------------------------------------------------

function parseTimestamp(value: string) {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function parseRow(raw: Record<string, string>, line: number, errors: string[]): ImportRow | null {
  const err = (msg: string) => errors.push(`Line ${line}: ${msg}`);
  const startErrors = errors.length;

  for (const col of REQUIRED_COLUMNS) if (!raw[col]) err(`${col} is required`);

  const format = raw.format?.toLowerCase() as Format;
  if (raw.format && !FORMATS.includes(format)) err(`format must be one of ${FORMATS.join(", ")}, got "${raw.format}"`);

  const platform = raw.platform?.toLowerCase() as Platform;
  if (raw.platform && !PLATFORMS.includes(platform))
    err(`platform must be one of ${PLATFORMS.join(", ")}, got "${raw.platform}"`);

  const postedAt = raw.posted_at ? parseTimestamp(raw.posted_at) : null;
  if (raw.posted_at && !postedAt) err(`posted_at is not a valid date: "${raw.posted_at}"`);

  const capturedAt = raw.captured_at ? parseTimestamp(raw.captured_at) : null;
  if (raw.captured_at && !capturedAt) err(`captured_at is not a valid date: "${raw.captured_at}"`);

  const metrics = {} as Metrics;
  for (const col of METRIC_COLUMNS) {
    const value = raw[col];
    if (!value) {
      metrics[col] = null;
      continue;
    }
    const n = Number(value.replace(/,/g, ""));
    const isPercent = col === "avg_percent_watched";
    if (!Number.isFinite(n) || n < 0 || (!isPercent && !Number.isInteger(n)) || (isPercent && n > 100)) {
      err(`${col} must be ${isPercent ? "a number from 0 to 100" : "a whole number of 0 or more"}, got "${value}"`);
    }
    metrics[col] = n;
  }
  const hasMetrics = METRIC_COLUMNS.some((col) => metrics[col] !== null);
  if (hasMetrics && !capturedAt && !raw.captured_at) err("captured_at is required when metrics are present");

  if (errors.length > startErrors) return null;
  return {
    line,
    videoUrl: raw.source_video_url,
    videoTitle: raw.source_video_title,
    channel: raw.source_video_channel,
    clipTitle: raw.clip_title,
    format,
    platform,
    platformPostId: raw.platform_post_id || null,
    postedAt: postedAt!,
    caption: raw.caption || null,
    capturedAt,
    metrics: hasMetrics ? metrics : null,
  };
}

const clipKey = (r: { videoUrl: string; clipTitle: string }) => `${r.videoUrl}\n${r.clipTitle}`;

function loadRows(path: string) {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    fail(`Could not read ${path}`);
  }

  const records: Record<string, string>[] = parse(text, {
    columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });
  if (records.length === 0) fail("The CSV has no data rows.");

  const header = Object.keys(records[0]);
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) fail(`Missing required columns: ${missing.join(", ")}`);
  const unknown = header.filter((c) => !ALL_COLUMNS.includes(c));
  if (unknown.length) console.warn(`Ignoring unknown columns: ${unknown.join(", ")}`);

  const errors: string[] = [];
  // Line 1 is the header.
  const rows = records.flatMap((raw, i) => parseRow(raw, i + 2, errors) ?? []);

  // Cross-row checks: one row per clip per platform, and one format per clip.
  const seenPosts = new Map<string, number>();
  const clipFormats = new Map<string, ImportRow>();
  for (const row of rows) {
    const postKey = `${clipKey(row)}\n${row.platform}`;
    const firstLine = seenPosts.get(postKey);
    if (firstLine) errors.push(`Line ${row.line}: duplicate of line ${firstLine} (same clip and platform)`);
    else seenPosts.set(postKey, row.line);

    const first = clipFormats.get(clipKey(row));
    if (first && first.format !== row.format)
      errors.push(`Line ${row.line}: format "${row.format}" conflicts with "${first.format}" on line ${first.line} for the same clip`);
    else if (!first) clipFormats.set(clipKey(row), row);
  }

  if (errors.length) {
    const lineOf = (e: string) => Number(e.match(/^Line (\d+)/)?.[1] ?? 0);
    errors.sort((a, b) => lineOf(a) - lineOf(b));
    fail(`Found ${errors.length} problem(s). Nothing was imported.\n  ${errors.join("\n  ")}`);
  }
  return rows;
}

// Import --------------------------------------------------------------------

function check<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error || result.data === null) fail(`Failed to ${what}: ${result.error?.message ?? "no data returned"}`);
  return result.data;
}

async function importRows(rows: ImportRow[], url: string, serviceKey: string) {
  const db = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // 1. Source videos, matched on youtube_url.
  const videos = new Map(rows.map((r) => [r.videoUrl, { youtube_url: r.videoUrl, title: r.videoTitle, channel: r.channel }]));
  const videoRows = check(
    await db.from("source_videos").upsert([...videos.values()], { onConflict: "youtube_url" }).select("id, youtube_url"),
    "upsert source videos",
  );
  const videoIdByUrl = new Map(videoRows.map((v) => [v.youtube_url, v.id]));

  // 2. Clips, matched on source video and title.
  const existingClips = check(
    await db.from("clips").select("id, source_video_id, title").in("source_video_id", [...videoIdByUrl.values()]),
    "load existing clips",
  );
  const clipIdByKey = new Map<string, string>();
  const urlByVideoId = new Map([...videoIdByUrl].map(([u, id]) => [id, u]));
  for (const c of existingClips) clipIdByKey.set(clipKey({ videoUrl: urlByVideoId.get(c.source_video_id)!, clipTitle: c.title }), c.id);

  const newClips = new Map<string, Database["public"]["Tables"]["clips"]["Insert"]>();
  for (const r of rows) {
    if (clipIdByKey.has(clipKey(r)) || newClips.has(clipKey(r))) continue;
    newClips.set(clipKey(r), {
      source_video_id: videoIdByUrl.get(r.videoUrl)!,
      title: r.clipTitle,
      format: r.format,
      status: "posted",
    });
  }
  if (newClips.size) {
    const inserted = check(
      await db.from("clips").insert([...newClips.values()]).select("id, source_video_id, title"),
      "insert clips",
    );
    for (const c of inserted) clipIdByKey.set(clipKey({ videoUrl: urlByVideoId.get(c.source_video_id)!, clipTitle: c.title }), c.id);
  }

  // 3. Posts, one per clip per platform.
  const postRows = check(
    await db
      .from("posts")
      .upsert(
        rows.map((r) => ({
          clip_id: clipIdByKey.get(clipKey(r))!,
          platform: r.platform,
          platform_post_id: r.platformPostId,
          posted_at: r.postedAt,
          caption: r.caption,
          status: "posted" as const,
        })),
        { onConflict: "clip_id,platform" },
      )
      .select("id, clip_id, platform"),
    "upsert posts",
  );
  const postIdByKey = new Map(postRows.map((p) => [`${p.clip_id}\n${p.platform}`, p.id]));

  // 4. Metrics snapshots, skipping any already stored for the same post and captured_at.
  const withMetrics = rows.filter((r) => r.metrics);
  const postIds = withMetrics.map((r) => postIdByKey.get(`${clipIdByKey.get(clipKey(r))}\n${r.platform}`)!);
  const existingSnapshots = postIds.length
    ? check(await db.from("metrics").select("post_id, captured_at").in("post_id", postIds), "load existing metrics")
    : [];
  const seen = new Set(existingSnapshots.map((m) => `${m.post_id}\n${Date.parse(m.captured_at)}`));
  const newMetrics = withMetrics.flatMap((r, i) => {
    const postId = postIds[i];
    if (seen.has(`${postId}\n${Date.parse(r.capturedAt!)}`)) return [];
    return [{ post_id: postId, captured_at: r.capturedAt!, ...r.metrics! }];
  });
  if (newMetrics.length) check(await db.from("metrics").insert(newMetrics).select("id"), "insert metrics");

  return {
    videos: videos.size,
    clipsCreated: newClips.size,
    clipsMatched: new Set(rows.map(clipKey)).size - newClips.size,
    posts: postRows.length,
    metricsAdded: newMetrics.length,
    metricsSkipped: withMetrics.length - newMetrics.length,
  };
}

// Main ----------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const path = args.find((a) => !a.startsWith("--"));
  if (!path) fail("Usage: npm run import:v1 -- <path-to.csv> [--dry-run]");

  const rows = loadRows(path);
  const clips = new Set(rows.map(clipKey)).size;
  const videos = new Set(rows.map((r) => r.videoUrl)).size;
  const snapshots = rows.filter((r) => r.metrics).length;
  console.log(`Validated ${rows.length} rows: ${videos} source videos, ${clips} clips, ${rows.length} posts, ${snapshots} metrics snapshots.`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (dryRun || !url || !serviceKey) {
    console.log(
      dryRun
        ? "Dry run: nothing was written."
        : "Supabase isn't configured (NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY), so this was a dry run. Nothing was written.",
    );
    return;
  }

  const result = await importRows(rows, url, serviceKey);
  console.log(
    [
      `Imported into ${new URL(url).host}:`,
      `  source videos: ${result.videos} upserted`,
      `  clips: ${result.clipsCreated} created, ${result.clipsMatched} already existed`,
      `  posts: ${result.posts} upserted`,
      `  metrics: ${result.metricsAdded} added, ${result.metricsSkipped} already existed`,
    ].join("\n"),
  );
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
