"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Bookmark, CalendarCheck, CalendarClock, CheckCircle2, FlaskConical, PenLine, RotateCcw, Send, X } from "lucide-react";
import { publishPicks, savePicks, writeCaptionsForPicks, type ScheduleResult } from "@/app/review/actions";
import type { CandidateClip } from "@/lib/clips";
import {
  DEFAULT_POST_TIME,
  defaultStartDate,
  easternDate,
  easternToUtc,
  localTimeLabel,
  slotsFrom,
  tomorrowEastern,
} from "@/lib/schedule-slots";

const TITLE_MAX = 59;
const PLATFORMS = ["youtube", "tiktok", "instagram"] as const;
type PlatformKey = (typeof PLATFORMS)[number];
const PLATFORM_LABELS: Record<PlatformKey, string> = { youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram" };

/** Who each platform posts to, e.g. "@aced_io (Aced (formerly Exponent))", or why that couldn't be checked. */
export type PostAccounts = { accounts: Record<string, string> | null; error: string | null };

type Row = {
  date: string;
  time: string;
  platforms: PlatformKey[];
  /** Posted to every platform; its first line is the title. */
  caption: string;
};

const firstLine = (caption: string) => caption.trim().split("\n")[0].trim();

const slotFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/New_York",
  timeZoneName: "short",
});

/** Problems the server would also reject, shown before sending. Empty when the row is ready. */
function rowIssues(row: Row, postNow: boolean) {
  const issues: string[] = [];
  if (!row.platforms.length) issues.push("Pick at least one platform.");
  if (!postNow) {
    const at = easternToUtc(row.date, row.time);
    if (!at) issues.push("Pick a valid date and time.");
    else if (at.getTime() < Date.now() + 5 * 60 * 1000) issues.push("The time has to be at least 5 minutes from now.");
  }
  if (!row.caption.trim()) issues.push("Add a caption.");
  else if (row.platforms.includes("youtube") && firstLine(row.caption).length > TITLE_MAX) {
    issues.push(`The first line is the YouTube title; keep it to ${TITLE_MAX} characters.`);
  }
  return issues;
}

/**
 * Preview of the week's posts through OpusClip. By default one clip per day at 12pm
 * Eastern from a start date, on YouTube, TikTok, and Instagram. Each clip's date, time,
 * platforms, and captions can be changed, and any clip can be posted now. Nothing is sent
 * until the user confirms a dialog that lists the platforms and accounts.
 */
