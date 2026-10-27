"use server";

import { refresh } from "next/cache";
import { runScoring } from "@/lib/clip-scoring";
import { getDb } from "@/lib/db/client";
import { isIntegrationConnected } from "@/lib/integrations/config";
import { checkViewerText } from "@/lib/agent/rules";
import { setClipHeadline } from "@/lib/integrations/opus";
import { syncOpusProject } from "@/lib/opus-sync";
import {
  addMissingHeadlines,
  cancelPost,
  checkWeek,
  opusWritable,
  PLATFORMS,
  publishClips,
  savePicksForLater,
  setPick,
  startWeek,
  writePickCaptions,
  type PostItem,
} from "@/lib/weeks";

export type SyncFromOpusResult = { ok: boolean; message: string };
export type ScoreClipsResult = SyncFromOpusResult;

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

// TODO(auth): check the signed-in user here once auth exists. This spends Claude credits.
/** Scores clips waiting for scores, or with all set, re-scores every clip up for review. */
export async function scoreClips(all = false): Promise<ScoreClipsResult> {
  // Without a key, scores are mock placeholders, which must never be saved as real scores.
  if (!isIntegrationConnected("claude")) return { ok: false, message: "Connect Claude in Settings before scoring." };
  const db = getDb();
  if (!db) return { ok: false, message: "Connect Supabase in Settings before scoring." };

  try {
    const run = await runScoring(db, { all: all === true });
    refresh();
    if (run.scored === 0 && run.failed.length === 0) return { ok: true, message: all ? "No clips to re-score." : "No clips are waiting for scores." };
    const cost = run.costUsd === null ? "unknown cost" : `$${run.costUsd.toFixed(4)}`;
    const tokens = `${compact.format(run.usage.input + run.usage.cacheRead + run.usage.cacheWrite)} input and ${compact.format(run.usage.output)} output tokens`;
    const failed = run.failed.length ? ` ${run.failed.length} failed: ${run.failed.map((f) => `"${f.title}" (${f.error})`).join(", ")}.` : "";
    return {
      ok: run.failed.length === 0,
      message: `${all ? "Re-scored" : "Scored"} ${run.scored} ${run.scored === 1 ? "clip" : "clips"}: ${run.scored - run.cut} kept, ${run.cut} cut (${run.noSpeaker} with no speaker on screen). Used ${tokens} on ${run.model}, about ${cost}.${failed}`,
    };
  } catch (error) {
    console.error("Scoring failed:", error);
    return { ok: false, message: error instanceof Error ? error.message : "Scoring failed." };
  }
}

// TODO(auth): check the signed-in user here once auth exists. Until then anyone who can
// reach the app can trigger a sync. It only reads from Opus, so it can't spend credits.
export async function syncFromOpus(projectId: string): Promise<SyncFromOpusResult> {
  if (typeof projectId !== "string" || !/^P\w+$/.test(projectId)) {
    return { ok: false, message: "Pick an Opus project to sync." };
  }
  // Without a key, Opus returns mock projects, which must never be written to the real database.
  if (!isIntegrationConnected("opus")) return { ok: false, message: "Connect OpusClip in Settings before syncing." };
  const db = getDb();
  if (!db) return { ok: false, message: "Connect Supabase in Settings before syncing." };

  try {
    const result = await syncOpusProject(db, projectId);
    refresh();
    if (result.clipsFound === 0) {
      return { ok: true, message: `"${result.projectTitle}" has no clips yet. Opus may still be processing it.` };
    }
    const already = result.clipsFound - result.clipsAdded;
    return {
      ok: true,
      message:
        result.clipsAdded === 0
          ? `"${result.projectTitle}" is already up to date: all ${result.clipsFound} clips were synced before.`
          : `Synced "${result.projectTitle}": added ${result.clipsAdded} of ${result.clipsFound} clips${already ? ` (${already} were already synced)` : ""}.`,
    };
  } catch (error) {
    console.error("Sync from Opus failed:", error);
    return { ok: false, message: error instanceof Error ? error.message : "Sync failed." };
  }
}

// Weekly flow -------------------------------------------------------------------
// TODO(auth): check the signed-in user in each of these once auth exists.

const message = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/** Submits 2 YouTube links to Opus as a new week. Spends Opus credits: the UI confirms first. */
export async function startNewWeek(links: string[]): Promise<SyncFromOpusResult> {
  if (!Array.isArray(links) || links.some((l) => typeof l !== "string")) return { ok: false, message: "Paste 2 YouTube links." };
  if (!opusWritable()) return { ok: false, message: "Connect OpusClip in Settings before starting a week." };
  const db = getDb();
  if (!db) return { ok: false, message: "Connect Supabase in Settings before starting a week." };

  try {
    const result = await startWeek(db, links);
    refresh();
    if (result.failed.length) {
      return { ok: false, message: `Submitted ${result.submitted} of 2. Failed: ${result.failed.join("; ")}` };
    }
    return { ok: true, message: "Both videos were submitted to Opus. Opus usually takes 10 to 30 minutes; use Check status." };
  } catch (error) {
    console.error("Starting a week failed:", error);
    return { ok: false, message: message(error, "Couldn't start the week.") };
  }
}

