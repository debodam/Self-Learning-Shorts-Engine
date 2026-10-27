import "server-only";
import { CAPTION_RULES, checkViewerText } from "@/lib/agent/rules";
import { rubricCategories } from "@/lib/clips";
import { runScoring, type ScoringRun } from "@/lib/clip-scoring";
import type { Db } from "@/lib/db/client";
import { isIntegrationConnected, isOpusMockForced } from "@/lib/integrations/config";
import { findBrandTemplateId, getProjectStage, listClips, listSocialAccounts, schedulePost, submitVideo } from "@/lib/integrations/opus";
import { getVideoInfo, normalizeYouTubeUrl } from "@/lib/integrations/youtube";
import { saveOpusClips } from "@/lib/opus-sync";

// The weekly flow (see CLAUDE.md): submit 2 videos to Opus, sync and score their clips
// when Opus finishes, pick the top 7, then schedule one per day at noon Eastern.

export const VIDEOS_PER_WEEK = 2;
export const PICKS_PER_WEEK = 7;
const TIME_ZONE = "America/New_York";
const POST_HOUR = 12;

export type VideoStatus = "submitted" | "processing" | "ready" | "failed";

/** Opus can be written to: a real key, or mock mode chosen on purpose with OPUSCLIP_MOCK. */
export function opusWritable() {
  return isIntegrationConnected("opus") || isOpusMockForced();
}

// Weeks -------------------------------------------------------------------------

