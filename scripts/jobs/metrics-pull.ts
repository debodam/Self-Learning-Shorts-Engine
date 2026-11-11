import { listChannelShorts } from "@/lib/integrations/youtube";
import { pullYouTubeMetrics } from "@/lib/youtube-metrics";
import { runJob } from "./lib";

// Metrics pull (MVP 2, YouTube only): saves every Short on the channel with a
// timestamped snapshot of its views, likes, and comments, updates views at 48 hours and
// 7 days, and links Shorts we posted through the dashboard. Same as "Pull metrics now"
// on the Performance page. Instagram and TikTok metrics come later.

runJob("Metrics pull", async ({ db, log }) => {
  if (!db) {
    const { shorts, videosChecked, quotaUnits, mock } = await listChannelShorts();
    log(`${mock ? "Mock data: " : ""}${shorts.length} Shorts in ${videosChecked} uploads, ${quotaUnits} quota units (dry run, nothing saved).`);
    return;
  }
  const r = await pullYouTubeMetrics(db, log);
  for (const u of r.unmatched) log(`  Unmatched: "${u.title}" (${u.expectedAt}): ${u.note}`);
});
