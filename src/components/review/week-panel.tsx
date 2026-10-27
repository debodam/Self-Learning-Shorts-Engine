"use client";

import { useState, useTransition } from "react";
import { CalendarPlus, RefreshCw } from "lucide-react";
import { checkWeekStatus, startNewWeek, type SyncFromOpusResult } from "@/app/review/actions";
import type { Week } from "@/lib/db";

const statusStyles: Record<string, { label: string; className: string }> = {
  submitted: { label: "Submitted", className: "bg-page text-body" },
  processing: { label: "Processing", className: "bg-amber-50 text-amber-700" },
  ready: { label: "Ready", className: "bg-emerald-50 text-emerald-700" },
  failed: { label: "Failed", className: "bg-red-50 text-red-700" },
};

const weekLabel = (startsOn: string) =>
  `Week of ${new Date(`${startsOn}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;

const button =
  "flex shrink-0 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:bg-line disabled:text-muted";

/** Starts a week from 2 YouTube links and tracks its Opus projects until the clips are in. */
export function WeekPanel({ currentWeek, mockOpus }: { currentWeek: Week | null; mockOpus: boolean }) {
  const [links, setLinks] = useState(["", ""]);
  const [result, setResult] = useState<SyncFromOpusResult | null>(null);
  const [running, setRunning] = useState<"start" | "check" | null>(null);
  const [pending, startTransition] = useTransition();

  const allReady = currentWeek?.videos.length && currentWeek.videos.every((v) => v.status === "ready" || v.status === "failed");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const confirmed = window.confirm(
      mockOpus
        ? "Opus is in mock mode (OPUSCLIP_MOCK=true): this creates a test week with mock clips and spends no credits. Continue?"
        : "This submits both videos to OpusClip with the Aced template and spends Opus credits (about 1 credit per minute of video). Continue?",
    );
    if (!confirmed) return;
    run("start", async () => {
      const r = await startNewWeek(links);
      if (r.ok) setLinks(["", ""]);
      return r;
    });
  }

  function run(kind: "start" | "check", action: () => Promise<SyncFromOpusResult>) {
    setResult(null);
    setRunning(kind);
    startTransition(async () => {
      setResult(await action());
      setRunning(null);
    });
  }

  return (
    <section className="mb-6 rounded-card border border-line bg-surface">
      <div className="grid gap-6 p-5 lg:grid-cols-2">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <h2 className="font-semibold text-heading">Start new week</h2>
            <p className="text-sm text-muted">
              Paste this week&apos;s 2 Aced YouTube videos. They go to OpusClip with the Aced template.
              {mockOpus && " Opus is in mock mode, so no credits are spent."}
            </p>
          </div>
          {links.map((link, i) => (
            <label key={i}>
              <span className="sr-only">YouTube link {i + 1}</span>
              <input
                type="url"
                required
                value={link}
                onChange={(e) => setLinks((prev) => prev.map((l, j) => (j === i ? e.target.value : l)))}
                placeholder={`YouTube link ${i + 1}`}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-body"
              />
            </label>
          ))}
          <button type="submit" disabled={pending || links.some((l) => !l.trim())} className={`${button} self-start bg-primary text-primary-foreground hover:bg-primary-hover`}>
            <CalendarPlus className="size-4" />
            {running === "start" ? "Submitting" : "Submit to OpusClip"}
          </button>
        </form>

        <div className="flex flex-col gap-3 border-t border-line pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-heading">{currentWeek ? weekLabel(currentWeek.startsOn) : "No week yet"}</h2>
              <p className="text-sm text-muted">
                {!currentWeek
                  ? "Submit 2 videos to start the first week."
                  : allReady
                    ? "Clips are synced and scored. The top 7 are below."
                    : "When Opus finishes, Check status syncs and scores the clips."}
              </p>
            </div>
            {currentWeek && (
              <button
                type="button"
                onClick={() => run("check", () => checkWeekStatus(currentWeek.id))}
                disabled={pending}
                className={`${button} border border-line bg-surface text-body hover:bg-page`}
              >
                <RefreshCw className={`size-4 ${running === "check" ? "animate-spin" : ""}`} />
                {running === "check" ? "Checking" : "Check status"}
              </button>
            )}
          </div>
          {currentWeek && (
            <ul className="flex flex-col gap-2">
              {currentWeek.videos.map((video) => {
                const status = statusStyles[video.status ?? "submitted"] ?? statusStyles.submitted;
                return (
                  <li key={video.id} className="flex items-center justify-between gap-3 rounded-md bg-page px-3 py-2 text-sm">
                    <a href={video.youtubeUrl} target="_blank" rel="noreferrer" className="min-w-0 truncate text-body hover:underline" title={video.title}>
                      {video.title}
                    </a>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>{status.label}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      {result && (
        <p role="status" className={`border-t border-line px-5 py-3 text-sm ${result.ok ? "text-muted" : "text-red-600"}`}>
          {result.message}
        </p>
      )}
    </section>
  );
}
