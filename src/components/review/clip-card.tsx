"use client";

import { useState } from "react";
import { ExternalLink, Play } from "lucide-react";
import {
  formatLabels,
  MAX_TOTAL_SCORE,
  rubricCategories,
  rubricLabels,
  totalScore,
  type CandidateClip,
} from "@/lib/clips";

function formatDuration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Without onToggle the card is read-only, for clips that can't be approved. */
export function ClipCard({
  clip,
  approved = false,
  onToggle,
}: {
  clip: CandidateClip;
  approved?: boolean;
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
            {clip.shortlisted && (
              <span className="rounded-full bg-primary-tint px-2 py-0.5 text-xs font-medium text-primary">Shortlist</span>
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
              {approved ? "Approved" : "Approve"}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={approved}
              aria-label={`Approve ${clip.title}`}
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
