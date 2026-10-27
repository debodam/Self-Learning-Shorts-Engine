import { Suspense } from "react";
import { CalendarClock } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { LoadingCard } from "@/components/loading-card";
import { PageHeader } from "@/components/page-header";
import { CancelPostButton } from "@/components/schedule/cancel-post-button";
import { getUpcomingPosts } from "@/lib/db";

export default function SchedulePage() {
  return (
    <>
      <PageHeader
        title="Schedule"
        description="Upcoming posts on the Exponent YouTube channel through OpusClip, soonest first. Cancel removes a post from OpusClip too."
      />
      <Suspense fallback={<LoadingCard className="h-64" />}>
        <UpcomingPosts />
      </Suspense>
    </>
  );
}

const slotFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/New_York",
  timeZoneName: "short",
});

async function UpcomingPosts() {
  const posts = await getUpcomingPosts();
  if (posts.length === 0) {
    return (
      <EmptyState icon={CalendarClock} title="Nothing scheduled">
        Pick this week&apos;s 7 clips on the Review page and schedule them. They show up here once Opus accepts them.
      </EmptyState>
    );
  }
  return (
    <section className="rounded-card border border-line bg-surface">
      <ol>
        {posts.map((post) => (
          <li key={post.id} className="flex flex-col gap-3 border-b border-line px-6 py-4 last:border-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-medium text-heading">{post.clipTitle}</p>
              <p className="text-sm text-muted">YouTube, {slotFormat.format(new Date(post.scheduledFor))}</p>
            </div>
            <CancelPostButton postId={post.id} title={post.clipTitle} />
          </li>
        ))}
      </ol>
    </section>
  );
}
