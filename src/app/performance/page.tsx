import { PageHeader } from "@/components/page-header";
import { PerformanceDashboard } from "@/components/performance/performance-dashboard";
import { mockPostedClips } from "@/lib/mock/posted-clips";

export default function PerformancePage() {
  return (
    <>
      <PageHeader
        title="Performance"
        description="How posted clips are doing on YouTube, TikTok, and Instagram."
      />
      <PerformanceDashboard clips={mockPostedClips} />
    </>
  );
}
