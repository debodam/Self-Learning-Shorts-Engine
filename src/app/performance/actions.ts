"use server";

import { refresh } from "next/cache";
import { getDb } from "@/lib/db/client";
import { youtubeConnected } from "@/lib/integrations/youtube";
import { pullYouTubeMetrics } from "@/lib/youtube-metrics";

export type PullMetricsResult = { ok: boolean; message: string };

// TODO(auth): check the signed-in user here once auth exists. It only reads public
// YouTube data and costs about 35 of the 10,000 daily quota units.
export async function pullMetricsNow(): Promise<PullMetricsResult> {
  // Without a key the Shorts are mock data, which must never be saved.
  if (!youtubeConnected()) return { ok: false, message: "Set YOUTUBE_API_KEY and YOUTUBE_CHANNEL_ID in .env.local first." };
  const db = getDb();
  if (!db) return { ok: false, message: "Connect Supabase in Settings first." };
  try {
    const r = await pullYouTubeMetrics(db);
    refresh();
    const fresh = r.newShorts ? `, ${r.newShorts} new` : "";
    const unmatched = r.unmatched.length ? ` ${r.unmatched.length} of our posts couldn't be matched; see below.` : "";
    return {
      ok: true,
      message: `Pulled ${r.shortsFound} Shorts${fresh} from ${r.videosChecked} uploads using ${r.quotaUnits} quota units. Linked ${r.matched} of our posts.${unmatched}`,
    };
  } catch (error) {
    console.error("Metrics pull failed:", error);
    return { ok: false, message: error instanceof Error ? error.message : "Metrics pull failed." };
  }
}
