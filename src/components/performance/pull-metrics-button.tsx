"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { pullMetricsNow, type PullMetricsResult } from "@/app/performance/actions";

export function PullMetricsButton({ disabled }: { disabled?: boolean }) {
  const [result, setResult] = useState<PullMetricsResult | null>(null);
  const [pending, startTransition] = useTransition();

  function pull() {
    setResult(null);
    startTransition(async () => setResult(await pullMetricsNow()));
  }

  return (
    <div className="flex flex-col gap-2 xl:items-end">
      <button
        type="button"
        onClick={pull}
        disabled={pending || disabled}
        className="flex shrink-0 items-center justify-center gap-2 self-start rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-muted xl:self-end"
      >
        <RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} />
        {pending ? "Pulling metrics" : "Pull metrics now"}
      </button>
      {result && (
        <p role="status" className={`max-w-md text-sm xl:text-right ${result.ok ? "text-muted" : "text-red-600"}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}
