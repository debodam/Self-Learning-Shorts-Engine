"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { scoreClips, type ScoreClipsResult } from "@/app/review/actions";

export function ScoreClips({ unscoredCount, lastRun }: { unscoredCount: number; lastRun: string | null }) {
  const [result, setResult] = useState<ScoreClipsResult | null>(null);
  const [pending, startTransition] = useTransition();

  function score() {
    setResult(null);
    startTransition(async () => {
      setResult(await scoreClips());
    });
  }

  return (
    <div className="mb-8 flex flex-col gap-3 rounded-card border border-line bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-semibold text-heading">
          {unscoredCount === 0 ? "Every synced clip is scored" : `${unscoredCount} ${unscoredCount === 1 ? "clip" : "clips"} waiting for scores`}
        </p>
        {result ? (
          <p role="status" className={`mt-0.5 text-sm ${result.ok ? "text-muted" : "text-red-600"}`}>
            {result.message}
          </p>
        ) : (
          lastRun && <p className="mt-0.5 text-sm text-muted">{lastRun}</p>
        )}
      </div>
      <button
        type="button"
        onClick={score}
        disabled={pending || unscoredCount === 0}
        className="flex shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
      >
        <Sparkles className={`size-4 ${pending ? "animate-pulse" : ""}`} />
        {pending ? `Scoring ${unscoredCount} ${unscoredCount === 1 ? "clip" : "clips"}` : "Score clips"}
      </button>
    </div>
  );
}
