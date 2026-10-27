import { Suspense } from "react";
import { BarChart3, Clock } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { LoadingCard } from "@/components/loading-card";
import { PageHeader } from "@/components/page-header";
import { PerformanceDashboard } from "@/components/performance/performance-dashboard";
import { getPostedClips } from "@/lib/db";
import { PHASE_2_LIVE } from "@/lib/phases";

export default function PerformancePage() {
  return (
    <>
      <PageHeader
        title="Performance"
        description="How posted clips are doing on YouTube."
      />
      {PHASE_2_LIVE ? (
        <Suspense fallback={<LoadingCard className="h-96" />}>
          <PostedClips />
        </Suspense>
      ) : (
        <EmptyState icon={Clock} title="Coming in Phase 2">
          YouTube metrics for posted clips, plus the V1 performance import, come in Phase 2.
        </EmptyState>
      )}
    </>
  );
}

async function PostedClips() {
  const clips = await getPostedClips();
  if (clips.length === 0) {
    return (
      <EmptyState icon={BarChart3} title="No posted clips yet">
        Clips appear here once they&apos;re posted and the metrics pull has run. To load past results, import a V1
        performance CSV (see the README).
      </EmptyState>
    );
  }
  return <PerformanceDashboard clips={clips} />;
}
