import "server-only";
import { CAPTION_RULES, checkViewerText, formatCaption } from "@/lib/agent/rules";
import { rubricCategories } from "@/lib/clips";
import { runScoring, type ScoringRun } from "@/lib/clip-scoring";
import type { Db } from "@/lib/db/client";
import { isIntegrationConnected, isOpusMockForced } from "@/lib/integrations/config";
import {
  cancelScheduledPost,
  findBrandTemplateId,
  getClipRender,
  getProjectStage,
  listClips,
  listSocialAccounts,
  postNow,
  schedulePost,
  setClipHeadline,
  submitVideo,
  waitForRender,
  type OpusSocialAccount,
} from "@/lib/integrations/opus";
import { addUsage, CAPTIONS_MODEL, emptyUsage, estimateCostUsd, writeCaption } from "@/lib/integrations/claude";
import { getVideoInfo, normalizeYouTubeUrl } from "@/lib/integrations/youtube";
import { rankClips } from "@/lib/ranking";
import { saveOpusClips } from "@/lib/opus-sync";
import { easternDate } from "@/lib/schedule-slots";

// The weekly flow (see CLAUDE.md): submit 2 videos to Opus, sync and score their clips
// when Opus finishes, pick the top 7, then schedule one per day at noon Eastern.

export const VIDEOS_PER_WEEK = 2;
export const PICKS_PER_WEEK = 7;

export type VideoStatus = "submitted" | "processing" | "ready" | "failed";

/** Opus can be written to: a real key, or mock mode chosen on purpose with OPUSCLIP_MOCK. */
export function opusWritable() {
  return isIntegrationConnected("opus") || isOpusMockForced();
}

// Weeks -------------------------------------------------------------------------

