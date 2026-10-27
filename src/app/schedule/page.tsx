import { Suspense } from "react";
import { CalendarClock } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { LoadingCard } from "@/components/loading-card";
import { PageHeader } from "@/components/page-header";
import { getUpcomingPosts } from "@/lib/db";

export default function SchedulePage() {
  return (
    <>
      <PageHeader title="Schedule" description="Posts scheduled on YouTube through OpusClip, soonest first." />
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
          <li key={post.id} className="flex flex-col gap-1 border-b border-line px-6 py-4 last:border-0 sm:flex-row sm:items-center sm:justify-between">
            <span className="font-medium text-heading">{post.clipTitle}</span>
            <span className="shrink-0 text-sm text-muted">YouTube, {slotFormat.format(new Date(post.scheduledFor))}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