export function ScheduleDialog({
  weekId,
  picks,
  bookedDates,
  postAccounts,
  onClose,
}: {
  weekId: string;
  /** All of the week's picks, sent or not, in preview order. */
  picks: CandidateClip[];
  /** New York dates that already have a post. */
  bookedDates: string[];
  postAccounts: PostAccounts;
  onClose: () => void;
}) {
  const open = picks.filter((c) => !c.scheduledFor && !c.posted);
  const minDate = tomorrowEastern();
  const [startDate, setStartDate] = useState(() => defaultStartDate(bookedDates));
  const defaultDates = (start: string) => slotsFrom(start, open.length, bookedDates).map((d) => easternDate(d));

  const [rows, setRows] = useState<Record<string, Row>>(() => {
    const dates = defaultDates(startDate);
    return Object.fromEntries(
      open.map((c, i) => [
        c.id,
        {
          date: dates[i],
          time: DEFAULT_POST_TIME,
          platforms: [...PLATFORMS],
          caption: c.caption ?? "",
        },
      ]),
    );
  });
  // Posted clips the user chose to Post again. They post or schedule on their own, never in the batch.
  const [reposting, setReposting] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<ScheduleResult | null>(null);
  const [pending, startTransition] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  // A caption written after the preview opened (Write captions) shows if the box is empty.
  const editable = picks.filter((c) => rows[c.id] && (open.includes(c) || reposting.has(c.id)));
  const rowsNow: Record<string, Row> = Object.fromEntries(
    editable.map((c) => [c.id, { ...rows[c.id], caption: rows[c.id].caption || c.caption || "" }]),
  );

  function postAgain(c: CandidateClip) {
    setResult(null);
    setRows((prev) => ({
      ...prev,
      [c.id]: prev[c.id] ?? { date: defaultDates(startDate)[0] ?? minDate, time: DEFAULT_POST_TIME, platforms: [...PLATFORMS], caption: c.caption ?? "" },
    }));
    setReposting((prev) => new Set(prev).add(c.id));
  }

  function keepPosted(c: CandidateClip) {
    setReposting((prev) => {
      const next = new Set(prev);
      next.delete(c.id);
      return next;
    });
  }

  const update = (id: string, patch: Partial<Row>) => setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  function changeStart(date: string) {
    setStartDate(date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < minDate) return;
    // Re-spreads every clip from the new start date, one per day at 12pm Eastern.
    const dates = defaultDates(date);
    setRows((prev) => Object.fromEntries(open.map((c, i) => [c.id, { ...prev[c.id], date: dates[i], time: DEFAULT_POST_TIME }])));
  }

  const accounts = postAccounts.accounts;
  const blocked = Boolean(postAccounts.error) || !accounts;
  const needsCaptions = open.some((c) => !rowsNow[c.id]?.caption.trim());
  const scheduleIssues = open.flatMap((c) => rowIssues(rowsNow[c.id], false).map((i) => `${firstLine(rowsNow[c.id].caption) || c.title}: ${i}`));
  const missingHeadline = open.filter((c) => c.render && !c.headline);

  const itemFor = (c: CandidateClip, postNow: boolean) => {
    const row = rowsNow[c.id];
    return {
      clipId: c.id,
      platforms: row.platforms,
      publishAt: postNow ? null : (easternToUtc(row.date, row.time)?.toISOString() ?? ""),
      caption: row.caption,
      repost: reposting.has(c.id),
    };
  };

  const describe = (c: CandidateClip, postNow: boolean) => {
    const row = rowsNow[c.id];
    const at = easternToUtc(row.date, row.time);
    const when = postNow ? "NOW" : at ? `${slotFormat.format(at)} (${localTimeLabel(at)})` : "?";
    const where = row.platforms.map((p) => `${PLATFORM_LABELS[p]} ${accounts?.[p] ?? ""}`).join(", ");
    return `"${firstLine(row.caption) || c.title}"\n  ${when}\n  ${where}`;
  };

  function send(clips: CandidateClip[], postNow: boolean) {
    const again = clips.some((c) => reposting.has(c.id)) ? " It was already posted, so this posts it again." : "";
    const intro = postNow
      ? `Post this clip publicly right now?${again}`
      : `Schedule ${clips.length} ${clips.length === 1 ? "clip" : "clips"} to post publicly?${again}`;
    if (!window.confirm(`${intro}\n\n${clips.map((c) => describe(c, postNow)).join("\n\n")}`)) return;
    setResult(null);
    startTransition(async () => {
      setResult(await publishPicks(weekId, clips.map((c) => itemFor(c, postNow))));
    });
  }

  function saveForLater() {
    setResult(null);
    startTransition(async () => setResult(await savePicks(weekId, open.map((c) => itemFor(c, false)))));
  }

  function writeCaptions() {
    setResult(null);
    startTransition(async () => setResult(await writeCaptionsForPicks(weekId)));
  }

  const field = "rounded-lg border border-line px-3 py-2 text-sm text-body disabled:bg-page";

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      // Only the list scrolls, so the header and the confirm buttons stay in view.
      className="m-auto max-h-[92vh] w-[min(56rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-card border border-line bg-surface p-0 text-body backdrop:bg-heading/40 open:flex"
    >
      <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-heading">Schedule this week&apos;s 7 clips</h2>
          <p className="text-sm text-muted">
            Through OpusClip to YouTube {accounts?.youtube ?? ""}, TikTok {accounts?.tiktok ?? ""}, and Instagram{" "}
            {accounts?.instagram ?? ""}, with the same caption on all three. By default one per day at 12pm Eastern.
            Change any clip&apos;s time, platforms, or caption below, or post it now.
          </p>
          {open.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2">
                <span className="font-medium text-heading">Start date</span>
                <input
                  type="date"
                  value={startDate}
                  min={minDate}
                  disabled={pending}
                  onChange={(e) => changeStart(e.target.value)}
                  className="rounded-lg border border-line px-2.5 py-1.5 text-sm"
                />
              </label>
              <span className="text-xs text-muted">Changing it re-spreads every clip to one per day at 12pm Eastern.</span>
              {needsCaptions && (
                <button
                  type="button"
                  onClick={writeCaptions}
                  disabled={pending}
                  className="flex items-center gap-1.5 rounded-lg border border-primary px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary-tint disabled:opacity-60"
                >
                  <PenLine className="size-3.5" />
                  Write captions
                </button>
              )}
            </div>
          )}
          {postAccounts.error && <p className="mt-2 text-sm text-red-600">Posting is blocked: {postAccounts.error}</p>}
          {missingHeadline.length > 0 && (
            <p className="mt-2 text-sm text-red-600">
              Posting is blocked until every clip has a headline. Missing: {missingHeadline.map((c) => c.suggestedTitle ?? c.title).join(", ")}.
            </p>
          )}
        </div>
        <button type="button" onClick={() => dialog.current?.close()} aria-label="Close" className="rounded-md p-1 text-muted hover:bg-page">
          <X className="size-5" />
        </button>
      </div>

      <ol className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
        {picks.map((clip) => {
          const title = (clip.caption && firstLine(clip.caption)) || clip.youtubeTitle || clip.title;
          if (clip.posted && !reposting.has(clip.id)) {
            const where = (clip.postedTo ?? []).map((p) => PLATFORM_LABELS[p as PlatformKey] ?? p).join(", ");
            return (
              // Out of the rotation: grayed out, with Post again on hover or keyboard focus.
              <li key={clip.id} className="group relative flex items-center justify-between gap-3 bg-page/60 px-6 py-4">
                <div className="min-w-0 opacity-50 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                  <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-emerald-700">
                    <CheckCircle2 className="size-3.5" />
                    Posted{clip.postedAt ? ` ${slotFormat.format(new Date(clip.postedAt))}` : ""}
                    {where ? ` to ${where}` : ""}
                  </p>
                  <p className="text-sm font-medium text-heading">{title}</p>
                  {clip.scheduledFor && (
                    <p className="text-xs text-muted">Posting again {slotFormat.format(new Date(clip.scheduledFor))}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => postAgain(clip)}
                  disabled={pending || Boolean(clip.scheduledFor)}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-body opacity-0 transition-opacity hover:bg-page focus:opacity-100 group-hover:opacity-100 disabled:hidden"
                >
                  <RotateCcw className="size-3.5" />
                  Post again
                </button>
              </li>
            );
          }
          if (clip.scheduledFor && !clip.posted) {
            return (
              <li key={clip.id} className="flex flex-col gap-1 bg-page/60 px-6 py-4">
                <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-emerald-700">
                  <CalendarCheck className="size-3.5" />
                  Scheduled from {slotFormat.format(new Date(clip.scheduledFor))}
                </p>
                <p className="text-sm font-medium text-heading">{title}</p>
              </li>
            );
          }
          const row = rowsNow[clip.id];
          const at = easternToUtc(row.date, row.time);
          const postNowIssues = rowIssues(row, true);
          const again = reposting.has(clip.id);
          return (
            <li key={clip.id} className={`flex flex-col gap-3 px-6 py-4 ${again ? "bg-primary-tint/40" : ""}`}>
              {again && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-primary-tint px-2 py-0.5 font-medium text-primary">Posting again</span>
                  <span className="text-muted">Already posted. Post it now or schedule it on its own; it isn&apos;t part of the batch.</span>
                  <button type="button" onClick={() => keepPosted(clip)} disabled={pending} className="ml-auto font-medium text-muted hover:text-body hover:underline">
                    Keep as posted
                  </button>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  aria-label={`Date for ${clip.title}`}
                  value={row.date}
                  min={minDate}
                  disabled={pending}
                  onChange={(e) => update(clip.id, { date: e.target.value })}
                  className="rounded-lg border border-line px-2.5 py-1.5 text-sm"
                />
                <input
                  type="time"
                  aria-label={`Time for ${clip.title}, Eastern`}
                  value={row.time}
                  step={300}
                  disabled={pending}
                  onChange={(e) => update(clip.id, { time: e.target.value })}
                  className="rounded-lg border border-line px-2.5 py-1.5 text-sm"
                />
                <span className="text-sm text-muted">
                  ET{at ? ` · ${localTimeLabel(at)}` : ""}
                </span>
                <button
                  type="button"
                  onClick={() => send([clip], true)}
                  disabled={pending || blocked || postNowIssues.length > 0 || Boolean(clip.render && !clip.headline)}
                  title={postNowIssues.join(" ") || "Publish this clip now instead of scheduling it"}
                  className="ml-auto flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-body hover:bg-page disabled:cursor-not-allowed disabled:text-muted"
                >
                  <Send className="size-3.5" />
                  Post now
                </button>
                {again && (
                  <button
                    type="button"
                    onClick={() => send([clip], false)}
                    disabled={pending || blocked || rowIssues(row, false).length > 0 || Boolean(clip.render && !clip.headline)}
                    title={rowIssues(row, false).join(" ") || "Schedule this clip again for the date and time above"}
                    className="flex items-center gap-1.5 rounded-lg border border-primary px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary-tint disabled:cursor-not-allowed disabled:border-line disabled:text-muted"
                  >
                    <CalendarClock className="size-3.5" />
                    Schedule this clip
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-4 text-sm">
                {PLATFORMS.map((p) => (
                  <label key={p} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={row.platforms.includes(p)}
                      disabled={pending}
                      onChange={(e) =>
                        update(clip.id, {
                          platforms: e.target.checked ? PLATFORMS.filter((x) => x === p || row.platforms.includes(x)) : row.platforms.filter((x) => x !== p),
                        })
                      }
                    />
                    {PLATFORM_LABELS[p]}
                  </label>
                ))}
                <span className="text-xs text-muted">
                  Headline: <span className="font-medium text-body">{clip.headline ?? "missing"}</span>
                </span>
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Caption, posted to all platforms</span>
                <textarea
                  value={row.caption}
                  rows={5}
                  disabled={pending}
                  placeholder="Use Write captions above, or type one: the factual title, 1 to 2 lines of context, then 3 to 5 hashtags."
                  onChange={(e) => update(clip.id, { caption: e.target.value })}
                  className={`${field} resize-y`}
                />
                <span className={`text-xs ${firstLine(row.caption).length > TITLE_MAX ? "text-red-600" : "text-muted"}`}>
                  First line (the YouTube title): {firstLine(row.caption).length}/{TITLE_MAX} characters
                </span>
              </label>
              {rowIssues(row, false).length > 0 && <p className="text-xs text-red-600">{rowIssues(row, false).join(" ")}</p>}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-col gap-3 border-t border-line px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
        <p role="status" className={`whitespace-pre-line text-sm ${result && !result.ok ? "text-red-600" : "text-muted"}`}>
          {result?.message ?? "Nothing is posted until you confirm."}
        </p>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button type="button" onClick={() => dialog.current?.close()} className="rounded-lg border border-line px-4 py-2.5 text-sm font-medium hover:bg-page">
            {open.length === 0 ? "Close" : "Cancel"}
          </button>
          {open.length > 0 && (
            <>
              <button
                type="button"
                onClick={saveForLater}
                disabled={pending}
                className="flex items-center gap-2 rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-body hover:bg-page disabled:cursor-not-allowed disabled:text-muted"
              >
                <Bookmark className="size-4" />
                Save picks for later
              </button>
              <button
                type="button"
                onClick={() => send([open[0]], false)}
                disabled={pending || blocked || missingHeadline.length > 0 || rowIssues(rowsNow[open[0].id], false).length > 0}
                className="flex items-center gap-2 rounded-lg border border-primary px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary-tint disabled:cursor-not-allowed disabled:border-line disabled:text-muted"
              >
                <FlaskConical className="size-4" />
                Test with 1 clip
              </button>
              <button
                type="button"
                onClick={() => send(open, false)}
                disabled={pending || blocked || missingHeadline.length > 0 || scheduleIssues.length > 0}
                title={scheduleIssues.join("\n")}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
              >
                <CalendarClock className="size-4" />
                {pending ? "Working" : `Schedule ${open.length === picks.length ? "all" : "the other"} ${open.length}`}
              </button>
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
