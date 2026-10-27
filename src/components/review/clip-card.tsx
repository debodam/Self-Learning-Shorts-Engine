import { Play } from "lucide-react";
import {
  formatLabels,
  MAX_TOTAL_SCORE,
  platformLabels,
  rubricCategories,
  rubricLabels,
  totalScore,
  type CandidateClip,
  type Platform,
} from "@/lib/clips";

const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatDuration(seconds: number) {
  return `0:${String(seconds).padStart(2, "0")}`;
}

export function ClipCard({
  clip,
  approved,
  onToggle,
}: {
  clip: CandidateClip;
  approved: boolean;
  onToggle: () => void;
}) {
  return (
    <article
      className={`flex flex-col overflow-hidden rounded-card border bg-surface transition-colors ${
        approved ? "border-primary ring-1 ring-primary" : "border-line"
      }`}
    >
      <div className="relative flex aspect-video items-center justify-center bg-gradient-to-br from-primary-tint to-page">
        <span className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Play className="ml-0.5 size-4" fill="currentColor" />
        </span>
        {clip.durationSeconds !== null && (
          <span className="absolute bottom-2 right-2 rounded bg-heading/75 px-1.5 py-0.5 text-xs font-medium text-white">
            {formatDuration(clip.durationSeconds)}
          </span>
        )}
        <span className="absolute left-2 top-2 rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-body">
          {formatLabels[clip.format]}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-4">
        <div>
          <h2 className="font-semibold leading-snug text-heading">{clip.title}</h2>
          <p className="mt-1 truncate text-sm text-muted" title={clip.sourceVideo}>
            {clip.sourceVideo}
          </p>
        </div>

        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">
              Rubric
            </span>
            <span className="text-sm font-semibold text-primary">
              {totalScore(clip)}/{MAX_TOTAL_SCORE}
            </span>
          </div>
          <dl className="grid grid-cols-5 gap-1.5 text-center">
            {rubricCategories.map((category) => (
              <div key={category} className="flex flex-col-reverse rounded-md bg-page py-1.5">
                <dt className="text-[11px] text-muted">{rubricLabels[category]}</dt>
                <dd className="text-sm font-semibold text-heading">
                  {clip.scores[category]}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-muted">
            Predicted views, 7 days
          </span>
          {clip.predictedViews ? (
            <dl className="mt-2 grid grid-cols-3 gap-1.5">
              {(Object.keys(platformLabels) as Platform[]).map((platform) => (
                <div key={platform}>
                  <dt className="text-[11px] text-muted">{platformLabels[platform]}</dt>
                  <dd className="text-sm font-semibold text-heading">
                    {compactNumber.format(clip.predictedViews![platform])}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-2 text-sm text-muted">Not predicted yet</p>
          )}
        </div>

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
      </div>
    </article>
  );
}
