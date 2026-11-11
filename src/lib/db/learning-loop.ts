import "server-only";
import { connection } from "next/server";
import { getDb } from "@/lib/db/client";
import { listPromptVersions, type PromptVersion } from "@/lib/prompt-versions";

export type Metrics = { count: number; spearman: number | null; rangeHitRate: number | null; top7HitRate: number | null };

export type AccuracyPoint = Metrics & { id: string; createdAt: string; source: "posted" | "backtest"; promptVersion: number | null };

export type Proposal = {
  id: string;
  title: string;
  reasoning: string;
  oldText: string;
  newText: string;
  baseVersion: number;
  status: "pending" | "approved" | "rejected";
  rejectionReason: string | null;
  decidedAt: string | null;
  resultingVersion: number | null;
  baseline: (Metrics & { costUsd: number | null }) | null;
  backtest: (Metrics & { costUsd: number | null }) | null;
};

export type LearningEntry = {
  id: string;
  weekStart: string;
  whatWorked: string[];
  whatDidntWork: string[];
  reasoning: string;
  patterns: { dimension: string; finding: string }[];
  costUsd: number | null;
  createdAt: string;
  proposals: Proposal[];
};

export type ReportRun = { id: string; startedAt: string; finishedAt: string | null; status: "running" | "done" | "failed"; message: string | null };

export type LearningLoopData = {
  points: AccuracyPoint[];
  learnings: LearningEntry[];
  versions: PromptVersion[];
  lastRun: ReportRun | null;
  baseline: (Metrics & { label: string; costUsd: number | null; createdAt: string; top7Groups: number | null }) | null;
};

type RunRow = { shorts_count: number; spearman: number | null; range_hit_rate: number | null; top7_hit_rate: number | null; cost_usd: number | null };
const runMetrics = (r: RunRow | null) =>
  r ? { count: r.shorts_count, spearman: r.spearman, rangeHitRate: r.range_hit_rate, top7HitRate: r.top7_hit_rate, costUsd: r.cost_usd === null ? null : Number(r.cost_usd) } : null;

/** Everything the Learnings page shows. Null without Supabase. */
export async function getLearningLoopData(): Promise<LearningLoopData | null> {
  await connection();
  const db = getDb();
  if (!db) return null;

  const [snapshots, learnings, proposals, versions, lastRun, baseline] = await Promise.all([
    db.from("accuracy_snapshots").select("*").order("created_at"),
    db.from("learnings").select("*").order("week_start", { ascending: false }),
    db.from("prompt_proposals").select("*").order("created_at"),
    listPromptVersions(db),
    db.from("report_runs").select("*").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    db
      .from("backtest_runs")
      .select("*")
      .is("proposal_id", null)
      .not("finished_at", "is", null)
      .is("error", null)
      .order("shorts_count", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  for (const r of [snapshots, learnings, proposals, lastRun, baseline]) if (r.error) throw new Error(`Failed to load learnings: ${r.error.message}`);

  const runIds = [...new Set(proposals.data!.flatMap((p) => [p.baseline_run_id, p.backtest_run_id]).filter((id): id is string => Boolean(id)))];
  const runs = runIds.length ? await db.from("backtest_runs").select("*").in("id", runIds) : { data: [], error: null };
  if (runs.error) throw new Error(`Failed to load backtests: ${runs.error.message}`);
  const runById = new Map(runs.data!.map((r) => [r.id, r]));

  const toProposal = (p: NonNullable<typeof proposals.data>[number]): Proposal => ({
    id: p.id,
    title: p.title,
    reasoning: p.reasoning,
    oldText: p.old_text,
    newText: p.new_text,
    baseVersion: p.base_version,
    status: p.status as Proposal["status"],
    rejectionReason: p.rejection_reason,
    decidedAt: p.decided_at,
    resultingVersion: p.resulting_version,
    baseline: runMetrics(p.baseline_run_id ? (runById.get(p.baseline_run_id) ?? null) : null),
    backtest: runMetrics(p.backtest_run_id ? (runById.get(p.backtest_run_id) ?? null) : null),
  });

  return {
    points: snapshots.data!.map((s) => ({
      id: s.id,
      createdAt: s.created_at,
      source: s.source as AccuracyPoint["source"],
      promptVersion: s.prompt_version,
      count: s.items_count,
      spearman: s.spearman,
      rangeHitRate: s.range_hit_rate,
      top7HitRate: s.top7_hit_rate,
    })),
    learnings: learnings.data!.map((l) => ({
      id: l.id,
      weekStart: l.week_start,
      whatWorked: l.what_worked,
      whatDidntWork: l.what_didnt_work,
      reasoning: l.reasoning,
      patterns: Array.isArray(l.patterns) ? (l.patterns as { dimension: string; finding: string }[]) : [],
      costUsd: l.cost_usd === null ? null : Number(l.cost_usd),
      createdAt: l.created_at,
      proposals: proposals.data!.filter((p) => p.learning_id === l.id).map(toProposal),
    })),
    versions,
    lastRun: lastRun.data
      ? { id: lastRun.data.id, startedAt: lastRun.data.started_at, finishedAt: lastRun.data.finished_at, status: lastRun.data.status as ReportRun["status"], message: lastRun.data.message }
      : null,
    baseline: baseline.data
      ? { ...runMetrics(baseline.data)!, label: baseline.data.label, createdAt: baseline.data.created_at, top7Groups: baseline.data.top7_groups }
      : null,
  };
}
