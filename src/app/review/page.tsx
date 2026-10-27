import { Suspense } from "react";
import { Clapperboard } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
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
  if (clips.length === 0) {
    return (
      <EmptyState icon={Clapperboard} title="No candidate clips yet">
        The weekly candidates job submits new uploads to OpusClip and scores the clips. Scored clips show up here for
        review.
      </EmptyState>
    );
  }
  return <ReviewBoard clips={clips} />;
}
