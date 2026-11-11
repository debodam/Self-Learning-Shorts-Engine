import { recentBacktestSample, runBacktest } from "@/lib/backtest";
import { getActivePrompt } from "@/lib/prompt-versions";
import { runJob } from "./lib";

// Backtests the active scoring prompt on every eligible channel Short: each is predicted
// using only Shorts published before it, then compared with its actual settled views.
// Saves the run, its predictions, and an accuracy snapshot for the Learnings chart.
// The weekly report reads the latest full backtest for patterns, so run this after a
// new prompt version goes live. LIMIT=n backtests only the n most recent Shorts.

runJob("Backtest", async ({ db, log }) => {
  if (!db) throw new Error("The backtest writes to Supabase, so it can't run as a dry run.");
  const prompt = await getActivePrompt(db);
  const limit = Number(process.env.LIMIT) || undefined;
  const videoIds = limit ? await recentBacktestSample(db, limit) : undefined;
  await runBacktest(db, {
    promptText: prompt.text,
    label: `Baseline: v${prompt.version} on ${limit ? `the ${limit} most recent` : "all"} channel Shorts`,
    promptVersion: prompt.version,
    videoIds,
    recordSnapshot: !limit,
    log,
  });
});
