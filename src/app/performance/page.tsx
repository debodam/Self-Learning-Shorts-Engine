import { Suspense } from "react";
import { AlertTriangle, BarChart3 } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { LoadingCard } from "@/components/loading-card";
import { PageHeader } from "@/components/page-header";
import { PullMetricsButton } from "@/components/performance/pull-metrics-button";
import { ShortsDashboard } from "@/components/performance/shorts-dashboard";
import { getShortsPerformance, type ShortsPerformance } from "@/lib/db/youtube-shorts";

// A full pull pages through every upload on the channel.
export const maxDuration = 120;

const dateTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/New_York",
  timeZoneName: "short",
});

export default function PerformancePage() {
  return (
    <Suspense fallback={<LoadingCard className="h-96" />}>
      <Performance />
    </Suspense>
  );
}

async function Performance() {
  const data = await getShortsPerformance();
  return (
    <>
      <PageHeader
        title="Performance"
        description={`Every Short on the Aced YouTube channel: views, likes, and comments.${
          data.lastPulledAt ? ` Last pulled ${dateTime.format(new Date(data.lastPulledAt))}.` : ""
        }`}
        actions={<PullMetricsButton disabled={data.mock} />}
      />
      <Body data={data} />
    </>
  );
}

function Body({ data }: { data: ShortsPerformance }) {
  // Rendered per request (the loader calls connection()), so "now" is the request time.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  return (
    <div className="flex flex-col gap-6">
      {data.mock && (
        <p className="rounded-card border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-800">
          Sample data. Set YOUTUBE_API_KEY and YOUTUBE_CHANNEL_ID in .env.local to see the real channel.
        </p>
      )}
      {data.unmatched.length > 0 && (
        <section className="rounded-card border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          <h2 className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="size-4" />
            {data.unmatched.length} of our YouTube posts couldn&apos;t be matched to a Short
          </h2>
          <ul className="mt-2 flex flex-col gap-1.5">
            {data.unmatched.map((p) => (
              <li key={p.id}>
                <span className="font-medium">{p.title}</span>
                <span className="text-amber-800"> (posted {dateTime.format(new Date(p.expectedAt))}): {p.note}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data.shorts.length === 0 ? (
        <EmptyState icon={BarChart3} title="No Shorts yet">
          Pull metrics to load every Short on the channel.
        </EmptyState>
      ) : (
        <ShortsDashboard shorts={data.shorts} now={now} />
      )}
    </div>
  );
}