/** The Monday of the current week in New York, as "YYYY-MM-DD". */
function currentWeekStart(now = new Date()) {
  const [y, m, d] = easternDate(now).split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

/**
 * Creates a week and submits each YouTube link to Opus with the Aced template. Spends
 * Opus credits, so callers must get the user's confirmation first.
 */
export async function startWeek(db: Db, links: string[]) {
  const urls = links.map((link) => normalizeYouTubeUrl(link));
  if (urls.length !== VIDEOS_PER_WEEK || urls.some((u) => !u)) {
    throw new Error(`Paste ${VIDEOS_PER_WEEK} YouTube video links.`);
  }
  if (new Set(urls).size !== urls.length) throw new Error("The two links are the same video.");

  const { data: existing, error: existingError } = await db.from("source_videos").select("title, youtube_url").in("youtube_url", urls as string[]);
  if (existingError) throw new Error(`Failed to check for duplicates: ${existingError.message}`);
  if (existing.length) throw new Error(`Already submitted: ${existing.map((v) => `"${v.title}"`).join(", ")}.`);

  // Check every link before spending any credits.
  const videos = await Promise.all(
    (urls as string[]).map(async (url) => {
      const info = await getVideoInfo(url);
      if (!info) throw new Error(`Couldn't find a public YouTube video at ${url}.`);
      return { url, ...info };
    }),
  );
  const brandTemplateId = await findBrandTemplateId();
  if (!brandTemplateId) throw new Error('No "Aced Template #1" brand template found in Opus. Set OPUSCLIP_BRAND_TEMPLATE_NAME.');

  const { data: week, error: weekError } = await db.from("weeks").insert({ starts_on: currentWeekStart() }).select("id").single();
  if (weekError) throw new Error(`Failed to create the week: ${weekError.message}`);

  // One at a time, saving each, so a failed second submit doesn't lose the first.
  const failed: string[] = [];
  for (const video of videos) {
    try {
      const { projectId } = await submitVideo({ videoUrl: video.url, title: video.title, brandTemplateId, autoHeadline: true });
      const { error } = await db.from("source_videos").insert({
        youtube_url: video.url,
        title: video.title,
        channel: video.channelTitle,
        opus_project_id: projectId,
        week_id: week.id,
        opus_status: "submitted",
        opus_checked_at: new Date().toISOString(),
      });
      if (error) throw new Error(`submitted to Opus as ${projectId} but not saved: ${error.message}`);
    } catch (error) {
      failed.push(`"${video.title}": ${error instanceof Error ? error.message : error}`);
    }
  }
  return { weekId: week.id, submitted: videos.length - failed.length, failed };
}

/** Maps an Opus project stage to our status. Unknown and in-flight stages are processing. */
function statusFromStage(stage: string | null): VideoStatus {
  if (stage === "COMPLETE") return "ready";
  if (stage && /fail|error|cancel/i.test(stage)) return "failed";
  return "processing";
}

export type WeekStatusResult = { newlyReady: string[]; stillProcessing: number; failed: string[]; scoring: ScoringRun | null; picked: number };

/**
 * Checks each of the week's videos with Opus. Syncs clips from finished projects, scores
 * them, and picks the top 7 once every video is ready and no picks exist yet.
 */
export async function checkWeek(db: Db, weekId: string): Promise<WeekStatusResult> {
  const { data: videos, error } = await db.from("source_videos").select("id, title, opus_project_id, opus_status").eq("week_id", weekId);
  if (error) throw new Error(`Failed to load the week's videos: ${error.message}`);

  const result: WeekStatusResult = { newlyReady: [], stillProcessing: 0, failed: [], scoring: null, picked: 0 };
  for (const video of videos) {
    if (video.opus_status === "ready" || !video.opus_project_id) continue;
    const status = statusFromStage(await getProjectStage(video.opus_project_id));
    if (status === "ready") {
      const clips = await listClips(video.opus_project_id);
      // Opus can report complete a moment before its clips are listed.
      if (clips.length === 0) {
        result.stillProcessing++;
        await db.from("source_videos").update({ opus_status: "processing", opus_checked_at: new Date().toISOString() }).eq("id", video.id);
        continue;
      }
      await saveOpusClips(db, video, clips);
      result.newlyReady.push(video.title);
    } else if (status === "failed") {
      result.failed.push(video.title);
    } else {
      result.stillProcessing++;
    }
    const { error: saveError } = await db
      .from("source_videos")
      .update({ opus_status: status, opus_checked_at: new Date().toISOString() })
      .eq("id", video.id);
    if (saveError) throw new Error(`Failed to save status for "${video.title}": ${saveError.message}`);
  }

  if (result.newlyReady.length) result.scoring = await runScoring(db);
  const allDone = videos.every((v) => v.opus_status === "ready" || result.newlyReady.includes(v.title) || result.failed.includes(v.title));
  if (allDone) result.picked = await autoPick(db, weekId);
  return result;
}

// Picks -------------------------------------------------------------------------

/** Kept, scored clips from the week's videos, best first by rubric and predicted views (see src/lib/ranking.ts). */
export async function rankedWeekClips(db: Db, weekId: string) {
  const { data, error } = await db
    .from("clips")
    .select(
      "id, title, suggested_title, picked, status, score_total, score_hook, score_tension, score_standalone, score_payoff, score_loopability, predicted_views_low, predicted_views_expected, predicted_views_high, source_videos!inner (week_id)",
    )
    .eq("source_videos.week_id", weekId)
    .in("status", ["candidate", "approved"])
    .not("score_total", "is", null);
  if (error) throw new Error(`Failed to load the week's clips: ${error.message}`);
  const score = (c: (typeof data)[number], k: string) => c[`score_${k}` as keyof typeof c] as number;
  // Rubric order first, so ties in rank score fall back to the rubric categories.
  const byRubric = data.sort((a, b) => b.score_total! - a.score_total! || rubricCategories.reduce((d, k) => d || score(b, k) - score(a, k), 0));
  return rankClips(byRubric.map((c) => ({ ...c, rubricTotal: c.score_total!, expectedViews: c.predicted_views_expected })));
}

/** Picks the top 7 kept clips by rubric when the week has no picks yet. Returns how many were picked. */
export async function autoPick(db: Db, weekId: string) {
  const ranked = await rankedWeekClips(db, weekId);
  if (ranked.some((c) => c.picked)) return 0;
  const top = ranked.slice(0, PICKS_PER_WEEK).map((c) => c.id);
  if (top.length === 0) return 0;
  const { error } = await db.from("clips").update({ picked: true }).in("id", top);
  if (error) throw new Error(`Failed to save picks: ${error.message}`);
  // Every pick needs a headline before it can be scheduled, so add them now. A failure
  // here leaves the picks in place; the Schedule button shows what's still missing.
  await addMissingHeadlines(db, weekId).catch((e) => console.error("Adding headlines to new picks failed:", e));
  return top.length;
}

type HeadlineClip = { id: string; title: string; suggested_title: string | null; opus_clip_id: string | null };

/** Adds the suggested factual title as a headline when the clip has none. Returns whether it added one. */
async function ensureHeadline(clip: HeadlineClip) {
  if (!clip.opus_clip_id) throw new Error(`"${clip.title}" didn't come from Opus, so it can't get a headline.`);
  if ((await getClipRender(clip.opus_clip_id)).headline) return false;
  await setClipHeadline(clip.opus_clip_id, clip.suggested_title ?? clip.title);
  return true;
}

/**
 * Gives every unscheduled pick in the week a headline, using its suggested factual title.
 * Opus re-renders each one (no credits). Returns the titles that got one and any failures.
 */
export async function addMissingHeadlines(db: Db, weekId: string) {
  const { data: picks, error } = await db
    .from("clips")
    .select("id, title, suggested_title, opus_clip_id, source_videos!inner (week_id)")
    .eq("source_videos.week_id", weekId)
    .eq("picked", true)
    .in("status", ["candidate", "approved"]);
  if (error) throw new Error(`Failed to load picks: ${error.message}`);
  const added: string[] = [];
  const failed: string[] = [];
  await Promise.all(
    picks.map(async (clip) => {
      try {
        if (await ensureHeadline(clip)) added.push(clip.suggested_title ?? clip.title);
      } catch (e) {
        failed.push(`"${clip.title}": ${e instanceof Error ? e.message : e}`);
      }
    }),
  );
  return { added, failed, total: picks.length };
}

/** Selects or unselects one of the week's kept clips. At most 7 picks at a time. */
export async function setPick(db: Db, weekId: string, clipId: string, picked: boolean) {
  const ranked = await rankedWeekClips(db, weekId);
  const clip = ranked.find((c) => c.id === clipId);
  if (!clip) throw new Error("Only kept clips from this week can be picked.");
  if (picked && !clip.picked && ranked.filter((c) => c.picked).length >= PICKS_PER_WEEK) {
    throw new Error(`Already ${PICKS_PER_WEEK} picks. Unselect one first.`);
  }
  // Unpicking a clip saved as Ready to schedule puts it back with the other candidates.
  const { error } = await db.from("clips").update(picked ? { picked } : { picked, status: "candidate" }).eq("id", clipId);
  if (error) throw new Error(`Failed to save the pick: ${error.message}`);
  if (!picked) return { headlineAdded: false };

  // A clip swapped into the picks gets its headline right away.
  const { data: full, error: loadError } = await db.from("clips").select("id, title, suggested_title, opus_clip_id").eq("id", clipId).single();
  if (loadError) throw new Error(`Picked, but couldn't load the clip to add its headline: ${loadError.message}`);
  return { headlineAdded: await ensureHeadline(full) };
}

// Posting -----------------------------------------------------------------------
// Clips go out through OpusClip to YouTube, TikTok, and Instagram, either scheduled or
// right away. Only the accounts below are allowed, and every post needs the user's
// confirmation in the UI first.

export const PLATFORMS = ["youtube", "tiktok", "instagram"] as const;
export type PostPlatform = (typeof PLATFORMS)[number];

const FORBIDDEN_ACCOUNT = /ace\s*your\s*interviews/i;

/** Which connected Opus account each platform may post to. Names can be overridden by env. */
const ACCOUNT_RULES: Record<PostPlatform, { opusPlatform: string; name: () => string; exact: boolean; label: string }> = {
  youtube: { opusPlatform: "YOUTUBE", name: () => process.env.OPUSCLIP_YOUTUBE_ACCOUNT_NAME?.trim() || "Exponent", exact: true, label: "YouTube" },
  tiktok: { opusPlatform: "TIKTOK_BUSINESS", name: () => process.env.OPUSCLIP_TIKTOK_ACCOUNT_NAME?.trim() || "Aced", exact: false, label: "TikTok" },
  instagram: { opusPlatform: "INSTAGRAM_BUSINESS", name: () => process.env.OPUSCLIP_INSTAGRAM_ACCOUNT_NAME?.trim() || "Aced", exact: false, label: "Instagram" },
};

export type PostAccount = OpusSocialAccount & { platformLabel: string; handle: string };

/** "@aced_io" style handle from the profile link (TikTok uses /@name, Instagram /name), else the name. */
function handleFor(account: OpusSocialAccount) {
  const url = account.profileUrl ?? "";
  const handle = url.match(/tiktok\.com\/@([\w.]+)/)?.[1] ?? url.match(/instagram\.com\/([\w.]+)/)?.[1];
  return handle ? `@${handle}` : account.name;
}

/**
 * Looks up the account for each platform in Opus's connected social accounts. YouTube must
 * be the channel named "Exponent"; TikTok and Instagram must each be the one account named
 * like "Aced". Refuses Ace Your Interviews, a missing account, or more than one candidate
 * (listing them so the user can choose by setting the account name).
 */
export async function resolvePostAccounts(): Promise<Record<PostPlatform, PostAccount>> {
  const accounts = await listSocialAccounts();
  const resolve = (platform: PostPlatform): PostAccount => {
    const rule = ACCOUNT_RULES[platform];
    const name = rule.name();
    if (FORBIDDEN_ACCOUNT.test(name)) throw new Error(`Refusing to post to "${name}". Ace Your Interviews is never allowed.`);
    const onPlatform = accounts.filter((a) => a.platform === rule.opusPlatform && !FORBIDDEN_ACCOUNT.test(a.name));
    const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const matches = onPlatform.filter((a) => (rule.exact ? a.name.trim().toLowerCase() === name.toLowerCase() : pattern.test(a.name)));
    const list = (xs: OpusSocialAccount[]) => xs.map((a) => `"${a.name}" (${handleFor(a)})`).join(", ") || "none";
    if (matches.length === 0) throw new Error(`No ${rule.label} account named "${name}" is connected in Opus. Connected: ${list(onPlatform)}.`);
    if (matches.length > 1) {
      throw new Error(`More than one ${rule.label} account matches "${name}": ${list(matches)}. Tell me which one to use (set OPUSCLIP_${platform.toUpperCase()}_ACCOUNT_NAME).`);
    }
    const account = matches[0];
    if (platform === "youtube") {
      // A configured ID must agree with the lookup. Mock mode only has mock IDs, so it skips this.
      const configured = isIntegrationConnected("opus") ? process.env.OPUSCLIP_YOUTUBE_POST_ACCOUNT_ID?.trim() : undefined;
      if (configured && configured !== account.postAccountId) {
        const other = accounts.find((a) => a.postAccountId === configured);
        throw new Error(`OPUSCLIP_YOUTUBE_POST_ACCOUNT_ID points to "${other?.name ?? configured}", not the "${name}" YouTube channel. Refusing to post.`);
      }
    }
    if (platform === "instagram" && !account.subAccountId) throw new Error(`The Instagram account "${account.name}" has no sub-account ID in Opus.`);
    return { ...account, platformLabel: rule.label, handle: handleFor(account) };
  };
  return { youtube: resolve("youtube"), tiktok: resolve("tiktok"), instagram: resolve("instagram") };
}

/** New York dates ("YYYY-MM-DD") that already have an upcoming post on any platform. */
export async function bookedDates(db: Db) {
  const { data, error } = await db.from("posts").select("scheduled_for").eq("status", "scheduled").gte("scheduled_for", new Date().toISOString());
  if (error) throw new Error(`Failed to load scheduled posts: ${error.message}`);
  return [...new Set(data.flatMap((p) => (p.scheduled_for ? [easternDate(new Date(p.scheduled_for))] : [])))].sort();
}

export type PostingCheck = { clipId: string; headline: string; exportUrl: string | null };

/**
 * Gets clips ready to post: refuses if any has no headline (naming them all), then waits
 * for Opus to finish any render and checks the HD file (what Opus posts) includes the
 * clip's latest edit. Throws if any clip isn't ready, so nothing is posted.
 */
export async function prepareForPosting(clips: { id: string; opus_clip_id: string | null; suggested_title: string | null; title: string }[]) {
  const renders = await Promise.all(
    clips.map(async (clip) => {
      if (!clip.opus_clip_id) throw new Error(`"${clip.title}" didn't come from Opus, so it can't be posted through it.`);
      return { clip, render: await getClipRender(clip.opus_clip_id) };
    }),
  );
  const missing = renders.filter((r) => !r.render.headline).map((r) => `"${r.clip.suggested_title ?? r.clip.title}"`);
  if (missing.length) {
    throw new Error(`Nothing was posted. ${missing.length} ${missing.length === 1 ? "clip has" : "clips have"} no headline: ${missing.join(", ")}. Use Add missing headlines first.`);
  }
  return Promise.all(
    renders.map(async ({ clip, render: before }): Promise<PostingCheck> => {
      const after = before.rendering || !before.exportCurrent ? await waitForRender(clip.opus_clip_id!) : before;
      if (!after.headline) throw new Error(`"${clip.title}" still has no headline after rendering. Nothing was posted.`);
      if (!after.exportCurrent) throw new Error(`"${clip.title}" hasn't finished rendering with its headline. Nothing was posted.`);
      return { clipId: clip.id, headline: after.headline, exportUrl: after.exportUrl };
    }),
  );
}

// Captions ------------------------------------------------------------------------

/**
 * Writes the one caption (CAPTION_RULES) for each of the week's unscheduled picks that
 * doesn't have one: its factual title, 1 to 2 lines of context, and 3 to 5 hashtags. The
 * same caption is posted to every platform. Logged to agent_runs with its token cost.
 */
export async function writePickCaptions(db: Db, weekId: string) {
  const { data: picks, error } = await db
    .from("clips")
    .select("id, title, suggested_title, youtube_title, transcript, format, duration_seconds, source_videos!inner (week_id, title)")
    .eq("source_videos.week_id", weekId)
    .eq("picked", true)
    .in("status", ["candidate", "approved"])
    .is("caption", null);
  if (error) throw new Error(`Failed to load picks: ${error.message}`);
  if (picks.length === 0) return { written: 0, failed: [] as string[], costUsd: 0 };

  const model = isIntegrationConnected("claude") ? CAPTIONS_MODEL : "mock";
  let usage = emptyUsage();
  const failed: string[] = [];
  let written = 0;
  await Promise.all(
    picks.map(async (clip) => {
      try {
        const { caption, usage: used } = await writeCaption({
          // The factual title, as the user may have edited it, is the caption's first line.
          title: clip.youtube_title ?? clip.suggested_title ?? clip.title,
          transcript: clip.transcript ?? "",
          sourceVideoTitle: clip.source_videos.title,
          format: clip.format,
          durationSeconds: clip.duration_seconds,
        });
        usage = addUsage(usage, used);
        const { error: saveError } = await db
          .from("clips")
          .update({ caption: formatCaption(caption), captions_generated_at: new Date().toISOString() })
          .eq("id", clip.id);
        if (saveError) throw new Error(saveError.message);
        written++;
      } catch (e) {
        failed.push(`"${clip.suggested_title ?? clip.title}": ${e instanceof Error ? e.message : e}`);
      }
    }),
  );
  const costUsd = model === "mock" ? 0 : estimateCostUsd(model, usage);
  await db.from("agent_runs").insert({
    kind: "captions",
    model,
    finished_at: new Date().toISOString(),
    items_processed: written,
    items_failed: failed.length,
    input_tokens: usage.input,
    output_tokens: usage.output,
    cache_read_input_tokens: usage.cacheRead,
    cache_creation_input_tokens: usage.cacheWrite,
    cost_usd: costUsd,
    error: failed.length ? failed.join("\n") : null,
  });
  return { written, failed, costUsd };
}

// Scheduling and posting -------------------------------------------------------------

/**
 * One clip's posts, as set in the preview. publishAt is an ISO time, or null to post now.
 * The same caption goes to every platform; its first line is the post title.
 */
export type PostItem = {
  clipId: string;
  platforms: PostPlatform[];
  publishAt: string | null;
  caption: string;
  /** The clip was already posted and the user chose Post again. */
  repost?: boolean;
};

const CAPTION_MAX = 2200;
/** Opus needs a publish time in the future; leave room for the request to arrive. */
const MIN_LEAD_MS = 5 * 60 * 1000;

/** The caption's first line, used as the post title (YouTube's video title). */
export const captionTitle = (caption: string) => caption.trim().split("\n")[0].trim();

function cleanItem(item: PostItem) {
  return {
    ...item,
    platforms: PLATFORMS.filter((p) => item.platforms.includes(p)),
    caption: item.caption.replace(/\r\n/g, "\n").trim(),
  };
}

/** Problems with one clip's posts, labeled so the user can find them. Empty when fine. */
function itemIssues(item: ReturnType<typeof cleanItem>, label: string, now = Date.now()) {
  const issues: string[] = [];
  if (item.platforms.length === 0) issues.push(`${label}: pick at least one platform`);
  if (item.publishAt !== null) {
    const at = Date.parse(item.publishAt);
    if (!Number.isFinite(at)) issues.push(`${label}: pick a date and time`);
    else if (at < now + MIN_LEAD_MS) issues.push(`${label}: the time has to be at least 5 minutes from now`);
  }
  if (!item.caption) issues.push(`${label}: needs a caption`);
  if (item.caption.length > CAPTION_MAX) issues.push(`${label}: the caption is over ${CAPTION_MAX} characters`);
  const title = captionTitle(item.caption);
  if (item.platforms.includes("youtube") && title.length > CAPTION_RULES.youtube.titleMaxChars) {
    issues.push(`${label}: the caption's first line is the YouTube title and is ${title.length} characters; keep it under 60`);
  }
  issues.push(...checkViewerText(`${label} caption`, item.caption));
  return issues;
}

/** The week's picks, with what posting needs. */
async function loadPicks(db: Db, weekId: string) {
  const { data: picks, error } = await db
    .from("clips")
    .select("id, opus_clip_id, status, suggested_title, title, source_videos!inner (week_id)")
    .eq("source_videos.week_id", weekId)
    .eq("picked", true)
    .in("status", ["candidate", "approved", "scheduled", "posted"]);
  if (error) throw new Error(`Failed to load picks: ${error.message}`);
  return picks;
}

/** Saves the preview's captions. The first line also becomes the clip's title for display. */
async function saveText(db: Db, items: ReturnType<typeof cleanItem>[]) {
  for (const item of items) {
    const title = captionTitle(item.caption);
    const { error } = await db
      .from("clips")
      .update({ caption: item.caption, ...(title && { youtube_title: title }) })
      .eq("id", item.clipId);
    if (error) throw new Error(`Failed to save the caption: ${error.message}`);
  }
}

/**
 * Checks the items are this week's picks that can be posted: unscheduled ones, or posted
 * ones the user chose to Post again. Returns them cleaned up.
 */
async function checkItems(db: Db, weekId: string, items: PostItem[]) {
  const picks = await loadPicks(db, weekId);
  const reposts = new Set(items.filter((i) => i.repost === true).map((i) => i.clipId));
  const open = new Map(
    picks.filter((p) => p.status === "candidate" || p.status === "approved" || (p.status === "posted" && reposts.has(p.id))).map((p) => [p.id, p]),
  );
  if (items.length === 0) throw new Error("Nothing to post.");
  const alreadyPosted = items.filter((i) => !i.repost && picks.some((p) => p.id === i.clipId && p.status === "posted"));
  if (alreadyPosted.length) throw new Error("That clip was already posted. Use Post again to post it a second time.");
  if (new Set(items.map((i) => i.clipId)).size !== items.length || items.some((i) => !open.has(i.clipId))) {
    throw new Error("The picks changed since the preview opened. Close it and try again.");
  }
  const cleaned = items.map(cleanItem);
  return { picks, open, cleaned };
}

/**
 * Saves the week's unscheduled picks as Ready to schedule (status approved), with the
 * preview's titles and captions. Nothing is sent to Opus.
 */
export async function savePicksForLater(db: Db, weekId: string, items: PostItem[]) {
  const { cleaned } = await checkItems(db, weekId, items);
  await saveText(db, cleaned);
  const { error } = await db.from("clips").update({ status: "approved" }).in("id", cleaned.map((i) => i.clipId));
  if (error) throw new Error(`Failed to save the picks: ${error.message}`);
  return cleaned.length;
}

export type PublishedPost = { clipId: string; title: string; platform: PostPlatform; account: string; publishAt: string | null; opusId: string };

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Schedules clips (publishAt set) or posts them now (publishAt null) through OpusClip on
 * each clip's chosen platforms, with the preview's titles and captions. Checks every
 * clip's text, the accounts, and that each video has its headline rendered in before
 * anything is sent. Only call this after the user confirms in the UI.
 */
export async function publishClips(db: Db, weekId: string, items: PostItem[]) {
  const { picks, open, cleaned } = await checkItems(db, weekId, items);
  const scheduling = cleaned.some((i) => i.publishAt !== null);
  const postingNow = cleaned.filter((i) => i.publishAt === null);
  if (postingNow.length > 1 || (postingNow.length === 1 && cleaned.length > 1)) throw new Error("Post now works on one clip at a time.");
  if (scheduling && picks.length !== PICKS_PER_WEEK) throw new Error(`Pick exactly ${PICKS_PER_WEEK} clips to schedule; ${picks.length} are picked.`);

  const issues = cleaned.flatMap((item) => itemIssues(item, `"${captionTitle(item.caption) || open.get(item.clipId)!.title}"`));
  if (issues.length) throw new Error(`${issues.join(". ")}.`);

  // One scheduled post per clip and platform: catch it here, before anything reaches Opus.
  const { data: pendingPosts, error: pendingError } = await db
    .from("posts")
    .select("clip_id, platform")
    .eq("status", "scheduled")
    .in("clip_id", cleaned.map((i) => i.clipId));
  if (pendingError) throw new Error(`Failed to check scheduled posts: ${pendingError.message}`);
  const clash = cleaned.flatMap((i) =>
    i.platforms.filter((p) => pendingPosts.some((x) => x.clip_id === i.clipId && x.platform === p)).map((p) => `"${captionTitle(i.caption)}" on ${ACCOUNT_RULES[p].label}`),
  );
  if (clash.length) throw new Error(`Already scheduled: ${clash.join(", ")}. Cancel that post on the Schedule page first.`);

  // Save the preview's text first, so edits are kept even if posting fails.
  await saveText(db, cleaned);
  const accounts = await resolvePostAccounts();
  await prepareForPosting(cleaned.map((item) => open.get(item.clipId)!));

  const published: PublishedPost[] = [];
  try {
    for (const item of cleaned) {
      const [projectId, clipId] = open.get(item.clipId)!.opus_clip_id!.split(".");
      for (const platform of item.platforms) {
        const account = accounts[platform];
        // The same caption everywhere, as the description. Opus also requires a title: the
        // caption's first line (the factual title), which is YouTube's video title.
        const title = captionTitle(item.caption);
        const description = item.caption;
        const post = {
          projectId,
          clipId,
          postAccountId: account.postAccountId,
          subAccountId: platform === "instagram" ? account.subAccountId : null,
          title,
          description,
          ...(platform === "youtube" && { privacy: "public" as const }),
        };
        const opusId = item.publishAt
          ? (await schedulePost({ ...post, publishAt: new Date(item.publishAt) })).scheduleId
          : (await postNow(post)).postId;
        // Record each post as soon as Opus accepts it, so a later failure doesn't lose track.
        // A new row every time, so earlier and canceled posts stay in the history.
        const now = new Date().toISOString();
        const { error: postError } = await db.from("posts").insert(
          {
            clip_id: item.clipId,
            platform,
            platform_post_id: opusId,
            scheduled_for: item.publishAt ?? now,
            posted_at: item.publishAt ? null : now,
            caption: item.caption,
            account_name: account.name,
            status: item.publishAt ? "scheduled" : "posted",
          },
        );
        if (postError) throw new Error(`Sent "${title}" to ${account.platformLabel} (${opusId}) but couldn't save it: ${postError.message}.`);
        published.push({ clipId: item.clipId, title, platform, account: `${account.platformLabel} ${account.handle}`, publishAt: item.publishAt, opusId });
        // Opus allows one posting request per second.
        await pause(1100);
      }
      const status = item.publishAt && !item.repost ? "scheduled" : "posted";
      const { error: clipError } = await db.from("clips").update({ status }).eq("id", item.clipId);
      if (clipError) throw new Error(`Posted "${captionTitle(item.caption)}" but couldn't update the clip: ${clipError.message}`);
    }
  } catch (error) {
    const done = published.map((p) => `${p.title} on ${p.account}`).join(", ");
    const why = error instanceof Error ? error.message : String(error);
    throw new Error(done ? `${why} Already sent before the error: ${done}.` : why);
  }
  return { published, accounts: Object.values(accounts).map((a) => `${a.platformLabel} ${a.handle}`) };
}

/**
 * Cancels a scheduled post in Opus and marks it canceled. The clip goes back into the
 * week's picks once none of its posts are still scheduled.
 */
export async function cancelPost(db: Db, postId: string) {
  const { data: post, error } = await db.from("posts").select("id, clip_id, platform_post_id, status, scheduled_for").eq("id", postId).maybeSingle();
  if (error) throw new Error(`Failed to load the post: ${error.message}`);
  if (!post) throw new Error("That post doesn't exist.");
  if (post.status !== "scheduled") throw new Error(`That post is already ${post.status}.`);
  if (post.scheduled_for && new Date(post.scheduled_for).getTime() <= Date.now()) throw new Error("That post's publish time has passed, so it can't be canceled.");
  if (!post.platform_post_id) throw new Error("That post has no OpusClip schedule ID to cancel.");

  await cancelScheduledPost(post.platform_post_id);
  const { error: postError } = await db.from("posts").update({ status: "canceled" }).eq("id", post.id);
  if (postError) throw new Error(`Canceled in OpusClip but couldn't save it: ${postError.message}`);
  const { data: others } = await db.from("posts").select("id").eq("clip_id", post.clip_id).in("status", ["scheduled", "posted"]);
  if (!others?.length) {
    const { error: clipError } = await db.from("clips").update({ status: "candidate" }).eq("id", post.clip_id).eq("status", "scheduled");
    if (clipError) throw new Error(`Canceled, but couldn't put the clip back in the picks: ${clipError.message}`);
  }
}
