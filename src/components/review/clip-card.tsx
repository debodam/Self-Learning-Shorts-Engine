import { ExternalLink, Play } from "lucide-react";
import {
  formatLabels,
  MAX_TOTAL_SCORE,
  rubricCategories,
  rubricLabels,
  totalScore,
  type CandidateClip,
} from "@/lib/clips";

const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatDuration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Without onToggle the card is read-only, for clips that can't be approved yet. */
export function ClipCard({
  clip,
  approved = false,
  onToggle,
}: {
  clip: CandidateClip;
  approved?: boolean;
  onToggle?: () => void;
}) {
  const previewUrl = clip.opus?.previewUrl;
  const thumbnail = (
    <>
      {clip.opus?.thumbnailUrl && (
        // Signed, short-lived Opus URL, so next/image's optimizer would only cache an expiring link.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={clip.opus.thumbnailUrl} alt="" loading="lazy" className="absolute inset-0 size-full object-contain" />
      )}
      <span className="relative flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Play className="ml-0.5 size-4" fill="currentColor" />
      </span>
    </>
  );

  return (
    <article
      className={`flex flex-col overflow-hidden rounded-card border bg-surface transition-colors ${
        approved ? "border-primary ring-1 ring-primary" : "border-line"
      }`}
    >
      <div className="relative flex aspect-video items-center justify-center bg-gradient-to-br from-primary-tint to-page">
        {previewUrl ? (
          <a
            href={previewUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Preview ${clip.title}`}
            className="absolute inset-0 flex items-center justify-center"
          >
            {thumbnail}
          </a>
        ) : (
          thumbnail
        )}
        {clip.durationSeconds !== null && (
          <span className="pointer-events-none absolute bottom-2 right-2 rounded bg-heading/75 px-1.5 py-0.5 text-xs font-medium text-white">
            {formatDuration(clip.durationSeconds)}
          </span>
        )}
        <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-body">
          {formatLabels[clip.format]}
        </span>
        {clip.opus?.opusScore != null && (
          <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-body">
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
              href={clip.opus.projectUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              Open in OpusClip
              <ExternalLink className="size-3.5" />
            </a>
          )}
        </div>

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

        {/* MVP is YouTube only, so only the YouTube prediction is shown. */}
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">
            Predicted YouTube views, 7 days
          </span>
          <span className={`text-sm ${clip.predictedViews ? "font-semibold text-heading" : "text-muted"}`}>
            {clip.predictedViews ? compactNumber.format(clip.predictedViews.youtube) : "Not yet"}
          </span>
        </div>

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
