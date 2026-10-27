import { Suspense } from "react";
import { LoadingCard } from "@/components/loading-card";
import { PageHeader } from "@/components/page-header";
import { PerformanceDashboard } from "@/components/performance/performance-dashboard";
import { getPostedClips } from "@/lib/db";

export default function PerformancePage() {
  return (
    <>
      <PageHeader
        title="Performance"
        description="How posted clips are doing on YouTube, TikTok, and Instagram."
      />
      <Suspense fallback={<LoadingCard className="h-96" />}>
        <PostedClips />
      </Suspense>
    </>
  );
}

async function PostedClips() {
  const clips = await getPostedClips();
  return <PerformanceDashboard clips={clips} />;
}
