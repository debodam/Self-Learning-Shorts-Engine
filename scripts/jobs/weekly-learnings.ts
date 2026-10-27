import type { WeekClipResult } from "@/lib/agent/prompts";
import type { Platform } from "@/lib/clips";
import { writeWeeklyLearnings } from "@/lib/integrations/claude";
import { mockPostedClips } from "@/lib/mock/posted-clips";
import { must, runJob } from "./lib";

// Weekly learnings: compare the agent's predicted views with actual results for clips
// posted in one week, and save the learnings entry for that week (replacing any earlier
// entry for the same week).
//
// The week defaults to the last full Monday-to-Sunday week. Set WEEK_START=YYYY-MM-DD
// (a Monday) to run it for a different week.

const DAY_MS = 24 * 60 * 60 * 1000;

function resolveWeekStart() {
  const override = process.env.WEEK_START?.trim();
  if (override) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(override) || Number.isNaN(Date.parse(override))) {
      throw new Error(`WEEK_START must be a date like 2026-10-19, got "${override}"`);
    }
    return override;
  }
  const today = new Date();
  const daysSinceMonday = (today.getUTCDay() + 6) % 7;
  const thisMonday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - daysSinceMonday * DAY_MS;
  return new Date(thisMonday - 7 * DAY_MS).toISOString().slice(0, 10);
}

runJob("Weekly learnings", async ({ db, log }) => {
  const weekStart = resolveWeekStart();
  const weekEnd = new Date(Date.parse(weekStart) + 7 * DAY_MS).toISOString().slice(0, 10);
  log(`Week of ${weekStart} (through ${new Date(Date.parse(weekEnd) - DAY_MS).toISOString().slice(0, 10)}).`);

  let results: WeekClipResult[];
  if (db) {
    const rows = must(
      await db
        .from("clips")
        .select(
          "title, format, hook_type, score_total, predicted_views_youtube, predicted_views_tiktok, predicted_views_instagram, posts!inner (platform, posted_at, metrics (views, avg_percent_watched, shares, captured_at))",
        )
        .eq("posts.status", "posted")
        .gte("posts.posted_at", weekStart)
        .lt("posts.posted_at", weekEnd)
        .order("captured_at", { referencedTable: "posts.metrics", ascending: false })
        .limit(1, { referencedTable: "posts.metrics" }),
      "load the week's posted clips",
    );
    results = rows.map((r) => ({
      title: r.title,
      format: r.format,
      hookType: r.hook_type,
      scoreTotal: r.score_total,
      predicted: Object.fromEntries(
        (["youtube", "tiktok", "instagram"] as const).flatMap((p) => {
          const v = r[`predicted_views_${p}`];
          return v === null ? [] : [[p, v]];
        }),
      ),
      actual: Object.fromEntries(
        r.posts.map((p) => {
          const m = p.metrics[0];
          return [p.platform, m ? { views: m.views, avgPercentWatched: m.avg_percent_watched, shares: m.shares } : undefined];
        }).filter(([, v]) => v),
      ),
    }));
  } else {
    // Dry run: use the mock posted clips for the latest week.
    results = mockPostedClips.slice(0, 7).map((c) => ({
      title: c.title,
      format: c.format,
      hookType: null,
      scoreTotal: null,
      predicted: {},
      actual: Object.fromEntries(
        Object.entries(c.metrics).map(([p, m]) => [p as Platform, { views: m.views, avgPercentWatched: m.avgPercentWatched, shares: m.shares }]),
      ),
    }));
  }

  if (results.length === 0) return log("No clips were posted that week, so there's nothing to learn from. Skipped.");
  const withMetrics = results.filter((r) => Object.keys(r.actual).length > 0).length;
  log(`${results.length} clips posted, ${withMetrics} with metrics.`);

  const draft = await writeWeeklyLearnings(weekStart, results);
  for (const line of draft.whatWorked) log(`  Worked: ${line}`);
  for (const line of draft.whatChanged) log(`  Changed: ${line}`);
  if (!db) return;

  must(
    await db
      .from("learnings")
      .upsert(
        { week_start: weekStart, what_worked: draft.whatWorked, what_changed: draft.whatChanged, reasoning: draft.reasoning },
        { onConflict: "week_start" },
      )
      .select("id"),
    "save the learnings entry",
  );
  log(`Saved the learnings entry for ${weekStart}.`);
});
