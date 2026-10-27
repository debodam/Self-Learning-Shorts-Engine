import { Suspense } from "react";
import { LoadingCard } from "@/components/loading-card";
import { PageHeader } from "@/components/page-header";
import { ReviewBoard } from "@/components/review/review-board";
import { getCandidateClips } from "@/lib/db";

export default function ReviewPage() {
  return (
    <>
      <PageHeader
        title="Review"
        description="This week's shortlist. Approve 7 clips to schedule one per day."
      />
      <Suspense fallback={<LoadingCard className="h-96" />}>
        <CandidateClips />
      </Suspense>
    </>
  );
}

async function CandidateClips() {
  const clips = await getCandidateClips();
  return <ReviewBoard clips={clips} />;
}
