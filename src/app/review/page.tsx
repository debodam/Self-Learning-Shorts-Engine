import { Suspense } from "react";
import { connection } from "next/server";
import { Clapperboard } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { LoadingCard } from "@/components/loading-card";
import { PageHeader } from "@/components/page-header";
import { ClipCard } from "@/components/review/clip-card";
import { OpusSync, type OpusProjectOption } from "@/components/review/opus-sync";
import { ReviewBoard } from "@/components/review/review-board";
import { ScoreClips } from "@/components/review/score-clips";
import type { CandidateClip } from "@/lib/clips";
import { getLastScoringRunSummary, getScoredClips, getSyncedOpusProjectIds, getUnscoredClips } from "@/lib/db";
import { isIntegrationConnected } from "@/lib/integrations/config";
import { listProjects } from "@/lib/integrations/opus";

// Scoring every synced clip can take a few minutes, and server actions share the page's limit.
export const maxDuration = 300;

export default function ReviewPage() {
  return (
    <>
      <PageHeader
        title="Review"
        description="This week's shortlist. Approve 7 clips to schedule one per day."
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

async function loadProjectOptions(): Promise<OpusProjectOption[]> {
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
}

const SHORTLIST_SIZE = 10;

const runDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/New_York",
});

async function CandidateClips() {
  const [scored, unscored, lastRun] = await Promise.all([getScoredClips(), getUnscoredClips(), getLastScoringRunSummary()]);
  if (scored.length === 0 && unscored.length === 0) {
    return (
      <EmptyState icon={Clapperboard} title="No candidate clips yet">
        Sync clips from an Opus project, or let the weekly candidates job do it. Scored clips show up here for review.
      </EmptyState>
    );
  }

  const kept = scored.filter((c) => !c.cut);
  const cut = scored.filter((c) => c.cut);
  const lastRunText =
    lastRun &&
    `Last run ${runDate.format(new Date(lastRun.finishedAt))} ET: ${lastRun.scored} ${lastRun.scored === 1 ? "clip" : "clips"} on ${lastRun.model}, ` +
      `${lastRun.tokens.toLocaleString("en-US")} tokens, ${lastRun.costUsd === null ? "unknown cost" : `$${Number(lastRun.costUsd).toFixed(4)}`}` +
      (lastRun.failed ? `, ${lastRun.failed} failed.` : ".");

  return (
    <>
      {/* Mock data has no unscored clips and nothing to save scores to. */}
      {isIntegrationConnected("supabase") && <ScoreClips unscoredCount={unscored.length} lastRun={lastRunText} />}
      {kept.length > 0 && <ReviewBoard clips={kept.slice(0, SHORTLIST_SIZE)} />}
      <ClipSection
        title={`More scored clips (${kept.length - SHORTLIST_SIZE})`}
        description="Kept by the rubric but below the top 10. Sorted by total score."
        clips={kept.slice(SHORTLIST_SIZE)}
      />
      <ClipSection
        title={`Cut (${cut.length})`}
        description="Under 3 on Hook or Standalone, so they can't go on the shortlist. Sorted by total score."
        clips={cut}
      />
      <ClipSection
        title={`Waiting for scores (${unscored.length})`}
        description="Synced from Opus and not scored yet. Sorted by Opus score."
        clips={unscored}
      />
    </>
  );
}

function ClipSection({ title, description, clips }: { title: string; description: string; clips: CandidateClip[] }) {
  if (clips.length === 0) return null;
  return (
    <section className="mt-12">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-heading">{title}</h2>
        <p className="text-sm text-muted">{description}</p>
      </div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {clips.map((clip) => (
          <ClipCard key={clip.id} clip={clip} />
        ))}
      </div>
    </section>
  );
}
