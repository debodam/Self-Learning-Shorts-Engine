"use server";

import { refresh } from "next/cache";
import { getDb } from "@/lib/db/client";
import { isIntegrationConnected } from "@/lib/integrations/config";
import { syncOpusProject } from "@/lib/opus-sync";

export type SyncFromOpusResult = { ok: boolean; message: string };

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
