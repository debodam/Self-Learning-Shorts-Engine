import { Suspense } from "react";
import { Lightbulb } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { AccuracyChart } from "@/components/learnings/accuracy-chart";
import { PromptVersions, RunReportButton } from "@/components/learnings/loop-controls";
import { ProposalCard } from "@/components/learnings/proposal-card";
import { LoadingCard } from "@/components/loading-card";
import { PageHeader } from "@/components/page-header";
import { getLearningLoopData, type LearningEntry, type LearningLoopData } from "@/lib/db/learning-loop";

// "Run weekly report now" keeps working after the response (next/server after()).
export const maxDuration = 800;

const weekLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const pct = (v: number | null) => (v === null ? "n/a" : `${Math.round(v * 100)}%`);

export default function LearningsPage() {
  return (
    <Suspense fallback={<LoadingCard className="h-96" />}>
      <Learnings />
    </Suspense>
  );
}

async function Learnings() {
  const data = await getLearningLoopData();
  return (
    <>
      <PageHeader
        title="Learnings"
        description="How accurate the scoring agent's view predictions are, what it learned each week, and the prompt changes it proposes. Nothing changes until you approve it."
        actions={data && <RunReportButton lastRun={data.lastRun} />}
      />
      {data ? (
        <Body data={data} />
      ) : (
        <EmptyState icon={Lightbulb} title="Connect Supabase">
          The learning loop reads predictions, backtests, and proposals from Supabase.
        </EmptyState>
      )}
    </>
  );
}

function Body({ data }: { data: LearningLoopData }) {
  const pending = data.learnings.flatMap((l) => l.proposals.filter((p) => p.status === "pending"));
  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-card border border-line bg-surface p-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold text-heading">Prediction accuracy</h2>
          {data.baseline && (
            <p className="text-sm text-muted">
              Latest backtest: {data.baseline.count} Shorts, Spearman {data.baseline.spearman?.toFixed(2) ?? "n/a"}, range hit {pct(data.baseline.rangeHitRate)}, top 7 hit{" "}
              {pct(data.baseline.top7HitRate)} over {data.baseline.top7Groups ?? 0} months
            </p>
          )}
        </div>
        <AccuracyChart points={data.points} />
        <p className="mt-3 text-xs text-muted">
          Rank accuracy is the Spearman correlation between predicted and actual settled views (1 is a perfect order). Range hit rate is the share that landed inside
          the predicted range. Top 7 hit rate is the share of each week&apos;s top 7 that beat the channel&apos;s median settled views; backtests use each month&apos;s top
          7, because the channel rarely posted 8 or more Shorts in a week. Backtests predict each past Short using only Shorts published before it.
        </p>
      </section>

      {pending.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="font-semibold text-heading">Waiting for your decision ({pending.length})</h2>
          {pending.map((p) => (
            <ProposalCard key={p.id} proposal={p} />
          ))}
        </section>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="font-semibold text-heading">Weekly learnings</h2>
        {data.learnings.length === 0 ? (
          <EmptyState icon={Lightbulb} title="No weekly reports yet">
            The weekly report runs every Monday, or now with Run weekly report now.
          </EmptyState>
        ) : (
          data.learnings.map((l) => <LearningCard key={l.id} entry={l} />)
        )}
      </section>

      <section className="rounded-card border border-line bg-surface p-5">
        <h2 className="font-semibold text-heading">Scoring prompt versions</h2>
        <p className="mt-1 text-sm text-muted">The active version scores every new clip. Rolling back keeps every version.</p>
        <PromptVersions versions={data.versions} />
      </section>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">{title}</h4>
      <ul className="list-disc space-y-1 pl-5 text-sm text-body">
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

function LearningCard({ entry }: { entry: LearningEntry }) {
  const decided = entry.proposals.filter((p) => p.status !== "pending");
  return (
    <article className="flex flex-col gap-5 rounded-card border border-line bg-surface p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold text-heading">Week of {weekLabel.format(new Date(`${entry.weekStart}T00:00:00Z`))}</h3>
        {entry.costUsd !== null && <span className="text-sm text-muted">Report cost about ${entry.costUsd.toFixed(2)}</span>}
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <List title="What worked" items={entry.whatWorked} />
        <List title="What didn't" items={entry.whatDidntWork} />
      </div>
      <div>
        <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">Why</h4>
        <p className="text-sm text-body">{entry.reasoning}</p>
      </div>
      {entry.patterns.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">Patterns</h4>
          <ul className="space-y-1.5 text-sm text-body">
            {entry.patterns.map((p, i) => (
              <li key={i}>
                <span className="mr-2 rounded-full bg-page px-2 py-0.5 text-xs text-muted">{p.dimension}</span>
                {p.finding}
              </li>
            ))}
          </ul>
        </div>
      )}
      {entry.proposals.length === 0 ? (
        <p className="text-sm text-muted">No prompt changes proposed this week.</p>
      ) : (
        decided.length > 0 && (
          <div className="flex flex-col gap-3">
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted">Decided proposals</h4>
            {decided.map((p) => (
              <ProposalCard key={p.id} proposal={p} />
            ))}
          </div>
        )
      )}
    </article>
  );
}
