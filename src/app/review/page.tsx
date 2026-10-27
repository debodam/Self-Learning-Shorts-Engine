import { Suspense } from "react";
import { connection } from "next/server";
import { Clapperboard } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { LoadingCard } from "@/components/loading-card";
import { PageHeader } from "@/components/page-header";
import { ClipCard } from "@/components/review/clip-card";
import { OpusSync, type OpusProjectOption } from "@/components/review/opus-sync";
import { ReviewBoard } from "@/components/review/review-board";
import { getCandidateClips, getSyncedOpusProjectIds, getUnscoredClips } from "@/lib/db";
import { isIntegrationConnected } from "@/lib/integrations/config";
import { listProjects } from "@/lib/integrations/opus";

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

async function CandidateClips() {
  const [clips, unscored] = await Promise.all([getCandidateClips(), getUnscoredClips()]);
  if (clips.length === 0 && unscored.length === 0) {
    return (
      <EmptyState icon={Clapperboard} title="No candidate clips yet">
        Sync clips from an Opus project, or let the weekly candidates job do it. Scored clips show up here for review.
      </EmptyState>
    );
  }
  return (
    <>
      {clips.length > 0 && <ReviewBoard clips={clips} />}
      {unscored.length > 0 && (
        <section className={clips.length > 0 ? "mt-12" : ""}>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-heading">Waiting for scores ({unscored.length})</h2>
            <p className="text-sm text-muted">
              Synced from Opus. The agent scores these on the next weekly candidates run, then the best go on the
              shortlist. Sorted by Opus score.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {unscored.map((clip) => (
              <ClipCard key={clip.id} clip={clip} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
