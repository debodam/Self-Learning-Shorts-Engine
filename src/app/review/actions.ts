"use server";

import { refresh } from "next/cache";
import { scoreUnscoredClips } from "@/lib/clip-scoring";
import { getDb } from "@/lib/db/client";
import { isIntegrationConnected } from "@/lib/integrations/config";
import { syncOpusProject } from "@/lib/opus-sync";

export type SyncFromOpusResult = { ok: boolean; message: string };
export type ScoreClipsResult = SyncFromOpusResult;

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

// TODO(auth): check the signed-in user here once auth exists. This spends Claude credits.
export async function scoreClips(): Promise<ScoreClipsResult> {
  // Without a key, scores are mock placeholders, which must never be saved as real scores.
  if (!isIntegrationConnected("claude")) return { ok: false, message: "Connect Claude in Settings before scoring." };
  const db = getDb();
  if (!db) return { ok: false, message: "Connect Supabase in Settings before scoring." };

  try {
    const run = await scoreUnscoredClips(db);
    refresh();
    if (run.scored === 0 && run.failed.length === 0) return { ok: true, message: "No clips are waiting for scores." };
    const cost = run.costUsd === null ? "unknown cost" : `$${run.costUsd.toFixed(4)}`;
    const tokens = `${compact.format(run.usage.input + run.usage.cacheRead + run.usage.cacheWrite)} input and ${compact.format(run.usage.output)} output tokens`;
    const failed = run.failed.length ? ` ${run.failed.length} failed: ${run.failed.map((f) => `"${f.title}" (${f.error})`).join(", ")}.` : "";
    return {
      ok: run.failed.length === 0,
      message: `Scored ${run.scored} ${run.scored === 1 ? "clip" : "clips"}: ${run.scored - run.cut} kept, ${run.cut} cut. Used ${tokens} on ${run.model}, about ${cost}.${failed}`,
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
