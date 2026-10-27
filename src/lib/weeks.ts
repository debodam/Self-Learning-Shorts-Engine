import "server-only";
import { CAPTION_RULES, checkViewerText } from "@/lib/agent/rules";
import { rubricCategories } from "@/lib/clips";
import { runScoring, type ScoringRun } from "@/lib/clip-scoring";
import type { Db } from "@/lib/db/client";
import { isIntegrationConnected, isOpusMockForced } from "@/lib/integrations/config";
import {
  cancelScheduledPost,
  findBrandTemplateId,
  getClipRender,
  setClipHeadline,
  waitForRender,
  getProjectStage,
  listClips,
  listSocialAccounts,
  schedulePost,
  submitVideo,
} from "@/lib/integrations/opus";
import { getVideoInfo, normalizeYouTubeUrl } from "@/lib/integrations/youtube";
import { saveOpusClips } from "@/lib/opus-sync";
import { easternDate, slotsFrom, tomorrowEastern } from "@/lib/schedule-slots";

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

/** Kept, scored clips from the week's videos, best rubric score first. */
async function rankedWeekClips(db: Db, weekId: string) {
  const { data, error } = await db
    .from("clips")
    .select("id, picked, status, score_total, score_hook, score_tension, score_standalone, score_payoff, score_loopability, source_videos!inner (week_id)")
    .eq("source_videos.week_id", weekId)
    .in("status", ["candidate", "approved"])
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
  // Unpicking a clip saved as Ready to schedule puts it back with the other candidates.
  const { error } = await db.from("clips").update(picked ? { picked } : { picked, status: "candidate" }).eq("id", clipId);
  if (error) throw new Error(`Failed to save the pick: ${error.message}`);
}

// Scheduling --------------------------------------------------------------------

/** The only account clips may be posted to: the Exponent YouTube channel. */
const ALLOWED_ACCOUNT_NAME = () => process.env.OPUSCLIP_YOUTUBE_ACCOUNT_NAME?.trim() || "Exponent";
const FORBIDDEN_ACCOUNT = /ace\s*your\s*interviews/i;

/**
 * Looks up the Exponent YouTube account in Opus's connected social accounts. Refuses
 * anything else: no match, more than one match, a different configured ID, or any
 * account named like Ace Your Interviews.
 */
export async function youtubePostAccount() {
  const name = ALLOWED_ACCOUNT_NAME();
  if (FORBIDDEN_ACCOUNT.test(name)) throw new Error(`Refusing to post to "${name}". Only the Exponent YouTube account is allowed.`);
  const accounts = await listSocialAccounts();
  const matches = accounts.filter((a) => a.platform === "YOUTUBE" && a.name.trim().toLowerCase() === name.toLowerCase());
  if (matches.length === 0) throw new Error(`No YouTube account named "${name}" is connected in Opus.`);
  if (matches.length > 1) throw new Error(`More than one YouTube account named "${name}" is connected in Opus. Set OPUSCLIP_YOUTUBE_POST_ACCOUNT_ID.`);
  const account = matches[0];
  // A configured ID must agree with the lookup. Mock mode only has mock IDs, so it skips this.
  const configured = isIntegrationConnected("opus") ? process.env.OPUSCLIP_YOUTUBE_POST_ACCOUNT_ID?.trim() : undefined;
  if (configured && configured !== account.postAccountId) {
    const other = accounts.find((a) => a.postAccountId === configured);
    throw new Error(`OPUSCLIP_YOUTUBE_POST_ACCOUNT_ID points to "${other?.name ?? configured}", not the "${name}" YouTube account. Refusing to schedule.`);
  }
  if (FORBIDDEN_ACCOUNT.test(account.name)) throw new Error(`Refusing to post to "${account.name}".`);
  return account;
}

/** New York dates ("YYYY-MM-DD") that already have an upcoming post scheduled. */
export async function bookedDates(db: Db) {
  const { data, error } = await db.from("posts").select("scheduled_for").eq("platform", "youtube").eq("status", "scheduled").gte("scheduled_for", new Date().toISOString());
  if (error) throw new Error(`Failed to load scheduled posts: ${error.message}`);
  return [...new Set(data.flatMap((p) => (p.scheduled_for ? [easternDate(new Date(p.scheduled_for))] : [])))].sort();
}

