import { ArrowRightLeft, CheckCircle2, MessageSquareText } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { mockWeeklyLearnings } from "@/lib/mock/weekly-learnings";

const dayFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const dayYearFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function formatWeek(start: string, end: string) {
  return `${dayFormat.format(new Date(start))} to ${dayYearFormat.format(new Date(end))}`;
}

export default function LearningsPage() {
  return (
    <>
      <PageHeader
        title="Learnings"
        description="What the agent learned from each week of results and how it changed the next shortlist."
      />
      <ol className="flex flex-col gap-5">
        {mockWeeklyLearnings.map((entry, i) => (
          <li key={entry.id} className="rounded-card border border-line bg-surface p-6">
            <div className="mb-5 flex items-center gap-3">
              <h2 className="text-lg font-semibold text-heading">
                Week of {formatWeek(entry.weekStart, entry.weekEnd)}
              </h2>
              {i === 0 && (
                <span className="rounded-full bg-primary-tint px-2.5 py-0.5 text-xs font-medium text-primary">
                  Latest
                </span>
              )}
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              <Section icon={CheckCircle2} title="What worked">
                <BulletList items={entry.whatWorked} />
              </Section>
              <Section icon={ArrowRightLeft} title="What changed">
                <BulletList items={entry.whatChanged} />
              </Section>
            </div>
            <div className="mt-6 rounded-lg bg-page p-4">
              <Section icon={MessageSquareText} title="Why">
                <p className="text-sm leading-relaxed text-body">{entry.why}</p>
              </Section>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
        <Icon className="size-4 text-primary" />
        {title}
      </h3>
      {children}
    </section>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-body marker:text-primary">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
