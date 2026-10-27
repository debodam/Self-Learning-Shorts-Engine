"use server";

import { refresh } from "next/cache";
import { runScoring } from "@/lib/clip-scoring";
import { getDb } from "@/lib/db/client";
import { isIntegrationConnected } from "@/lib/integrations/config";
import { syncOpusProject } from "@/lib/opus-sync";
import { checkWeek, opusWritable, PICKS_PER_WEEK, scheduleWeek, setPick, startWeek } from "@/lib/weeks";

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
    await setPick(db, weekId, clipId, picked === true);
    refresh();
    return { ok: true, message: "" };
  } catch (error) {
    return { ok: false, message: message(error, "Couldn't change the pick.") };
  }
}

export type ScheduleResult = SyncFromOpusResult & { live?: boolean };

/**
 * Schedules the week's 7 picks on YouTube through Opus. Only called from the schedule
 * preview's confirm button. Until OPUSCLIP_SCHEDULING_LIVE=true it's a dry run.
 */
export async function scheduleWeekPicks(weekId: string, items: { clipId: string; title: string }[]): Promise<ScheduleResult> {
  if (typeof weekId !== "string" || !Array.isArray(items) || items.some((i) => typeof i?.clipId !== "string" || typeof i?.title !== "string")) {
    return { ok: false, message: "Nothing to schedule." };
  }
  if (!opusWritable()) return { ok: false, message: "Connect OpusClip in Settings first." };
  const db = getDb();
  if (!db) return { ok: false, message: "Connect Supabase in Settings first." };

  try {
    const result = await scheduleWeek(db, weekId, items);
    refresh();
    if (!result.live) {
      return {
        ok: true,
        live: false,
        message: `Dry run: titles saved, nothing was scheduled. Scheduling isn't live yet; when it is, these ${PICKS_PER_WEEK} posts go to the "${result.account}" YouTube channel.`,
      };
    }
    return { ok: true, live: true, message: `Scheduled ${result.scheduled} clips on "${result.account}", one per day at 12pm Eastern.` };
  } catch (error) {
    console.error("Scheduling failed:", error);
    return { ok: false, message: message(error, "Couldn't schedule.") };
  }
}