export type ScheduleItem = { clipId: string; title: string; description: string };
export type ScheduledPost = { clipId: string; title: string; publishAt: string; scheduleId: string };

export type PostingCheck = { clipId: string; headline: string; addedHeadline: boolean; exportUrl: string | null };

/**
 * Gets clips ready to post: adds the suggested factual title as a headline to any clip
 * without one, waits for Opus to re-render, and checks the HD file (what Opus posts)
 * includes the headline. Re-renders use no credits. Throws if any clip isn't ready.
 */
export async function prepareForPosting(clips: { id: string; opus_clip_id: string | null; suggested_title: string | null; title: string }[]) {
  return Promise.all(
    clips.map(async (clip): Promise<PostingCheck> => {
      if (!clip.opus_clip_id) throw new Error(`"${clip.title}" didn't come from Opus, so it can't be posted through it.`);
      const before = await getClipRender(clip.opus_clip_id);
      const addedHeadline = !before.headline;
      if (addedHeadline) await setClipHeadline(clip.opus_clip_id, clip.suggested_title ?? clip.title);
      const after = before.rendering || addedHeadline || !before.exportCurrent ? await waitForRender(clip.opus_clip_id) : before;
      if (!after.headline) throw new Error(`"${clip.title}" still has no headline after rendering. Nothing was scheduled.`);
      if (!after.exportCurrent) throw new Error(`"${clip.title}" hasn't finished rendering with its headline. Nothing was scheduled.`);
      return { clipId: clip.id, headline: after.headline, addedHeadline, exportUrl: after.exportUrl };
    }),
  );
}

/** The week's picks: unscheduled ones (candidate or saved as ready) and scheduled ones. */
async function loadPicks(db: Db, weekId: string) {
  const { data: picks, error } = await db
    .from("clips")
    .select("id, opus_clip_id, status, suggested_title, title, source_videos!inner (week_id)")
    .eq("source_videos.week_id", weekId)
    .eq("picked", true)
    .in("status", ["candidate", "approved", "scheduled"]);
  if (error) throw new Error(`Failed to load picks: ${error.message}`);
  if (picks.length !== PICKS_PER_WEEK) throw new Error(`Pick exactly ${PICKS_PER_WEEK} clips; ${picks.length} are picked.`);
  return picks;
}

/** Checks the preview's items are exactly the unscheduled picks and its text follows the rules. */
async function checkItems(db: Db, weekId: string, items: ScheduleItem[]) {
  const picks = await loadPicks(db, weekId);
  const unscheduled = new Map(picks.filter((p) => p.status !== "scheduled").map((p) => [p.id, p]));
  if (unscheduled.size === 0) throw new Error("Every pick is already scheduled.");
  if (items.length !== unscheduled.size || new Set(items.map((i) => i.clipId)).size !== items.length || items.some((i) => !unscheduled.has(i.clipId))) {
    throw new Error("The picks changed since the preview opened. Close it and try again.");
  }

  const issues: string[] = [];
  const cleaned = items.map((item, i) => {
    const title = item.title.trim();
    const description = item.description.trim();
    if (!title) issues.push(`Clip ${i + 1} needs a title`);
    if (title.length > CAPTION_RULES.youtube.titleMaxChars) issues.push(`"${title}" is ${title.length} characters; keep it under 60`);
    if (!description) issues.push(`"${title}" needs a description`);
    issues.push(...checkViewerText(`"${title}"`, title), ...checkViewerText(`Description for "${title}"`, description));
    return { ...item, title, description };
  });
  if (issues.length) throw new Error(issues.join(". "));
  return { unscheduled, cleaned };
}

