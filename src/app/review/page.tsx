import { PageHeader } from "@/components/page-header";
import { ReviewBoard } from "@/components/review/review-board";
import { mockCandidateClips } from "@/lib/mock/candidate-clips";

export default function ReviewPage() {
  return (
    <>
      <PageHeader
        title="Review"
        description="This week's shortlist. Approve 7 clips to schedule one per day."
      />
      <ReviewBoard clips={mockCandidateClips} />
    </>
  );
}
