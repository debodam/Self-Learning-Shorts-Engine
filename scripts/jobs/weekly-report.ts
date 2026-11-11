import { isIntegrationConnected } from "@/lib/integrations/config";
import { runWeeklyReport } from "@/lib/weekly-report";
import { runJob } from "./lib";

// Weekly report (MVP 2 learning loop): measures prediction accuracy, writes the week's
// learnings entry, proposes up to 3 scoring prompt changes, and backtests each one.
// Nothing changes until a person approves a proposal on the Learnings page.
// WEEK_START=YYYY-MM-DD reviews a specific week; otherwise last week.

runJob("Weekly report", async ({ db, log }) => {
  if (!db) throw new Error("The weekly report writes to Supabase, so it can't run as a dry run.");
  if (!isIntegrationConnected("claude")) throw new Error("ANTHROPIC_API_KEY is missing.");
  const weekStart = process.env.WEEK_START?.trim() || undefined;
  const { data: run } = await db.from("report_runs").insert({ trigger: process.env.GITHUB_ACTIONS ? "schedule" : "job" }).select("id").single();
  try {
    const r = await runWeeklyReport(db, { log, weekStart });
    if (run) await db.from("report_runs").update({ status: "done", finished_at: new Date().toISOString(), message: `${r.proposals} proposals, about $${r.costUsd.toFixed(2)}` }).eq("id", run.id);
  } catch (e) {
    if (run) await db.from("report_runs").update({ status: "failed", finished_at: new Date().toISOString(), message: e instanceof Error ? e.message : String(e) }).eq("id", run.id);
    throw e;
  }
});
