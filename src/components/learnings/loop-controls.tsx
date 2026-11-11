"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { rollBackTo, runWeeklyReportNow, type LoopActionResult } from "@/app/learnings/actions";
import type { ReportRun } from "@/lib/db/learning-loop";
import type { PromptVersion } from "@/lib/prompt-versions";

const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" });

export function RunReportButton({ lastRun }: { lastRun: ReportRun | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<LoopActionResult | null>(null);
  const running = lastRun?.status === "running";

  // While a report runs, refresh every 20 seconds so the page shows it when it's done.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), 20_000);
    return () => clearInterval(timer);
  }, [running, router]);

  return (
    <div className="flex flex-col gap-2 xl:items-end">
      <button
        type="button"
        disabled={pending || running}
        onClick={() => {
          if (!confirm("Run the weekly report now? It uses Claude to write learnings and backtest each proposal, about $1 to $2, and takes about 10 minutes.")) return;
          setResult(null);
          startTransition(async () => setResult(await runWeeklyReportNow()));
        }}
        className="flex items-center justify-center gap-2 self-start rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-muted xl:self-end"
      >
        <RefreshCw className={`size-4 ${pending || running ? "animate-spin" : ""}`} />
        {running ? "Weekly report running" : "Run weekly report now"}
      </button>
      {result ? (
        <p role="status" className={`max-w-md text-sm xl:text-right ${result.ok ? "text-muted" : "text-red-600"}`}>
          {result.message}
        </p>
      ) : (
        lastRun && (
          <p className={`max-w-md text-sm xl:text-right ${lastRun.status === "failed" ? "text-red-600" : "text-muted"}`}>
            {lastRun.status === "running"
              ? `Started ${when.format(new Date(lastRun.startedAt))}.`
              : `Last run ${when.format(new Date(lastRun.finishedAt ?? lastRun.startedAt))}: ${lastRun.status === "failed" ? "failed. " : ""}${lastRun.message ?? ""}`}
          </p>
        )
      )}
    </div>
  );
}

export function PromptVersions({ versions }: { versions: PromptVersion[] }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<LoopActionResult | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-line">
        {versions.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="font-medium text-heading">
                Version {v.version}
                {v.active && <span className="ml-2 rounded-full bg-primary-tint px-2 py-0.5 text-xs font-medium text-primary">Active</span>}
              </p>
              <p className="text-sm text-muted">
                {when.format(new Date(v.createdAt))}. {v.notes}
              </p>
              <details className="mt-1 text-sm">
                <summary className="cursor-pointer text-primary hover:underline">Full prompt</summary>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-page p-3 text-xs text-body">{v.text}</pre>
              </details>
            </div>
            {!v.active && (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (!confirm(`Make version ${v.version} active again? New clips will be scored with it.`)) return;
                  setResult(null);
                  startTransition(async () => setResult(await rollBackTo(v.version)));
                }}
                className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-body hover:bg-page disabled:text-muted"
              >
                Roll back to v{v.version}
              </button>
            )}
          </li>
        ))}
      </ul>
      {result && (
        <p role="status" className={`text-sm ${result.ok ? "text-muted" : "text-red-600"}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}
