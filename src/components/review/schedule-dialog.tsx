"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Bookmark, CalendarCheck, CalendarClock, FlaskConical, X } from "lucide-react";
import { savePicks, scheduleWeekPicks, type ScheduleResult } from "@/app/review/actions";
import type { CandidateClip } from "@/lib/clips";
import { defaultStartDate, slotsFrom, tomorrowEastern } from "@/lib/schedule-slots";

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
 * Preview of the week's posts on the Exponent YouTube channel: one per day at noon
 * Eastern from a start date, skipping days that already have a post, with editable titles
 * and descriptions. Nothing is scheduled until the user confirms "Test with 1 clip" or
 * "Schedule all". "Save picks for later" keeps the picks and text without scheduling.
 */
export function ScheduleDialog({
  weekId,
  picks,
  bookedDates,
  onClose,
}: {
  weekId: string;
  /** All of the week's picks, scheduled or not, in preview order. */
  picks: CandidateClip[];
  /** New York dates that already have a post. */
  bookedDates: string[];
  onClose: () => void;
}) {
  const [startDate, setStartDate] = useState(() => defaultStartDate(bookedDates));
  // Keyed by clip, since rows move from unscheduled to scheduled as posts go out.
  const [titles, setTitles] = useState<Record<string, string>>(() =>
    Object.fromEntries(picks.map((c) => [c.id, c.youtubeTitle ?? c.suggestedTitle ?? c.title])),
  );
  const [descriptions, setDescriptions] = useState<Record<string, string>>(() =>
    Object.fromEntries(picks.map((c) => [c.id, c.youtubeDescription ?? ""])),
  );
  const [result, setResult] = useState<ScheduleResult | null>(null);
  const [pending, startTransition] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const unscheduled = picks.filter((c) => !c.scheduledFor);
  const minDate = tomorrowEastern();
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(startDate) && startDate >= minDate;
  // The same math the server uses, so the preview shows the dates that get scheduled.
  const slots = validDate ? slotsFrom(startDate, unscheduled.length, bookedDates).map((d) => d.toISOString()) : [];
  const scheduledCount = picks.length - unscheduled.length;
  const invalid = unscheduled.some((c) => {
    const title = titles[c.id].trim();
    return !title || title.length > TITLE_MAX || !descriptions[c.id].trim();
  });

  function schedule(testOne: boolean) {
    const count = testOne ? 1 : unscheduled.length;
    const first = slotFormat.format(new Date(slots[0]));
    const last = slotFormat.format(new Date(slots[count - 1]));
    const confirmed = window.confirm(
      testOne
        ? `Schedule 1 public post, "${titles[unscheduled[0].id].trim()}", on the Exponent YouTube channel for ${first}?`
        : `Schedule ${count} public posts on the Exponent YouTube channel, one per day from ${first} to ${last}?`,
    );
    if (!confirmed) return;
    setResult(null);
    startTransition(async () => {
      const items = unscheduled.map((c) => ({ clipId: c.id, title: titles[c.id], description: descriptions[c.id] }));
      setResult(await scheduleWeekPicks(weekId, items, startDate, testOne));
    });
  }

  function saveForLater() {
    setResult(null);
    startTransition(async () => {
      const items = unscheduled.map((c) => ({ clipId: c.id, title: titles[c.id], description: descriptions[c.id] }));
      setResult(await savePicks(weekId, items));
    });
  }

  let slotIndex = 0;
  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      // Only the list scrolls, so the header and the confirm buttons stay in view.
      className="m-auto max-h-[90vh] w-[min(48rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-card border border-line bg-surface p-0 text-body backdrop:bg-heading/40 open:flex"
    >
      <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold text-heading">Schedule this week&apos;s 7 clips</h2>
          <p className="text-sm text-muted">
            One per day at 12pm Eastern on the Exponent YouTube channel, through OpusClip, skipping days that already
            have a post. Edit titles and descriptions before confirming. Any clip without a headline gets its suggested
            title, and scheduling waits for Opus to render it into the video (usually under a minute).
          </p>
          {unscheduled.length > 0 && (
            <label className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-heading">Start date</span>
              <input
                type="date"
                value={startDate}
                min={minDate}
                disabled={pending}
                onChange={(e) => setStartDate(e.target.value)}
                className={`rounded-lg border px-2.5 py-1.5 text-sm text-body ${validDate ? "border-line" : "border-red-400"}`}
              />
              {!validDate && <span className="text-xs text-red-600">Pick tomorrow or later.</span>}
            </label>
          )}
        </div>
        <button type="button" onClick={() => dialog.current?.close()} aria-label="Close" className="rounded-md p-1 text-muted hover:bg-page">
          <X className="size-5" />
        </button>
      </div>

      <ol className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
        {picks.map((clip) => {
          if (clip.scheduledFor) {
            return (
              <li key={clip.id} className="flex flex-col gap-1 bg-page/60 px-6 py-4">
                <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-emerald-700">
                  <CalendarCheck className="size-3.5" />
                  Scheduled for {slotFormat.format(new Date(clip.scheduledFor))}
                </p>
                <p className="text-sm font-medium text-heading">{clip.youtubeTitle ?? clip.title}</p>
              </li>
            );
          }
          const slot = slots[slotIndex++];
          const title = titles[clip.id];
          const length = title.trim().length;
          return (
            <li key={clip.id} className="flex flex-col gap-2 px-6 py-4">
              <p className="text-xs font-medium uppercase tracking-wide text-primary">
                {slot ? slotFormat.format(new Date(slot)) : "Pick a start date"}
              </p>
              <p className="text-xs text-muted">
                Headline on the video:{" "}
                <span className="font-medium text-body">
                  {clip.headline ?? `${clip.suggestedTitle ?? clip.title} (added when scheduled)`}
                </span>
              </p>
              <label className="flex flex-col gap-1">
                <span className="sr-only">YouTube title for {clip.title}</span>
                <input
                  value={title}
                  disabled={pending}
                  onChange={(e) => setTitles((prev) => ({ ...prev, [clip.id]: e.target.value }))}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium text-heading ${length > TITLE_MAX || length === 0 ? "border-red-400" : "border-line"}`}
                />
                <span className={`text-xs ${length > TITLE_MAX ? "text-red-600" : "text-muted"}`}>
                  {length}/{TITLE_MAX} characters
                </span>
              </label>
              <label className="flex flex-col gap-1">
                <span className="sr-only">YouTube description for {clip.title}</span>
                <textarea
                  value={descriptions[clip.id]}
                  disabled={pending}
                  rows={2}
                  onChange={(e) => setDescriptions((prev) => ({ ...prev, [clip.id]: e.target.value }))}
                  className={`resize-y rounded-lg border px-3 py-2 text-sm text-body ${descriptions[clip.id].trim() ? "border-line" : "border-red-400"}`}
                />
              </label>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-col gap-3 border-t border-line px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p role="status" className={`text-sm ${result && !result.ok ? "text-red-600" : "text-muted"}`}>
          {result?.message ??
            (scheduledCount
              ? `${scheduledCount} scheduled, ${unscheduled.length} to go. Confirming posts publicly.`
              : "Confirming schedules public posts. Nothing goes out until you confirm.")}
        </p>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button type="button" onClick={() => dialog.current?.close()} className="rounded-lg border border-line px-4 py-2.5 text-sm font-medium hover:bg-page">
            {unscheduled.length === 0 ? "Close" : "Cancel"}
          </button>
          {unscheduled.length > 0 && (
            <>
              <button
                type="button"
                onClick={saveForLater}
                disabled={pending || invalid}
                className="flex items-center gap-2 rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-body hover:bg-page disabled:cursor-not-allowed disabled:text-muted"
              >
                <Bookmark className="size-4" />
                Save picks for later
              </button>
              <button
                type="button"
                onClick={() => schedule(true)}
                disabled={pending || invalid || slots.length === 0}
                className="flex items-center gap-2 rounded-lg border border-primary px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary-tint disabled:cursor-not-allowed disabled:border-line disabled:text-muted"
              >
                <FlaskConical className="size-4" />
                Test with 1 clip
              </button>
              <button
                type="button"
                onClick={() => schedule(false)}
                disabled={pending || invalid || slots.length < unscheduled.length}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
              >
                <CalendarClock className="size-4" />
                {pending ? "Rendering and scheduling" : `Schedule ${unscheduled.length === picks.length ? "all" : "the other"} ${unscheduled.length}`}
              </button>
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