/** "YYYY-MM-DD" for a moment, in New York. */
function easternDate(at: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

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
  if (!brandTemplateId) throw new Error("No Aced brand template found in Opus. Set OPUSCLIP_BRAND_TEMPLATE_ID.");

  const { data: week, error: weekError } = await db.from("weeks").insert({ starts_on: currentWeekStart() }).select("id").single();
  if (weekError) throw new Error(`Failed to create the week: ${weekError.message}`);

  // One at a time, saving each, so a failed second submit doesn't lose the first.
  const failed: string[] = [];
  for (const video of videos) {
    try {
      const { projectId } = await submitVideo({ videoUrl: video.url, title: video.title, brandTemplateId });
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

/** Kept, scored clips from the week's videos, best rubric score first. */
async function rankedWeekClips(db: Db, weekId: string) {
  const { data, error } = await db
    .from("clips")
    .select("id, picked, status, score_total, score_hook, score_tension, score_standalone, score_payoff, score_loopability, source_videos!inner (week_id)")
    .eq("source_videos.week_id", weekId)
    .eq("status", "candidate")
    .not("score_total", "is", null);
  if (error) throw new Error(`Failed to load the week's clips: ${error.message}`);
  const score = (c: (typeof data)[number], k: string) => c[`score_${k}` as keyof typeof c] as number;
  return data.sort((a, b) => b.score_total! - a.score_total! || rubricCategories.reduce((d, k) => d || score(b, k) - score(a, k), 0));
}

/** Picks the top 7 kept clips by rubric when the week has no picks yet. Returns how many were picked. */
export async function autoPick(db: Db, weekId: string) {
  const ranked = await rankedWeekClips(db, weekId);
  if (ranked.some((c) => c.picked)) return 0;
  const top = ranked.slice(0, PICKS_PER_WEEK).map((c) => c.id);
  if (top.length === 0) return 0;
  const { error } = await db.from("clips").update({ picked: true }).in("id", top);
  if (error) throw new Error(`Failed to save picks: ${error.message}`);
  return top.length;
}

/** Selects or unselects one of the week's kept clips. At most 7 picks at a time. */
export async function setPick(db: Db, weekId: string, clipId: string, picked: boolean) {
  const ranked = await rankedWeekClips(db, weekId);
  const clip = ranked.find((c) => c.id === clipId);
  if (!clip) throw new Error("Only kept clips from this week can be picked.");
  if (picked && !clip.picked && ranked.filter((c) => c.picked).length >= PICKS_PER_WEEK) {
    throw new Error(`Already ${PICKS_PER_WEEK} picks. Unselect one first.`);
  }
  const { error } = await db.from("clips").update({ picked }).eq("id", clipId);
  if (error) throw new Error(`Failed to save the pick: ${error.message}`);
}

// Scheduling --------------------------------------------------------------------

/** The UTC moment it's noon in New York on a "YYYY-MM-DD" date, across daylight saving changes. */
export function noonEastern(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  // Noon Eastern is 16:00 UTC in daylight time and 17:00 UTC in standard time.
  for (const utcHour of [POST_HOUR + 4, POST_HOUR + 5]) {
    const at = new Date(Date.UTC(y, m - 1, d, utcHour));
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", hourCycle: "h23" }).format(at));
    if (hour === POST_HOUR) return at;
  }
  throw new Error(`Couldn't find noon Eastern on ${date}`);
}

/** One slot per day at noon Eastern, starting tomorrow. */
export function postingSlots(count: number, now = new Date()) {
  const [y, m, d] = easternDate(now).split("-").map(Number);
  return Array.from({ length: count }, (_, i) => noonEastern(new Date(Date.UTC(y, m - 1, d + 1 + i)).toISOString().slice(0, 10)));
}

/** Only this YouTube account may be posted to. Anything named like Ace Your Interviews is refused. */
const FORBIDDEN_ACCOUNT = /ace\s*your\s*interviews/i;

/** OPUSCLIP_SCHEDULING_LIVE=true lets confirming actually schedule posts through Opus. */
export function schedulingLive() {
  return process.env.OPUSCLIP_SCHEDULING_LIVE?.trim() === "true";
}

/** Finds the Opus account for the Exponent YouTube channel and checks it's safe to post to. */
async function youtubePostAccount() {
  // Mock mode only has mock accounts, so it matches by name instead of the real ID.
  const configured = isIntegrationConnected("opus") ? process.env.OPUSCLIP_YOUTUBE_POST_ACCOUNT_ID?.trim() : undefined;
  const accounts = await listSocialAccounts();
  const account = configured
    ? accounts.find((a) => a.postAccountId === configured)
    : accounts.find((a) => a.platform === "YOUTUBE" && /exponent/i.test(a.name));
  if (!account) throw new Error("The Exponent YouTube account isn't connected in Opus. Set OPUSCLIP_YOUTUBE_POST_ACCOUNT_ID.");
  if (account.platform !== "YOUTUBE") throw new Error(`Opus account "${account.name}" isn't a YouTube account.`);
  if (FORBIDDEN_ACCOUNT.test(account.name)) throw new Error(`Refusing to post to "${account.name}". Use the Exponent YouTube account.`);
  return account;
}

export type SchedulePlanItem = { clipId: string; title: string; description: string; publishAt: string };

/**
 * Checks the week's picks and the edited titles, then schedules them through Opus one per
 * day at noon Eastern. Without OPUSCLIP_SCHEDULING_LIVE=true nothing is sent: it returns
 * the plan as a dry run. Edited titles are saved either way.
 */
export async function scheduleWeek(db: Db, weekId: string, items: { clipId: string; title: string }[]) {
  const { data: picks, error } = await db
    .from("clips")
    .select("id, opus_clip_id, title, youtube_title, youtube_description, score_total, status, source_videos!inner (week_id)")
    .eq("source_videos.week_id", weekId)
    .eq("picked", true)
    .eq("status", "candidate");
  if (error) throw new Error(`Failed to load picks: ${error.message}`);
  if (picks.length !== PICKS_PER_WEEK) throw new Error(`Pick exactly ${PICKS_PER_WEEK} clips to schedule; ${picks.length} are picked.`);
  // The preview's order decides the dates, so it must be exactly this week's picks.
  const byId = new Map(picks.map((p) => [p.id, p]));
  if (items.length !== picks.length || new Set(items.map((i) => i.clipId)).size !== items.length || items.some((i) => !byId.has(i.clipId))) {
    throw new Error("The picks changed since the preview opened. Close it and try again.");
  }

  const issues: string[] = [];
  const slots = postingSlots(items.length);
  const plan: (SchedulePlanItem & { opusClipId: string | null })[] = items.map((item, i) => {
    const clip = byId.get(item.clipId)!;
    const title = (item.title ?? clip.youtube_title ?? clip.title).trim();
    if (!title) issues.push(`Clip ${i + 1} needs a title`);
    if (title.length > CAPTION_RULES.youtube.titleMaxChars) issues.push(`"${title}" is ${title.length} characters; keep it under 60`);
    issues.push(...checkViewerText(`"${title}"`, title));
    return { clipId: clip.id, opusClipId: clip.opus_clip_id, title, description: clip.youtube_description ?? "", publishAt: slots[i].toISOString() };
  });
  if (issues.length) throw new Error(issues.join(". "));

  for (const item of plan) {
    const { error: titleError } = await db.from("clips").update({ youtube_title: item.title }).eq("id", item.clipId);
    if (titleError) throw new Error(`Failed to save a title: ${titleError.message}`);
  }

  const account = await youtubePostAccount();
  if (!schedulingLive()) return { live: false as const, account: account.name, plan, scheduled: 0 };

  let scheduled = 0;
  for (const item of plan) {
    if (!item.opusClipId) throw new Error(`"${item.title}" didn't come from Opus, so it can't be scheduled there.`);
    const [projectId, clipId] = item.opusClipId.split(".");
    const { scheduleId } = await schedulePost({
      projectId,
      clipId,
      postAccountId: account.postAccountId,
      publishAt: new Date(item.publishAt),
      title: item.title,
      description: item.description,
      privacy: "public",
    });
    // Record each post as soon as Opus accepts it, so a later failure doesn't lose track.
    const { error: postError } = await db.from("posts").insert({
      clip_id: item.clipId,
      platform: "youtube",
      platform_post_id: scheduleId,
      scheduled_for: item.publishAt,
      caption: item.description,
      status: "scheduled",
    });
    if (postError) throw new Error(`Scheduled "${item.title}" in Opus (${scheduleId}) but couldn't save it: ${postError.message}`);
    await db.from("clips").update({ status: "scheduled" }).eq("id", item.clipId);
    scheduled++;
  }
  return { live: true as const, account: account.name, plan, scheduled };
}