/** Checks the week's Opus projects, syncing and scoring finished ones and picking the top 7. */
export async function checkWeekStatus(weekId: string): Promise<SyncFromOpusResult> {
  if (typeof weekId !== "string") return { ok: false, message: "No week to check." };
  if (!opusWritable()) return { ok: false, message: "Connect OpusClip in Settings first." };
  const db = getDb();
  if (!db) return { ok: false, message: "Connect Supabase in Settings first." };

  try {
    const r = await checkWeek(db, weekId);
    refresh();
    const parts: string[] = [];
    if (r.newlyReady.length) parts.push(`Synced ${r.newlyReady.map((t) => `"${t}"`).join(" and ")}.`);
    if (r.scoring) parts.push(`Scored ${r.scoring.scored} clips: ${r.scoring.scored - r.scoring.cut} kept, ${r.scoring.cut} cut (${r.scoring.noSpeaker} with no speaker), about $${(r.scoring.costUsd ?? 0).toFixed(2)}.`);
    if (r.picked) parts.push(`Picked the top ${r.picked}.`);
    if (r.stillProcessing) parts.push(`${r.stillProcessing} still processing in Opus. Check again in a few minutes.`);
    if (r.failed.length) parts.push(`Opus failed on ${r.failed.map((t) => `"${t}"`).join(" and ")}.`);
    return { ok: r.failed.length === 0, message: parts.join(" ") || "Nothing new. Every video is already synced." };
  } catch (error) {
    console.error("Checking the week failed:", error);
    return { ok: false, message: message(error, "Couldn't check the week.") };
  }
}

export async function togglePick(weekId: string, clipId: string, picked: boolean): Promise<SyncFromOpusResult> {
  const db = getDb();
  if (!db) return { ok: false, message: "Connect Supabase in Settings first." };
  try {
    const { headlineAdded } = await setPick(db, weekId, clipId, picked === true);
    refresh();
    return { ok: true, message: headlineAdded ? "Picked. Its suggested title is being added as the headline." : "" };
  } catch (error) {
    refresh();
    return { ok: false, message: message(error, "Couldn't change the pick.") };
  }
}

export type ScheduleResult = SyncFromOpusResult;

const slotFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/New_York",
  timeZoneName: "short",
});

const PLATFORM_SET = new Set<string>(PLATFORMS);

const validItems = (items: unknown): items is PostItem[] =>
  Array.isArray(items) &&
  items.every(
    (i) =>
      typeof i?.clipId === "string" &&
      Array.isArray(i.platforms) &&
      i.platforms.every((p: unknown) => typeof p === "string" && PLATFORM_SET.has(p)) &&
      (i.publishAt === null || typeof i.publishAt === "string") &&
      typeof i.caption === "string",
  );

/**
 * Schedules clips (publishAt set) or posts one now (publishAt null) through OpusClip on
 * each clip's chosen platforms. Only called from the schedule preview's confirm buttons,
 * after a confirm dialog that lists the platforms and accounts.
 */
export async function publishPicks(weekId: string, items: PostItem[]): Promise<ScheduleResult> {
  if (typeof weekId !== "string" || !validItems(items)) return { ok: false, message: "Nothing to post." };
  if (!opusWritable()) return { ok: false, message: "Connect OpusClip in Settings first." };
  const db = getDb();
  if (!db) return { ok: false, message: "Connect Supabase in Settings first." };

  try {
    const { published } = await publishClips(db, weekId, items);
    refresh();
    const byClip = new Map<string, typeof published>();
    for (const p of published) byClip.set(p.clipId, [...(byClip.get(p.clipId) ?? []), p]);
    const lines = [...byClip.values()].map((posts) => {
      const when = posts[0].publishAt ? `scheduled for ${slotFormat.format(new Date(posts[0].publishAt))}` : "posted now";
      return `"${posts[0].title}" ${when} on ${posts.map((p) => p.account).join(", ")}`;
    });
    return { ok: true, message: `${lines.join(". ")}.` };
  } catch (error) {
    console.error("Posting failed:", error);
    refresh();
    return { ok: false, message: message(error, "Couldn't post.") };
  }
}

