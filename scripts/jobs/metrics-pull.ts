import { listChannelShorts, youtubeConnected } from "@/lib/integrations/youtube";
import { labelShorts } from "@/lib/short-labels";
import { pullYouTubeMetrics } from "@/lib/youtube-metrics";
import { runJob } from "./lib";

// Metrics pull (MVP 2, YouTube only): saves every Short on the channel with a
// timestamped snapshot of its views, likes, and comments, updates views at 48 hours and
// 7 days and settled views, links Shorts we posted through the dashboard, and labels
// new Shorts' format with Claude Haiku. Same as "Pull metrics now" on the Performance page.
//
// GitHub Actions runs it daily with REQUIRE_LIVE=true, so missing secrets fail the run
// instead of quietly falling back to a dry run.

runJob("Metrics pull", async ({ db, log }) => {
  if (process.env.REQUIRE_LIVE === "true") {
    const missing = [
      !db && "Supabase (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)",
      !youtubeConnected() && "YouTube (YOUTUBE_API_KEY, YOUTUBE_CHANNEL_ID)",
    ].filter(Boolean);
    if (missing.length) {
      throw new Error(`Missing secrets for a live pull: ${missing.join("; ")}. Add them under Settings > Secrets and variables > Actions.`);
    }
  }
  if (!db) {
    const { shorts, videosChecked, quotaUnits, mock } = await listChannelShorts();
    log(`${mock ? "Mock data: " : ""}${shorts.length} Shorts in ${videosChecked} uploads, ${quotaUnits} quota units (dry run, nothing saved).`);
    return;
  }
  const r = await pullYouTubeMetrics(db, log);
  for (const u of r.unmatched) log(`  Unmatched: "${u.title}" (${u.expectedAt}): ${u.note}`);

  // Metrics are saved by now. A labeling failure still fails the run so it gets noticed;
  // unlabeled Shorts are retried on the next run.
  const labels = await labelShorts(db, { log });
  if (labels?.failed.length) {
    for (const f of labels.failed) log(`  Label failed: "${f.title}": ${f.error}`);
    throw new Error(`${labels.failed.length} new Shorts couldn't be labeled.`);
  }
});
