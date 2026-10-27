"use client";

import { useDeferredValue, useState } from "react";
import { CalendarClock, Search } from "lucide-react";
import { ClipCard } from "@/components/review/clip-card";
import type { OpusProjectOption } from "@/components/review/opus-sync";
import { WEEKLY_APPROVAL_TARGET, type CandidateClip } from "@/lib/clips";

type StatusFilter = "all" | "shortlist" | "cut";

const control = "rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-body";

/** All clips in one grid, already ordered: kept by rubric score, then unscored, then cut. */
export function ReviewBoard({ clips, batches }: { clips: CandidateClip[]; batches: OpusProjectOption[] }) {
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());
  const [scheduled, setScheduled] = useState(false);
  const [query, setQuery] = useState("");
  const [batch, setBatch] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  // Keeps typing responsive while the grid re-filters.
  const deferredQuery = useDeferredValue(query);

  const approvedCount = approvedIds.size;
  const overTarget = approvedCount > WEEKLY_APPROVAL_TARGET;
  const canSchedule = approvedCount === WEEKLY_APPROVAL_TARGET;

  function toggle(id: string) {
    setScheduled(false);
    setApprovedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const needle = deferredQuery.trim().toLowerCase();
  const visible = clips.filter((clip) => {
    if (status === "shortlist" && !clip.shortlisted) return false;
    if (status === "cut" && !clip.cut) return false;
    if (batch !== "all" && clip.batchId !== batch) return false;
    if (!needle) return true;
    return [clip.title, clip.suggestedTitle, clip.transcript].some((text) => text?.toLowerCase().includes(needle));
  });

  let hint = `Approve ${WEEKLY_APPROVAL_TARGET - approvedCount} more from the shortlist to schedule the week.`;
  if (overTarget) hint = `Remove ${approvedCount - WEEKLY_APPROVAL_TARGET} to schedule the week.`;
  if (canSchedule) hint = "One clip per day at 12pm Eastern on YouTube.";
  if (scheduled) hint = "Scheduling isn't connected yet. Nothing was posted.";

  return (
    <>
      <div className="sticky top-0 z-10 -mx-2 mb-4 flex items-center justify-between gap-4 rounded-card border border-line bg-surface px-5 py-4">
        <div>
          <p className="text-lg font-semibold text-heading">
            <span className={overTarget ? "text-red-600" : "text-primary"}>{approvedCount}</span> of {WEEKLY_APPROVAL_TARGET}{" "}
            approved
          </p>
          <p className="text-sm text-muted">{hint}</p>
        </div>
        <button
          type="button"
          disabled={!canSchedule}
          onClick={() => setScheduled(true)}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
        >
          <CalendarClock className="size-4" />
          Schedule
        </button>
      </div>

      <div className="mb-2 flex flex-col gap-2 md:flex-row">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search clips</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles, suggested titles, and transcripts"
            className={`${control} w-full pl-9`}
          />
        </label>
        <label>
          <span className="sr-only">Batch</span>
          <select value={batch} onChange={(e) => setBatch(e.target.value)} className={`${control} w-full md:w-72`}>
            <option value="all">All batches</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className={`${control} w-full md:w-36`}>
            <option value="all">All</option>
            <option value="shortlist">Shortlist</option>
            <option value="cut">Cut</option>
          </select>
        </label>
      </div>
      <p className="mb-4 text-sm text-muted">
        Showing {visible.length} of {clips.length} clips. Ranked by rubric total; cut clips are last.
      </p>

      {visible.length === 0 ? (
        <p className="rounded-card border border-line bg-surface px-6 py-10 text-center text-sm text-muted">
          No clips match these filters.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((clip) => (
            <ClipCard
              key={clip.id}
              clip={clip}
              approved={approvedIds.has(clip.id)}
              onToggle={clip.shortlisted ? () => toggle(clip.id) : undefined}
            />
          ))}
        </div>
      )}
    </>
  );
}
