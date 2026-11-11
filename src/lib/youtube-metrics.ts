import "server-only";
import type { Db } from "@/lib/db/client";
import { listChannelShorts, type ChannelShort } from "@/lib/integrations/youtube";
import { captionTitle } from "@/lib/weeks";
import { MARK_WINDOW_MS, MARKS, viewsAtMark, type Snapshot } from "@/lib/youtube-marks";

// MVP 2 metrics pull: saves every Short on the channel, a timestamped snapshot of its
// views, likes, and comments, its views at 48 hours and 7 days, and links Shorts we
// posted through the dashboard to their YouTube video IDs.

const CHUNK = 500;
const HOUR_MS = 60 * 60 * 1000;
/** A Short we posted must go live within this long of its post or scheduled time. */
const MATCH_WINDOW_MS = 3 * HOUR_MS;
/** Don't flag a post as unmatched until YouTube has had this long to publish it. */
const MATCH_GRACE_MS = 1 * HOUR_MS;

export type PullResult = {
  shortsFound: number;
  newShorts: number;
  videosChecked: number;
  quotaUnits: number;
  snapshotsSaved: number;
  matched: number;
  unmatched: { title: string; expectedAt: string; note: string }[];
};

function chunks<T>(items: T[], size = CHUNK) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Lowercase letters, digits, and single spaces, so punctuation and emoji don't block a match. */
export const normalizeTitle = (title: string) =>
  title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Titles only: channel descriptions often plug mock interviews in boilerplate.
const guessFormat = (s: ChannelShort) => (/\bmock\b/i.test(s.title) ? ("mock" as const) : ("conversational" as const));

/** Pulls every Short on the channel and saves it. Running it again updates rows, never duplicates them. */
export async function pullYouTubeMetrics(db: Db, log: (line: string) => void = () => {}): Promise<PullResult> {
  const listing = await listChannelShorts();
  if (listing.mock) throw new Error("YouTube isn't connected, so there's nothing real to save. Set YOUTUBE_API_KEY and YOUTUBE_CHANNEL_ID.");
  const { shorts } = listing;
  const capturedAt = new Date().toISOString();
  log(`Checked ${listing.videosChecked} uploads with ${listing.quotaUnits} API calls: ${shorts.length} Shorts.`);

  // 1. Upsert the Shorts. Linked Shorts keep the format from their clip.
  const existing = new Map<string, { post_id: string | null }>();
  for (const ids of chunks(shorts.map((s) => s.videoId))) {
    const { data, error } = await db.from("youtube_shorts").select("video_id, post_id").in("video_id", ids);
    if (error) throw new Error(`Failed to load saved Shorts: ${error.message}`);
    for (const row of data) existing.set(row.video_id, { post_id: row.post_id });
  }
  const base = (s: ChannelShort) => ({
    video_id: s.videoId,
    title: s.title,
    description: s.description,
    published_at: s.publishedAt,
    duration_seconds: s.durationSeconds,
    views: s.views,
    likes: s.likes,
    comments: s.comments,
    last_pulled_at: capturedAt,
  });
  const linked = shorts.filter((s) => existing.get(s.videoId)?.post_id);
  const unlinked = shorts.filter((s) => !existing.get(s.videoId)?.post_id);
  for (const rows of chunks(linked.map(base))) {
    const { error } = await db.from("youtube_shorts").upsert(rows, { onConflict: "video_id" });
    if (error) throw new Error(`Failed to save Shorts: ${error.message}`);
  }
  for (const rows of chunks(unlinked.map((s) => ({ ...base(s), format: guessFormat(s), format_guessed: true })))) {
    const { error } = await db.from("youtube_shorts").upsert(rows, { onConflict: "video_id" });
    if (error) throw new Error(`Failed to save Shorts: ${error.message}`);
  }

  // 2. One timestamped snapshot per Short per pull.
  let snapshotsSaved = 0;
  for (const rows of chunks(shorts.map((s) => ({ video_id: s.videoId, captured_at: capturedAt, views: s.views, likes: s.likes, comments: s.comments })))) {
    const { error } = await db.from("youtube_short_snapshots").upsert(rows, { onConflict: "video_id,captured_at", ignoreDuplicates: true });
    if (error) throw new Error(`Failed to save snapshots: ${error.message}`);
    snapshotsSaved += rows.length;
  }

  // 3. Views at 48 hours and 7 days. Only recent Shorts can still gain a nearby snapshot.
  await updateMarks(db, shorts.filter((s) => Date.parse(capturedAt) - Date.parse(s.publishedAt) <= MARK_WINDOW_MS + HOUR_MS));

  // 4. Link our posts.
  const { matched, unmatched } = await matchPosts(db, shorts);
  log(`Saved ${snapshotsSaved} snapshots. Matched ${matched} of our posts, ${unmatched.length} unmatched.`);

  return {
    shortsFound: shorts.length,
    newShorts: shorts.filter((s) => !existing.has(s.videoId)).length,
    videosChecked: listing.videosChecked,
    quotaUnits: listing.quotaUnits,
    snapshotsSaved,
    matched,
    unmatched,
  };
}

