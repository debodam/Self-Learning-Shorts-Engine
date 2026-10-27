"use client";

import { useState, useTransition } from "react";
import { RotateCcw, Sparkles } from "lucide-react";
import { scoreClips, type ScoreClipsResult } from "@/app/review/actions";

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

export function ScoreClips({
  scoredCount,
  unscoredCount,
  lastRun,
}: {
  scoredCount: number;
  unscoredCount: number;
  lastRun: string | null;
}) {
  const [result, setResult] = useState<ScoreClipsResult | null>(null);
  const [running, setRunning] = useState<"new" | "all" | null>(null);
  const [pending, startTransition] = useTransition();

  function run(all: boolean) {
    if (all && !window.confirm(`Re-score all ${plural(scoredCount + unscoredCount, "clip")}? Existing scores are replaced.`)) return;
    setResult(null);
    setRunning(all ? "all" : "new");
    startTransition(async () => {
      setResult(await scoreClips(all));
      setRunning(null);
    });
  }

  const total = scoredCount + unscoredCount;
  const secondary =
    "flex shrink-0 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-medium text-body transition-colors hover:bg-page disabled:cursor-not-allowed disabled:text-muted";
  const primary =
    "flex shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-muted";

  return (
    <div className="mb-6 flex flex-col gap-3 rounded-card border border-line bg-surface px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <p className="font-semibold text-heading">
          {plural(scoredCount, "clip")} scored, {unscoredCount} waiting for scores
        </p>
        {result ? (
          <p role="status" className={`mt-0.5 text-sm ${result.ok ? "text-muted" : "text-red-600"}`}>
            {result.message}
          </p>
        ) : (
          lastRun && <p className="mt-0.5 text-sm text-muted">{lastRun}</p>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        <button type="button" onClick={() => run(true)} disabled={pending || total === 0} className={secondary}>
          <RotateCcw className={`size-4 ${running === "all" ? "animate-spin" : ""}`} />
          {running === "all" ? `Re-scoring ${plural(total, "clip")}` : "Re-score all"}
        </button>
        <button type="button" onClick={() => run(false)} disabled={pending || unscoredCount === 0} className={primary}>
          <Sparkles className={`size-4 ${running === "new" ? "animate-pulse" : ""}`} />
          {running === "new" ? `Scoring ${plural(unscoredCount, "clip")}` : "Score clips"}
        </button>
      </div>
    </div>
  );
}
