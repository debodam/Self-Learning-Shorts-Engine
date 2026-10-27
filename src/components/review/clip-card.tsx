"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, Loader2, Play, Type } from "lucide-react";
import { setHeadline } from "@/app/review/actions";
import {
  formatLabels,
  MAX_TOTAL_SCORE,
  rubricCategories,
  rubricLabels,
  totalScore,
  type CandidateClip,
} from "@/lib/clips";

const scheduledDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

function formatDuration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Without onToggle the card is read-only, for clips that can't be picked this week. */
export function ClipCard({
  clip,
  approved = false,
  busy = false,
  onToggle,
}: {
  clip: CandidateClip;
  /** One of the week's picks. */
  approved?: boolean;
  /** A pick change is saving. */
  busy?: boolean;
  onToggle?: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  const previewUrl = clip.opus?.previewUrl;
  const thumbnailUrl = clip.opus?.thumbnailUrl ?? undefined;

  return (
    <article
      className={`flex flex-col overflow-hidden rounded-card border bg-surface transition-colors ${
        approved ? "border-primary ring-1 ring-primary" : "border-line"
      }`}
    >
      <div className="relative flex aspect-video items-center justify-center bg-gradient-to-br from-primary-tint to-page">
        {playing && previewUrl ? (
          // Opus serves previews with Content-Disposition: attachment, so a link would download
          // the file. A video element plays it inline regardless.
          <video
            src={previewUrl}
            poster={thumbnailUrl}
            controls
            autoPlay
            playsInline
            className="absolute inset-0 size-full bg-heading object-contain"
          />
        ) : (
          <>
            {thumbnailUrl && (
              // Signed, short-lived Opus URL, so next/image's optimizer would only cache an expiring link.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumbnailUrl} alt="" loading="lazy" className="absolute inset-0 size-full object-contain" />
            )}
            {previewUrl ? (
              <button
                type="button"
                onClick={() => setPlaying(true)}
                aria-label={`Play ${clip.title}`}
                className="absolute inset-0 flex items-center justify-center"
              >
                <span className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-110">
                  <Play className="ml-0.5 size-4" fill="currentColor" />
                </span>
              </button>
            ) : (
              <span className="relative flex size-10 items-center justify-center rounded-full bg-primary/40 text-primary-foreground">
                <Play className="ml-0.5 size-4" fill="currentColor" />
              </span>
            )}
          </>
        )}
        {!playing && clip.durationSeconds !== null && (
          <span className="pointer-events-none absolute bottom-2 right-2 rounded bg-heading/75 px-1.5 py-0.5 text-xs font-medium text-white">
            {formatDuration(clip.durationSeconds)}
          </span>
        )}
        {!playing && (
          <span className="pointer-events-none absolute left-2 top-2 flex gap-1">
            <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-body">{formatLabels[clip.format]}</span>
            {clip.posted && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Posted</span>}
            {clip.picked && !clip.scheduledFor && !clip.posted && (
              <span className="rounded-full bg-primary-tint px-2 py-0.5 text-xs font-medium text-primary">
                {clip.readyToSchedule ? "Ready to schedule" : "Top 7"}
              </span>
            )}
            {clip.scheduledFor && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                Scheduled {scheduledDate.format(new Date(clip.scheduledFor))}
              </span>
            )}
            {clip.headline && (
              <span title={`Headline: ${clip.headline}`} className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                Headline ✓
              </span>
            )}
            {clip.cut && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Cut</span>}
          </span>
        )}
        {/* Reference only: ranking and cuts use the rubric, never this. */}
        {!playing && clip.opus?.opusScore != null && (
          <span
            title="OpusClip's own score, for reference. Not used for ranking or cuts."
            className="absolute right-2 top-2 rounded-full bg-surface/90 px-2 py-0.5 text-[11px] text-muted"
          >
            Opus {clip.opus.opusScore}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-4 p-4">
        <div>
          <h2 className="font-semibold leading-snug text-heading">{clip.title}</h2>
          <p className="mt-1 truncate text-sm text-muted" title={clip.sourceVideo}>
            {clip.sourceVideo}
          </p>
          {clip.opus && (
            <a
              href={clip.opus.editorUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              Open in OpusClip
              <ExternalLink className="size-3.5" />
            </a>
          )}
        </div>

        {clip.render && <HeadlineEditor clip={clip} />}

        {(clip.suggestedTitle || clip.reason || clip.cutReason) && (
          <dl className="space-y-2 rounded-md bg-page px-3 py-2.5 text-sm">
            {clip.cutReason && (
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">Cut</dt>
                <dd className="font-medium text-red-700">{clip.cutReason}</dd>
              </div>
            )}
            {clip.suggestedTitle && (
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">Suggested title</dt>
                <dd className="font-medium text-heading">{clip.suggestedTitle}</dd>
              </div>
            )}
            {clip.reason && (
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">Why</dt>
                <dd className="text-body">{clip.reason}</dd>
              </div>
            )}
          </dl>
        )}

        {clip.vision && (
          <p className="text-xs text-muted">
            Face in {clip.vision.faceFrames} of {clip.vision.framesChecked} frames
            {" \u00b7 "}
            {clip.vision.peopleCount === 1 ? "1 person" : `${clip.vision.peopleCount} people`}
            {" \u00b7 "}
            {clip.vision.textReadable ? "text readable" : "text too small on a phone"}
          </p>
        )}

        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">
              Rubric
            </span>
            {clip.scores && (
              <span className="text-sm font-semibold text-primary">
                {totalScore(clip.scores)}/{MAX_TOTAL_SCORE}
              </span>
            )}
          </div>
          {clip.scores ? (
            <dl className="grid grid-cols-5 gap-1.5 text-center">
              {rubricCategories.map((category) => (
                <div key={category} className="flex flex-col-reverse rounded-md bg-page py-1.5">
                  <dt className="text-[11px] text-muted">{rubricLabels[category]}</dt>
                  <dd className="text-sm font-semibold text-heading">
                    {clip.scores![category]}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-muted">Not scored yet</p>
          )}
        </div>

        {/* Predicted views are hidden until real YouTube results are in Supabase (Phase 3). */}

        {onToggle && (
          <label className="mt-auto flex cursor-pointer items-center justify-between border-t border-line pt-3">
            <span className={`text-sm font-medium ${approved ? "text-primary" : "text-body"}`}>
              {busy ? "Saving" : approved ? "Selected for this week" : "Select for this week"}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={approved}
              aria-label={`Select ${clip.title} for this week`}
              disabled={busy}
              onClick={onToggle}
              className={`relative h-6 w-11 rounded-full transition-colors ${
                approved ? "bg-primary" : "bg-line"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                  approved ? "translate-x-5" : ""
                }`}
              />
            </button>
          </label>
        )}
      </div>
    </article>
  );
}

/**
 * A pick's headline (title card), edited here and burned into the video by Opus. While
 * Opus re-renders, the card refreshes itself until the new preview is ready.
 */
function HeadlineEditor({ clip }: { clip: CandidateClip }) {
  const router = useRouter();
  const saved = clip.headline ?? "";
  const [text, setText] = useState(saved || clip.suggestedTitle || clip.title);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const render = clip.render!;
  const locked = render.headlineSource === "opus";

  // Poll while Opus renders, so the baked-in preview appears without a manual reload.
  useEffect(() => {
    if (!render.rendering) return;
    const timer = setInterval(() => router.refresh(), 8000);
    return () => clearInterval(timer);
  }, [render.rendering, router]);

  function save() {
    setResult(null);
    startTransition(async () => {
      const r = await setHeadline(clip.id, text);
      setResult({ ok: r.ok, text: r.message });
    });
  }

  let status: React.ReactNode;
  // Right after a save, Opus may not report the render yet, so trust the save until it does.
  const justSaved = result?.ok && saved !== text.replace(/\s+/g, " ").trim();
  if (render.rendering || justSaved) {
    status = (
      <span className="flex items-center gap-1.5 text-primary">
        <Loader2 className="size-3.5 animate-spin" />
        Opus is rendering the clip with this headline.
      </span>
    );
  } else if (saved && render.exportCurrent) {
    status = (
      <span className="flex items-center gap-1.5 text-emerald-700">
        <CheckCircle2 className="size-3.5" />
        Headline is in the video that gets posted.
      </span>
    );
  } else if (!saved) {
    status = "No headline yet, so this clip can't be scheduled. Add one here or use Add missing headlines.";
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line px-3 py-2.5 text-sm">
      <label className="flex flex-col gap-1">
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
          <Type className="size-3.5" />
          Headline on the video
        </span>
        <div className="flex gap-2">
          <input
            value={text}
            disabled={pending || locked}
            onChange={(e) => setText(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-line px-2.5 py-1.5 text-sm font-medium text-heading disabled:bg-page"
          />
          {!locked && (
            <button
              type="button"
              onClick={save}
              disabled={pending || !text.trim() || text.trim() === saved}
              className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
            >
              {pending ? "Saving" : saved ? "Update" : "Add"}
            </button>
          )}
        </div>
      </label>
      <p className={`text-xs ${result && !result.ok ? "text-red-600" : "text-muted"}`}>
        {result && !result.ok
          ? result.text
          : locked
            ? "Opus generated this headline in a way its API can't edit, so it's kept as is."
            : status}
      </p>
    </div>
  );
}
