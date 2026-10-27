"use client";

import { useDeferredValue, useState, useTransition } from "react";
import { CalendarClock, Search } from "lucide-react";
import { addMissingPickHeadlines, togglePick } from "@/app/review/actions";
import { ClipCard } from "@/components/review/clip-card";
import type { OpusProjectOption } from "@/components/review/opus-sync";
import { ScheduleDialog, type PostAccounts } from "@/components/review/schedule-dialog";
import { WEEKLY_APPROVAL_TARGET, type CandidateClip } from "@/lib/clips";

type StatusFilter = "all" | "picks" | "cut";

const control = "rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-body";

export type WeekOption = { id: string; label: string };

/**
 * This week's top 7 picks, then every clip in one filterable grid. Clips arrive already
 * ordered: kept by rubric score, then unscored, then cut.
 */
export function ReviewBoard({
  clips,
  weeks,
  batches,
  bookedDates,
  postAccounts,
}: {
  clips: CandidateClip[];
  /** Newest first; the first is the current week. */
  weeks: WeekOption[];
  batches: OpusProjectOption[];
  /** New York dates that already have a post, so the schedule skips them. */
  bookedDates: string[];
  postAccounts: PostAccounts;
}) {
  const currentWeekId = weeks[0]?.id ?? null;
  const [query, setQuery] = useState("");
  const [batch, setBatch] = useState(currentWeekId ? `week:${currentWeekId}` : "all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [scheduling, setScheduling] = useState(false);
  const [pickNote, setPickNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [fixing, startFixing] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // Keeps typing responsive while the grid re-filters.
  const deferredQuery = useDeferredValue(query);

  const picks = clips.filter((c) => c.picked && c.weekId === currentWeekId && currentWeekId);
  const pickCount = picks.length;
  const overTarget = pickCount > WEEKLY_APPROVAL_TARGET;
  const unscheduledCount = picks.filter((c) => !c.scheduledFor && !c.posted).length;
  // Every unscheduled pick needs a headline in the video before it can be scheduled.
  // Picks Opus couldn't be checked for (render unknown) are left to the server's check.
  const missingHeadlines = picks.filter((c) => !c.scheduledFor && !c.posted && c.render && !c.headline);
  const canSchedule = pickCount === WEEKLY_APPROVAL_TARGET && unscheduledCount > 0 && missingHeadlines.length === 0;

  function addMissing() {
    if (!currentWeekId) return;
    setPickNote(null);
    startFixing(async () => {
      const result = await addMissingPickHeadlines(currentWeekId);
      setPickNote({ ok: result.ok, text: result.message });
    });
  }
  // Scheduled clips are locked in; cancel the post on the Schedule page to change them.
  const pickable = (clip: CandidateClip) =>
    Boolean(currentWeekId && clip.weekId === currentWeekId && clip.scores && !clip.cut && !clip.scheduledFor && !clip.posted);

  function toggle(clip: CandidateClip) {
    if (!currentWeekId) return;
    setPickNote(null);
    setPendingId(clip.id);
    startTransition(async () => {
      const result = await togglePick(currentWeekId, clip.id, !clip.picked);
      if (result.message) setPickNote({ ok: result.ok, text: result.message });
      setPendingId(null);
    });
  }

  const needle = deferredQuery.trim().toLowerCase();
  const visible = clips.filter((clip) => {
    if (status === "picks" && !clip.picked) return false;
    if (status === "cut" && !clip.cut) return false;
    if (batch.startsWith("week:") && clip.weekId !== batch.slice(5)) return false;
    if (batch.startsWith("video:") && clip.batchId !== batch.slice(6)) return false;
    if (!needle) return true;
    return [clip.title, clip.suggestedTitle, clip.transcript].some((text) => text?.toLowerCase().includes(needle));
  });

  let hint = `Select ${WEEKLY_APPROVAL_TARGET - pickCount} more to schedule the week.`;
  if (overTarget) hint = `Unselect ${pickCount - WEEKLY_APPROVAL_TARGET} to schedule the week.`;
  if (pickCount === WEEKLY_APPROVAL_TARGET) {
    hint =
      unscheduledCount === 0
        ? "All 7 are scheduled. See the Schedule page."
        : unscheduledCount < pickCount
          ? `${pickCount - unscheduledCount} scheduled, ${unscheduledCount} to go.`
          : picks.every((c) => c.readyToSchedule)
            ? "Saved as Ready to schedule. Open Schedule to pick a start date."
            : "One per day at 12pm Eastern on YouTube from the start date you pick.";
  }
  if (!currentWeekId) hint = "Start a week above. Its top 7 clips are picked automatically after scoring.";

  const card = (clip: CandidateClip) => (
    <ClipCard
      key={clip.id}
      clip={clip}
      approved={Boolean(clip.picked)}
      busy={pendingId === clip.id}
      onToggle={pickable(clip) ? () => toggle(clip) : undefined}
    />
  );

  return (
    <>
      <section className="mb-10">
        <div className="sticky top-0 z-10 -mx-2 mb-4 flex items-center justify-between gap-4 rounded-card border border-line bg-surface px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-heading">This week&apos;s top 7</h2>
            <p className="text-sm text-muted">
              <span className={`font-semibold ${overTarget ? "text-red-600" : "text-primary"}`}>{pickCount}</span> of{" "}
              {WEEKLY_APPROVAL_TARGET} selected. {hint}
            </p>
            {pickNote && <p className={`mt-1 text-sm ${pickNote.ok ? "text-muted" : "text-red-600"}`}>{pickNote.text}</p>}
          </div>
          <button
            type="button"
            disabled={!canSchedule}
            onClick={() => setScheduling(true)}
            className="flex shrink-0 items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
          >
            <CalendarClock className="size-4" />
            Schedule
          </button>
        </div>
        {missingHeadlines.length > 0 && (
          <div className="mb-4 flex flex-col gap-3 rounded-card border border-amber-200 bg-amber-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-amber-900">
              <p className="font-medium">
                Scheduling is blocked: {missingHeadlines.length} {missingHeadlines.length === 1 ? "pick has" : "picks have"} no headline.
              </p>
              <ul className="mt-1 list-disc pl-5">
                {missingHeadlines.map((c) => (
                  <li key={c.id}>{c.suggestedTitle ?? c.title}</li>
                ))}
              </ul>
            </div>
            <button
              type="button"
              onClick={addMissing}
              disabled={fixing}
              className="shrink-0 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
            >
              {fixing ? "Adding headlines" : "Add missing headlines"}
            </button>
          </div>
        )}
        {picks.length > 0 ? (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">{picks.map(card)}</div>
        ) : (
          <p className="rounded-card border border-line bg-surface px-6 py-8 text-center text-sm text-muted">
            {currentWeekId
              ? "No picks yet. They're chosen automatically once both videos are synced and scored."
              : "No week started yet."}
          </p>
        )}
      </section>

      <h2 className="mb-3 text-lg font-semibold text-heading">All clips</h2>
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
            {weeks.length > 0 && (
              <optgroup label="Weeks">
                {weeks.map((w, i) => (
                  <option key={w.id} value={`week:${w.id}`}>
                    {w.label}
                    {i === 0 ? " (current)" : ""}
                  </option>
                ))}
              </optgroup>
            )}
            {batches.length > 0 && (
              <optgroup label="Source videos">
                {batches.map((b) => (
                  <option key={b.id} value={`video:${b.id}`}>
                    {b.label}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <label>
          <span className="sr-only">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className={`${control} w-full md:w-36`}>
            <option value="all">All</option>
            <option value="picks">Picks</option>
            <option value="cut">Cut</option>
          </select>
        </label>
      </div>
      <p className="mb-4 text-sm text-muted">
        Showing {visible.length} of {clips.length} clips. Ranked by rubric total; cut clips are last.
      </p>

      {visible.length === 0 ? (
        <p className="rounded-card border border-line bg-surface px-6 py-10 text-center text-sm text-muted">No clips match these filters.</p>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">{visible.map(card)}</div>
      )}

      {scheduling && currentWeekId && (
        <ScheduleDialog
          // Reloads the preview's fields once captions are written, so they show the new text.
          key={picks.map((c) => (c.caption ? "1" : "0")).join("")}
          weekId={currentWeekId}
          picks={picks}
          bookedDates={bookedDates}
          postAccounts={postAccounts}
          onClose={() => setScheduling(false)}
        />
      )}
    </>
  );
}