/** Saves the preview's titles and descriptions. */
async function saveText(db: Db, items: ScheduleItem[]) {
  for (const item of items) {
    const { error } = await db.from("clips").update({ youtube_title: item.title, youtube_description: item.description }).eq("id", item.clipId);
    if (error) throw new Error(`Failed to save "${item.title}": ${error.message}`);
  }
}

/**
 * Saves the week's unscheduled picks as Ready to schedule (status approved), with the
 * preview's titles and descriptions. Nothing is sent to Opus.
 */
export async function savePicksForLater(db: Db, weekId: string, items: ScheduleItem[]) {
  const { cleaned } = await checkItems(db, weekId, items);
  await saveText(db, cleaned);
  const { error } = await db.from("clips").update({ status: "approved" }).in("id", cleaned.map((i) => i.clipId));
  if (error) throw new Error(`Failed to save the picks: ${error.message}`);
  return cleaned.length;
}

/**
 * Schedules the week's unscheduled picks on the Exponent YouTube channel through Opus,
 * with the titles and descriptions from the preview, one per day at noon Eastern from
 * startDate, skipping days that already have a post. items must be exactly the
 * unscheduled picks, in the preview's order. With limit 1 only the first is scheduled
 * (the "Test with 1 clip" option). Only call this after the user confirms.
 */
export async function scheduleWeek(db: Db, weekId: string, items: ScheduleItem[], { limit, startDate }: { limit?: number; startDate: string }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error("Pick a start date.");
  if (startDate < tomorrowEastern()) throw new Error("The start date has to be tomorrow or later.");
  const { unscheduled, cleaned } = await checkItems(db, weekId, items);

  // Save the preview's text first, so edits are kept even if scheduling fails.
  await saveText(db, cleaned);

  const account = await youtubePostAccount();
  const toSchedule = cleaned.slice(0, limit ?? cleaned.length);
  // Opus posts the clip's rendered HD file, so make sure each one has its headline burned in first.
  await prepareForPosting(toSchedule.map((item) => unscheduled.get(item.clipId)!));
  const slots = slotsFrom(startDate, toSchedule.length, await bookedDates(db));
  const scheduled: ScheduledPost[] = [];
  for (const [i, item] of toSchedule.entries()) {
    const opusClipId = unscheduled.get(item.clipId)!.opus_clip_id;
    if (!opusClipId) throw new Error(`"${item.title}" didn't come from Opus, so it can't be scheduled there.`);
    const [projectId, clipId] = opusClipId.split(".");
    const publishAt = slots[i];
    const { scheduleId } = await schedulePost({
      projectId,
      clipId,
      postAccountId: account.postAccountId,
      publishAt,
      title: item.title,
      description: item.description,
      privacy: "public",
    });
    // Record each post as soon as Opus accepts it, so a later failure doesn't lose track.
    // Upsert, since a clip whose post was canceled already has a row.
    const { error: postError } = await db.from("posts").upsert(
      {
        clip_id: item.clipId,
        platform: "youtube",
        platform_post_id: scheduleId,
        scheduled_for: publishAt.toISOString(),
        posted_at: null,
        caption: item.description,
        status: "scheduled",
      },
      { onConflict: "clip_id,platform" },
    );
    if (postError) throw new Error(`Scheduled "${item.title}" in Opus (${scheduleId}) but couldn't save it: ${postError.message}. Cancel it in OpusClip.`);
    const { error: clipError } = await db.from("clips").update({ status: "scheduled" }).eq("id", item.clipId);
    if (clipError) throw new Error(`Scheduled "${item.title}" but couldn't mark the clip scheduled: ${clipError.message}`);
    scheduled.push({ clipId: item.clipId, title: item.title, publishAt: publishAt.toISOString(), scheduleId });
  }
  return { account: account.name, scheduled, remaining: unscheduled.size - scheduled.length };
}

/** Cancels a scheduled post in Opus, then marks it canceled and puts its clip back in the picks. */
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
  const { error: clipError } = await db.from("clips").update({ status: "candidate" }).eq("id", post.clip_id).eq("status", "scheduled");
  if (clipError) throw new Error(`Canceled, but couldn't put the clip back in the picks: ${clipError.message}`);
}
