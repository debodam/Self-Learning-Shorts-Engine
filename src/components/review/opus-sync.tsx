"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { syncFromOpus, type SyncFromOpusResult } from "@/app/review/actions";

export type OpusProjectOption = { id: string; label: string };

export function OpusSync({ projects }: { projects: OpusProjectOption[] }) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [result, setResult] = useState<SyncFromOpusResult | null>(null);
  const [pending, startTransition] = useTransition();

  function sync() {
    setResult(null);
    startTransition(async () => {
      setResult(await syncFromOpus(projectId));
    });
  }

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto xl:items-end">
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        <label htmlFor="opus-project" className="sr-only">
          Opus project
        </label>
        <select
          id="opus-project"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          disabled={pending || projects.length === 0}
          className="w-full min-w-0 rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-body sm:w-80"
        >
          {projects.length === 0 && <option value="">No Opus projects found</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={sync}
          disabled={pending || !projectId}
          className="flex shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
        >
          <RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} />
          {pending ? "Syncing" : "Sync from Opus"}
        </button>
      </div>
      {result && (
        <p role="status" className={`max-w-md text-sm xl:text-right ${result.ok ? "text-muted" : "text-red-600"}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}