/** Saves the week's picks as Ready to schedule, with the preview's text. Posts nothing. */
export async function savePicks(weekId: string, items: PostItem[]): Promise<ScheduleResult> {
  if (typeof weekId !== "string" || !validItems(items)) return { ok: false, message: "Nothing to save." };
  const db = getDb();
  if (!db) return { ok: false, message: "Connect Supabase in Settings first." };
  try {
    const saved = await savePicksForLater(db, weekId, items);
    refresh();
    return { ok: true, message: `Saved ${saved} picks as Ready to schedule. Nothing was posted; open Schedule again when you're ready.` };
  } catch (error) {
    return { ok: false, message: message(error, "Couldn't save the picks.") };
  }
}

/** Writes the one caption (posted to all three platforms) for picks that don't have one. Uses Claude. */
export async function writeCaptionsForPicks(weekId: string): Promise<ScheduleResult> {
  if (typeof weekId !== "string") return { ok: false, message: "No week." };
  const db = getDb();
  if (!db) return { ok: false, message: "Connect Supabase in Settings first." };
  try {
    const { written, failed, costUsd } = await writePickCaptions(db, weekId);
    refresh();
    const cost = costUsd ? ` About $${costUsd.toFixed(3)}.` : "";
    if (failed.length) return { ok: false, message: `Wrote ${written} captions. Failed: ${failed.join("; ")}.${cost}` };
    return { ok: true, message: written ? `Wrote ${written} ${written === 1 ? "caption" : "captions"}.${cost}` : "Every pick already has a caption." };
  } catch (error) {
    console.error("Writing captions failed:", error);
    return { ok: false, message: message(error, "Couldn't write captions.") };
  }
}

/** Cancels one scheduled post in OpusClip and puts its clip back in the week's picks. */
export async function cancelScheduled(postId: string): Promise<SyncFromOpusResult> {
  if (typeof postId !== "string") return { ok: false, message: "No post to cancel." };
  if (!opusWritable()) return { ok: false, message: "Connect OpusClip in Settings first." };
  const db = getDb();
  if (!db) return { ok: false, message: "Connect Supabase in Settings first." };
  try {
    await cancelPost(db, postId);
    refresh();
    return { ok: true, message: "Canceled in OpusClip." };
  } catch (error) {
    console.error("Canceling failed:", error);
    return { ok: false, message: message(error, "Couldn't cancel.") };
  }
}

const HEADLINE_MAX = 70;

/**
 * Sets a clip's headline (title card) in Opus, adding one if it has none, and starts a
 * re-render so the preview and HD file include it. No Opus credits.
 */
export async function setHeadline(clipId: string, text: string): Promise<SyncFromOpusResult> {
  if (typeof clipId !== "string" || typeof text !== "string") return { ok: false, message: "No clip." };
  const headline = text.replace(/\s+/g, " ").trim();
  if (!headline) return { ok: false, message: "The headline can't be empty." };
  if (headline.length > HEADLINE_MAX) return { ok: false, message: `Keep the headline under ${HEADLINE_MAX} characters; it's ${headline.length}.` };
  const issues = checkViewerText("The headline", headline);
  if (issues.length) return { ok: false, message: `${issues.join(". ")}.` };
  if (!opusWritable()) return { ok: false, message: "Connect OpusClip in Settings first." };
  const db = getDb();
  if (!db) return { ok: false, message: "Connect Supabase in Settings first." };
  try {
    const { data: clip, error } = await db.from("clips").select("opus_clip_id").eq("id", clipId).single();
    if (error) throw new Error(`Failed to load the clip: ${error.message}`);
    if (!clip.opus_clip_id) throw new Error("This clip didn't come from Opus.");
    await setClipHeadline(clip.opus_clip_id, headline);
    refresh();
    return { ok: true, message: "Saved. Opus is re-rendering the clip with the headline; this usually takes under a minute." };
  } catch (error) {
    console.error("Setting a headline failed:", error);
    return { ok: false, message: message(error, "Couldn't save the headline.") };
  }
}

/** Adds the suggested factual title as a headline to every pick that has none. No Opus credits. */
export async function addMissingPickHeadlines(weekId: string): Promise<SyncFromOpusResult> {
  if (typeof weekId !== "string") return { ok: false, message: "No week." };
  if (!opusWritable()) return { ok: false, message: "Connect OpusClip in Settings first." };
  const db = getDb();
  if (!db) return { ok: false, message: "Connect Supabase in Settings first." };
  try {
    const { added, failed } = await addMissingHeadlines(db, weekId);
    refresh();
    if (failed.length) return { ok: false, message: `Added ${added.length}. Failed: ${failed.join("; ")}` };
    if (!added.length) return { ok: true, message: "Every pick already has a headline." };
    return { ok: true, message: `Added ${added.length} ${added.length === 1 ? "headline" : "headlines"}. Opus is rendering them into the videos.` };
  } catch (error) {
    console.error("Adding missing headlines failed:", error);
    return { ok: false, message: message(error, "Couldn't add the headlines.") };
  }
}