async function updateMarks(db: Db, shorts: ChannelShort[]) {
  if (shorts.length === 0) return;
  const byVideo = new Map<string, Snapshot[]>();
  for (const ids of chunks(shorts.map((s) => s.videoId), 100)) {
    const { data, error } = await db.from("youtube_short_snapshots").select("video_id, captured_at, views").in("video_id", ids);
    if (error) throw new Error(`Failed to load snapshots: ${error.message}`);
    for (const row of data) {
      const list = byVideo.get(row.video_id) ?? [];
      list.push({ capturedAt: row.captured_at, views: row.views });
      byVideo.set(row.video_id, list);
    }
  }
  for (const short of shorts) {
    const snapshots = byVideo.get(short.videoId) ?? [];
    const values: Partial<Record<(typeof MARKS)[number]["key"], number | null>> = {};
    for (const mark of MARKS) values[mark.key] = viewsAtMark(short.publishedAt, snapshots, mark);
    const { error } = await db.from("youtube_shorts").update(values).eq("video_id", short.videoId);
    if (error) throw new Error(`Failed to save views at 48h and 7d for "${short.title}": ${error.message}`);
  }
}

/**
 * Links YouTube posts we sent through the dashboard to their Short, by title (the
 * caption's first line) and a publish time within 3 hours of when it was posted or
 * scheduled. A matched scheduled post is marked posted. Posts whose time has passed
 * without a match get a note saying why.
 */
async function matchPosts(db: Db, shorts: ChannelShort[]) {
  const now = Date.now();
  const { data: posts, error } = await db
    .from("posts")
    .select("id, clip_id, caption, status, scheduled_for, posted_at, clips (title, youtube_title, format, status)")
    .eq("platform", "youtube")
    .in("status", ["posted", "scheduled"]);
  if (error) throw new Error(`Failed to load YouTube posts: ${error.message}`);

  const { data: links, error: linkError } = await db.from("youtube_shorts").select("video_id, post_id").not("post_id", "is", null);
  if (linkError) throw new Error(`Failed to load linked Shorts: ${linkError.message}`);
  const linkedPosts = new Set(links.map((l) => l.post_id));
  const takenVideos = new Set(links.map((l) => l.video_id));

  let matched = 0;
  const unmatched: PullResult["unmatched"] = [];
  for (const post of posts) {
    if (linkedPosts.has(post.id)) continue;
    const expectedAt = post.posted_at ?? post.scheduled_for;
    if (!expectedAt || Date.parse(expectedAt) > now - MATCH_GRACE_MS) continue;
    const title = post.caption ? captionTitle(post.caption) : (post.clips.youtube_title ?? post.clips.title);
    const wanted = normalizeTitle(title);

    const sameTitle = shorts.filter((s) => !takenVideos.has(s.videoId) && normalizeTitle(s.title) === wanted);
    const inWindow = sameTitle
      .map((s) => ({ s, gap: Math.abs(Date.parse(s.publishedAt) - Date.parse(expectedAt)) }))
      .filter((c) => c.gap <= MATCH_WINDOW_MS)
      .sort((a, b) => a.gap - b.gap);

    if (inWindow.length === 0) {
      const note = sameTitle.length
        ? `A Short with this title went live ${sameTitle.map((s) => s.publishedAt.slice(0, 16).replace("T", " ")).join(", ")} UTC, more than 3 hours from the post time.`
        : "No public Short on the channel has this title. It may have failed, been renamed, or still be private.";
      unmatched.push({ title, expectedAt, note });
      const { error: noteError } = await db.from("posts").update({ match_note: note }).eq("id", post.id);
      if (noteError) throw new Error(`Failed to flag "${title}": ${noteError.message}`);
      continue;
    }

    const short = inWindow[0].s;
    takenVideos.add(short.videoId);
    const { error: linkShortError } = await db
      .from("youtube_shorts")
      .update({ post_id: post.id, format: post.clips.format, format_guessed: false })
      .eq("video_id", short.videoId);
    if (linkShortError) throw new Error(`Failed to link "${title}": ${linkShortError.message}`);
    const { error: postError } = await db
      .from("posts")
      .update({ match_note: null, status: "posted", posted_at: post.posted_at ?? short.publishedAt })
      .eq("id", post.id);
    if (postError) throw new Error(`Failed to update the post for "${title}": ${postError.message}`);
    if (post.clips.status === "scheduled") {
      const { error: clipError } = await db.from("clips").update({ status: "posted" }).eq("id", post.clip_id);
      if (clipError) throw new Error(`Failed to mark "${title}" posted: ${clipError.message}`);
    }
    matched++;
  }
  return { matched, unmatched };
}
