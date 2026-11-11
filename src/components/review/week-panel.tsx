"use client";

import { useState, useTransition } from "react";
import { CalendarPlus, RefreshCw } from "lucide-react";
import { checkWeekStatus, createVideoUpload, startNewWeek, type SyncFromOpusResult } from "@/app/review/actions";
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

/** Starts a week from 2 videos (YouTube links or uploaded files) and tracks its Opus projects until the clips are in. */
export function WeekPanel({ currentWeek, mockOpus }: { currentWeek: Week | null; mockOpus: boolean }) {
  const [slots, setSlots] = useState<SlotState[]>([emptySlot(), emptySlot()]);
  const [result, setResult] = useState<SyncFromOpusResult | null>(null);
  const [running, setRunning] = useState<"start" | "check" | null>(null);
  const [pending, startTransition] = useTransition();

  const allReady = currentWeek?.videos.length && currentWeek.videos.every((v) => v.status === "ready" || v.status === "failed");
  const updateSlot = (i: number) => (update: (s: SlotState) => SlotState) => setSlots((prev) => prev.map((s, j) => (j === i ? update(s) : s)));
  const ready = slots.every(slotReady);
  const uploading = slots.some((s) => s.upload.state === "uploading" || s.upload.state === "starting");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    const lines = slots.map((s, i) => `${i + 1}. ${s.mode === "youtube" ? s.link.trim() : `"${s.title.trim()}" (uploaded file)`}`).join("\n");
    const confirmed = window.confirm(
      mockOpus
        ? `Opus is in mock mode (OPUSCLIP_MOCK=true): this creates a test week with mock clips and spends no credits.\n\n${lines}\n\nContinue?`
        : `This submits both videos to OpusClip with the Aced template and spends Opus credits (about 1 credit per minute of video).\n\n${lines}\n\nContinue?`,
    );
    if (!confirmed) return;
    const videos = slots.map((s) =>
      s.mode === "youtube"
        ? { kind: "youtube" as const, url: s.link.trim() }
        : { kind: "upload" as const, uploadId: (s.upload as { uploadId: string }).uploadId, title: s.title.trim(), fileName: s.fileName },
    );
    run("start", async () => {
      const r = await startNewWeek(videos);
      if (r.ok) setSlots([emptySlot(), emptySlot()]);
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
              Add this week&apos;s 2 Aced videos, as YouTube links or uploaded MP4 or MOV files. They go to OpusClip with the Aced template.
              {mockOpus && " Opus is in mock mode, so no credits are spent."}
            </p>
          </div>
          {slots.map((slot, i) => (
            <VideoSlot key={i} index={i} slot={slot} update={updateSlot(i)} disabled={pending} />
          ))}
          <button type="submit" disabled={pending || !ready || uploading} className={`${button} self-start bg-primary text-primary-foreground hover:bg-primary-hover`}>
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
                    {video.youtubeUrl ? (
                      <a href={video.youtubeUrl} target="_blank" rel="noreferrer" className="min-w-0 truncate text-body hover:underline" title={video.title}>
                        {video.title}
                      </a>
                    ) : (
                      <span className="min-w-0 truncate text-body" title={`${video.title} (uploaded file)`}>
                        {video.title}
                      </span>
                    )}
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

// Video slots: a YouTube link or an uploaded file -------------------------------------

type UploadState =
  | { state: "idle" }
  | { state: "starting" }
  | { state: "uploading"; progress: number }
  | { state: "done"; uploadId: string }
  | { state: "error"; message: string };

type SlotState = { mode: "youtube" | "upload"; link: string; fileName: string; fileSize: number; title: string; upload: UploadState };

const emptySlot = (): SlotState => ({ mode: "youtube", link: "", fileName: "", fileSize: 0, title: "", upload: { state: "idle" } });

const slotReady = (s: SlotState) => (s.mode === "youtube" ? Boolean(s.link.trim()) : s.upload.state === "done" && Boolean(s.title.trim()));

const ACCEPTED = /\.(mp4|mov)$/i;
const titleFromFile = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
const sizeLabel = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`);

/** In-flight uploads by slot, so Cancel can stop them. Lives outside React state on purpose. */
const inflight = new Map<number, { xhr: XMLHttpRequest | null; timer: ReturnType<typeof setInterval> | null; uploadUrl: string | null; cancelled: boolean }>();

function VideoSlot({ index, slot, update, disabled }: { index: number; slot: SlotState; update: (fn: (s: SlotState) => SlotState) => void; disabled: boolean }) {
  const label = `Video ${index + 1}`;
  const busy = slot.upload.state === "starting" || slot.upload.state === "uploading";

  async function upload(file: File) {
    if (!ACCEPTED.test(file.name)) {
      update((s) => ({ ...s, upload: { state: "error", message: "Choose an MP4 or MOV file." } }));
      return;
    }
    update((s) => ({ ...s, fileName: file.name, fileSize: file.size, title: titleFromFile(file.name), upload: { state: "starting" } }));
    const job = { xhr: null as XMLHttpRequest | null, timer: null as ReturnType<typeof setInterval> | null, uploadUrl: null as string | null, cancelled: false };
    inflight.set(index, job);

    const session = await createVideoUpload();
    if (job.cancelled) return;
    if (!session.ok) {
      update((s) => ({ ...s, upload: { state: "error", message: session.message } }));
      return;
    }
    job.uploadUrl = session.uploadUrl;

    // Mock mode has nowhere to upload to, so it only plays the progress bar.
    if (!session.uploadUrl) {
      let progress = 0;
      job.timer = setInterval(() => {
        progress = Math.min(1, progress + 0.1);
        update((s) => ({ ...s, upload: progress >= 1 ? { state: "done", uploadId: session.uploadId } : { state: "uploading", progress } }));
        if (progress >= 1 && job.timer) clearInterval(job.timer);
      }, 150);
      return;
    }

    // Straight from the browser to OpusClip's storage: the file never touches our server.
    const xhr = new XMLHttpRequest();
    job.xhr = xhr;
    xhr.open("PUT", session.uploadUrl);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) update((s) => ({ ...s, upload: { state: "uploading", progress: e.loaded / e.total } }));
    };
    xhr.onload = () => {
      inflight.delete(index);
      update((s) => ({
        ...s,
        upload: xhr.status >= 200 && xhr.status < 300 ? { state: "done", uploadId: session.uploadId } : { state: "error", message: `The upload failed (${xhr.status}). Try again.` },
      }));
    };
    xhr.onerror = () => {
      inflight.delete(index);
      update((s) => ({ ...s, upload: { state: "error", message: "The upload failed. Check your connection and try again." } }));
    };
    update((s) => ({ ...s, upload: { state: "uploading", progress: 0 } }));
    xhr.send(file);
  }

  function cancel() {
    const job = inflight.get(index);
    if (job) {
      job.cancelled = true;
      job.xhr?.abort();
      if (job.timer) clearInterval(job.timer);
      // Tell storage to drop the partial upload. Best effort: it expires on its own anyway.
      if (job.uploadUrl) fetch(job.uploadUrl, { method: "DELETE" }).catch(() => {});
      inflight.delete(index);
    }
    update((s) => ({ ...s, fileName: "", fileSize: 0, title: "", upload: { state: "idle" } }));
  }

  return (
    <fieldset className="flex flex-col gap-2 rounded-lg border border-line p-3" disabled={disabled}>
      <div className="flex items-center justify-between gap-3">
        <legend className="text-sm font-medium text-heading">{label}</legend>
        <div role="group" aria-label={`${label} source`} className="flex rounded-lg border border-line bg-surface p-0.5 text-xs">
          {(["youtube", "upload"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={slot.mode === mode}
              disabled={busy}
              onClick={() => update((s) => ({ ...s, mode }))}
              className={`rounded-md px-2.5 py-1 transition-colors ${slot.mode === mode ? "bg-primary-tint font-medium text-primary" : "text-body hover:bg-page"}`}
            >
              {mode === "youtube" ? "YouTube link" : "Upload file"}
            </button>
          ))}
        </div>
      </div>

      {slot.mode === "youtube" ? (
        <label>
          <span className="sr-only">{label} YouTube link</span>
          <input
            type="url"
            value={slot.link}
            onChange={(e) => update((s) => ({ ...s, link: e.target.value }))}
            placeholder="https://www.youtube.com/watch?v=..."
            className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-body"
          />
        </label>
      ) : (
        <div className="flex flex-col gap-2">
          {slot.upload.state === "idle" || slot.upload.state === "error" ? (
            <label className="flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-line bg-page px-3 py-3 text-sm text-body hover:border-primary">
              <input
                type="file"
                accept="video/mp4,video/quicktime,.mp4,.mov"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void upload(file);
                }}
              />
              Choose an MP4 or MOV file
            </label>
          ) : (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-body" title={slot.fileName}>
                  {slot.fileName} <span className="text-muted">({sizeLabel(slot.fileSize)})</span>
                </span>
                {busy ? (
                  <button type="button" onClick={cancel} className="shrink-0 text-sm font-medium text-red-600 hover:underline">
                    Cancel
                  </button>
                ) : (
                  <button type="button" onClick={cancel} className="shrink-0 text-sm font-medium text-primary hover:underline">
                    Replace
                  </button>
                )}
              </div>
              <div
                role="progressbar"
                aria-label={`${label} upload`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round((slot.upload.state === "uploading" ? slot.upload.progress : slot.upload.state === "done" ? 1 : 0) * 100)}
                className="h-2 overflow-hidden rounded-full bg-page"
              >
                <div
                  className={`h-full rounded-full transition-[width] ${slot.upload.state === "done" ? "bg-emerald-500" : "bg-primary"}`}
                  style={{ width: `${(slot.upload.state === "uploading" ? slot.upload.progress : slot.upload.state === "done" ? 1 : 0.02) * 100}%` }}
                />
              </div>
              <p className="text-xs text-muted">
                {slot.upload.state === "starting"
                  ? "Starting the upload"
                  : slot.upload.state === "uploading"
                    ? `Uploading to OpusClip: ${Math.round(slot.upload.progress * 100)}%`
                    : "Uploaded to OpusClip. Nothing is submitted or charged until you click Submit."}
              </p>
            </div>
          )}
          {slot.upload.state === "error" && <p className="text-xs text-red-600">{slot.upload.message}</p>}
          {slot.upload.state !== "idle" && slot.upload.state !== "error" && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted">Video title</span>
              <input
                type="text"
                value={slot.title}
                maxLength={200}
                onChange={(e) => update((s) => ({ ...s, title: e.target.value }))}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-body"
              />
            </label>
          )}
        </div>
      )}
    </fieldset>
  );
}
