"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { CalendarClock, X } from "lucide-react";
import { scheduleWeekPicks, type ScheduleResult } from "@/app/review/actions";
import type { CandidateClip } from "@/lib/clips";

const TITLE_MAX = 59;

const slotFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/New_York",
  timeZoneName: "short",
});

/**
 * Preview of the week's 7 posts: one per day at noon Eastern starting tomorrow, with
 * editable YouTube titles. Nothing is scheduled until Confirm.
 */
export function ScheduleDialog({
  weekId,
  picks,
  slots,
  live,
  onClose,
}: {
  weekId: string;
  picks: CandidateClip[];
  /** ISO times, one per pick, in order. */
  slots: string[];
  live: boolean;
  onClose: () => void;
}) {
  const [titles, setTitles] = useState(() => picks.map((c) => c.youtubeTitle ?? c.suggestedTitle ?? c.title));
  const [result, setResult] = useState<ScheduleResult | null>(null);
  const [pending, startTransition] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const tooLong = titles.some((t) => t.trim().length === 0 || t.trim().length > TITLE_MAX);
  const done = result?.ok && result.live;

  function confirm() {
    setResult(null);
    startTransition(async () => {
      setResult(await scheduleWeekPicks(weekId, picks.map((c, i) => ({ clipId: c.id, title: titles[i] }))));
    });
  }

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      // Only the list scrolls, so the header and the confirm button stay in view.
      className="m-auto max-h-[90vh] w-[min(48rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-card border border-line bg-surface p-0 text-body backdrop:bg-heading/40 open:flex"
    >
      <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold text-heading">Schedule this week&apos;s 7 clips</h2>
          <p className="text-sm text-muted">
            One per day at 12pm Eastern on the Exponent YouTube channel, through OpusClip. Edit titles before confirming.
          </p>
        </div>
        <button type="button" onClick={() => dialog.current?.close()} aria-label="Close" className="rounded-md p-1 text-muted hover:bg-page">
          <X className="size-5" />
        </button>
      </div>

      <ol className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
        {picks.map((clip, i) => {
          const length = titles[i].trim().length;
          return (
            <li key={clip.id} className="flex flex-col gap-2 px-6 py-4">
              <p className="text-xs font-medium uppercase tracking-wide text-primary">{slotFormat.format(new Date(slots[i]))}</p>
              <label className="flex flex-col gap-1">
                <span className="sr-only">YouTube title for {clip.title}</span>
                <input
                  value={titles[i]}
                  disabled={pending || done}
                  onChange={(e) => setTitles((prev) => prev.map((t, j) => (j === i ? e.target.value : t)))}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium text-heading ${length > TITLE_MAX || length === 0 ? "border-red-400" : "border-line"}`}
                />
                <span className={`text-xs ${length > TITLE_MAX ? "text-red-600" : "text-muted"}`}>
                  {length}/{TITLE_MAX} characters
                </span>
              </label>
              <p className="text-sm text-muted">{clip.youtubeDescription || "No description yet."}</p>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-col gap-3 border-t border-line px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p role="status" className={`text-sm ${result && !result.ok ? "text-red-600" : "text-muted"}`}>
          {result?.message ?? (live ? "Confirming schedules these posts publicly." : "Scheduling isn't live yet, so confirming is a dry run.")}
        </p>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => dialog.current?.close()} className="rounded-lg border border-line px-4 py-2.5 text-sm font-medium hover:bg-page">
            {done ? "Close" : "Cancel"}
          </button>
          {!done && (
            <button
              type="button"
              onClick={confirm}
              disabled={pending || tooLong}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
            >
              <CalendarClock className="size-4" />
              {pending ? "Scheduling" : live ? "Confirm and schedule" : "Confirm (dry run)"}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
