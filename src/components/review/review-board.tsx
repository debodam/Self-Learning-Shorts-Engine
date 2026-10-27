"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { ClipCard } from "@/components/review/clip-card";
import { WEEKLY_APPROVAL_TARGET, type CandidateClip } from "@/lib/clips";

export function ReviewBoard({ clips }: { clips: CandidateClip[] }) {
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());
  const [scheduled, setScheduled] = useState(false);

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

  let hint = `Approve ${WEEKLY_APPROVAL_TARGET - approvedCount} more to schedule the week.`;
  if (overTarget) hint = `Remove ${approvedCount - WEEKLY_APPROVAL_TARGET} to schedule the week.`;
  if (canSchedule) hint = "One clip per day at 12pm Eastern on YouTube, TikTok, and Instagram.";
  if (scheduled) hint = "Scheduling isn't connected yet. Nothing was posted.";

  return (
    <>
      <div className="sticky top-0 z-10 -mx-2 mb-6 flex items-center justify-between gap-4 rounded-card border border-line bg-surface px-5 py-4">
        <div>
          <p className="text-lg font-semibold text-heading">
            <span className={overTarget ? "text-red-600" : "text-primary"}>
              {approvedCount}
            </span>{" "}
            of {WEEKLY_APPROVAL_TARGET} approved
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

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {clips.map((clip) => (
          <ClipCard
            key={clip.id}
            clip={clip}
            approved={approvedIds.has(clip.id)}
            onToggle={() => toggle(clip.id)}
          />
        ))}
      </div>
    </>
  );
}
