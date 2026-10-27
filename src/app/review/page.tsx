import { cache, Suspense } from "react";
import { connection } from "next/server";
import { Clapperboard } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { LoadingCard } from "@/components/loading-card";
import { PageHeader } from "@/components/page-header";
import { OpusSync, type OpusProjectOption } from "@/components/review/opus-sync";
import { ReviewBoard } from "@/components/review/review-board";
import { ScoreClips } from "@/components/review/score-clips";
import { WeekPanel } from "@/components/review/week-panel";
import { getLastScoringRunSummary, getReviewClips, getSyncedOpusProjectIds, getWeeks } from "@/lib/db";
import { isIntegrationConnected, isOpusMockForced } from "@/lib/integrations/config";
import { listProjects } from "@/lib/integrations/opus";
import { PICKS_PER_WEEK, postingSlots, schedulingLive } from "@/lib/weeks";

// Scoring every synced clip can take a few minutes, and server actions share the page's limit.
export const maxDuration = 300;

export default function ReviewPage() {
  return (
    <>
      <PageHeader
        title="Review"
        description="Start the week, review the top 7 picks, swap any, and schedule one per day."
        actions={
          <Suspense fallback={<span className="h-10 w-full animate-pulse rounded-lg bg-surface sm:w-96" />}>
            <OpusSyncControl />
          </Suspense>
        }
      />
      <Suspense fallback={<LoadingCard className="h-96" />}>
        <CandidateClips />
      </Suspense>
    </>
  );
}

const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

async function OpusSyncControl() {
  await connection();
  if (isOpusMockForced()) return <p className="text-sm text-muted">Opus is in mock mode, so syncing a single project is off.</p>;
  if (!isIntegrationConnected("opus") || !isIntegrationConnected("supabase")) {
    return <p className="text-sm text-muted">Connect OpusClip and Supabase in Settings to sync clips.</p>;
  }

  const options = await loadProjectOptions().catch((error) => {
    console.error("Couldn't load Opus projects:", error);
    return null;
  });
  if (!options) {
    return <p className="text-sm text-red-600">Couldn&apos;t load Opus projects. Check the OpusClip key in Settings.</p>;
  }
  return <OpusSync projects={options} />;
}

/** The Opus projects for the Sync dropdown and the batch filter. Cached per request. */
const loadProjectOptions = cache(async (): Promise<OpusProjectOption[]> => {
  const [projects, synced] = await Promise.all([listProjects(), getSyncedOpusProjectIds()]);
  // The same video can be clipped more than once, so the date tells duplicate titles apart.
  return projects.map((p) => {
    const details = [
      p.createdAt && shortDate.format(new Date(p.createdAt)),
      p.clipCount !== null && `${p.clipCount} clips`,
      p.stage && p.stage !== "COMPLETE" && "processing",
      synced.has(p.id) && "synced",
    ].filter(Boolean);
    return { id: p.id, label: `${p.title ?? p.id} (${details.join(", ")})` };
  });
});

const runDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/New_York",
});

const weekLabel = (startsOn: string) =>
  `Week of ${new Date(`${startsOn}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;

async function CandidateClips() {
  const [{ clips, scoredCount, unscoredCount }, lastRun, batches, weeks] = await Promise.all([
    getReviewClips(),
    getLastScoringRunSummary(),
    loadProjectOptions().catch(() => []),
    getWeeks(),
  ]);
  const supabase = isIntegrationConnected("supabase");
  const weekPanel = supabase && <WeekPanel currentWeek={weeks[0] ?? null} mockOpus={isOpusMockForced()} />;
  if (clips.length === 0) {
    return (
      <>
        {weekPanel}
        <EmptyState icon={Clapperboard} title="No candidate clips yet">
          Start a week above, or sync clips from an Opus project. Scored clips show up here for review.
        </EmptyState>
      </>
    );
  }

  const lastRunText =
    lastRun &&
    `Last run ${runDate.format(new Date(lastRun.finishedAt))} ET ${lastRun.scored + lastRun.failed === scoredCount + unscoredCount ? "covered every clip" : `covered ${lastRun.scored + lastRun.failed} of ${scoredCount + unscoredCount} clips`}: ` +
      `${lastRun.scored} scored${lastRun.failed ? `, ${lastRun.failed} failed` : ""} on ${lastRun.model}, ` +
      `${lastRun.tokens.toLocaleString("en-US")} tokens, ${lastRun.costUsd === null ? "unknown cost" : `$${Number(lastRun.costUsd).toFixed(4)}`}.`;

  return (
    <>
      {weekPanel}
      {/* Mock data has nothing to save scores to. */}
      {supabase && <ScoreClips scoredCount={scoredCount} unscoredCount={unscoredCount} lastRun={lastRunText} />}
      <ReviewBoard
        // A new week resets the filters to it.
        key={weeks[0]?.id ?? "no-week"}
        clips={clips}
        weeks={weeks.map((w) => ({ id: w.id, label: weekLabel(w.startsOn) }))}
        batches={batches}
        slots={postingSlots(PICKS_PER_WEEK).map((d) => d.toISOString())}
        schedulingLive={schedulingLive()}
      />
    </>
  );
}
