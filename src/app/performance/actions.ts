"use server";

import { refresh } from "next/cache";
import { getDb } from "@/lib/db/client";
import { youtubeConnected } from "@/lib/integrations/youtube";
import { labelShorts } from "@/lib/short-labels";
import { pullYouTubeMetrics } from "@/lib/youtube-metrics";

export type PullMetricsResult = { ok: boolean; message: string };

// TODO(auth): check the signed-in user here once auth exists. It reads public YouTube
// data (about 35 of the 10,000 daily quota units) and labels new Shorts with Haiku.
export async function pullMetricsNow(): Promise<PullMetricsResult> {
  // Without a key the Shorts are mock data, which must never be saved.
  if (!youtubeConnected()) return { ok: false, message: "Set YOUTUBE_API_KEY and YOUTUBE_CHANNEL_ID in .env.local first." };
  const db = getDb();
  if (!db) return { ok: false, message: "Connect Supabase in Settings first." };
  try {
    const r = await pullYouTubeMetrics(db);
    // New Shorts get a format label from Claude Haiku, a fraction of a cent each.
    const labels = await labelShorts(db);
    refresh();
    const fresh = r.newShorts ? `, ${r.newShorts} new` : "";
    const unmatched = r.unmatched.length ? ` ${r.unmatched.length} of our posts couldn't be matched; see below.` : "";
    const labeled = labels?.labeled
      ? ` Labeled ${labels.labeled} new ${labels.labeled === 1 ? "Short" : "Shorts"} for about $${(labels.costUsd ?? 0).toFixed(4)}.`
      : "";
    const labelFailed = labels?.failed.length ? ` ${labels.failed.length} couldn't be labeled and will retry next pull.` : "";
    return {
      ok: true,
      message: `Pulled ${r.shortsFound} Shorts${fresh} from ${r.videosChecked} uploads using ${r.quotaUnits} quota units. Linked ${r.matched} of our posts.${unmatched}${labeled}${labelFailed}`,
    };
  } catch (error) {
    console.error("Metrics pull failed:", error);
    return { ok: false, message: error instanceof Error ? error.message : "Metrics pull failed." };
  }
}
