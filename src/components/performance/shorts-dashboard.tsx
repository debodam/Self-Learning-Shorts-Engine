"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, ExternalLink } from "lucide-react";
import { SegmentedControl } from "@/components/segmented-control";
import { formatLabels, type ClipFormat } from "@/lib/clips";
import type { ShortRow } from "@/lib/db/youtube-shorts";

const fullNumber = new Intl.NumberFormat("en-US");
const compactNumber = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
const monthName = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "America/New_York" });
const monthKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: "America/New_York" }).format(d);
const percent = (v: number | null) => (v === null ? null : `${(v * 100).toFixed(1)}%`);

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE = 50;

type DateFilter = "7" | "30" | "90" | "365" | "all";
type FormatFilter = "all" | ClipFormat;
type SourceFilter = "all" | "pipeline" | "other";
type SortKey = "publishedAt" | "views48h" | "views7d" | "views" | "likes" | "comments" | "engagement";

const dateOptions: { value: DateFilter; label: string }[] = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "all", label: "All" },
];
const formatOptions: { value: FormatFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "mock", label: formatLabels.mock },
  { value: "conversational", label: formatLabels.conversational },
];
const sourceOptions: { value: SourceFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pipeline", label: "Our pipeline" },
  { value: "other", label: "Other" },
];

const columns: { key: SortKey; label: string; title?: string }[] = [
  { key: "views48h", label: "Views 48h", title: "Views 48 hours after publish" },
  { key: "views7d", label: "Views 7d", title: "Views 7 days after publish" },
  { key: "views", label: "Views", title: "Views as of the last pull" },
  { key: "likes", label: "Likes" },
  { key: "comments", label: "Comments" },
  { key: "engagement", label: "Engagement", title: "(likes + comments) / views" },
];

const sortValue = (s: ShortRow, key: SortKey) => (key === "publishedAt" ? Date.parse(s.publishedAt) : s[key]);

export function ShortsDashboard({ shorts, now }: { shorts: ShortRow[]; now: number }) {
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [formatFilter, setFormatFilter] = useState<FormatFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "publishedAt", desc: true });
  const [shown, setShown] = useState(PAGE);

  const visible = shorts
    .filter((s) => dateFilter === "all" || Date.parse(s.publishedAt) >= now - Number(dateFilter) * DAY_MS)
    .filter((s) => formatFilter === "all" || s.format === formatFilter)
    .filter((s) => sourceFilter === "all" || s.fromPipeline === (sourceFilter === "pipeline"))
    .toSorted((a, b) => {
      const x = sortValue(a, sort.key);
      const y = sortValue(b, sort.key);
      // Missing values (no pull near the mark, hidden likes) always sort last.
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      return sort.desc ? y - x : x - y;
    });

  const toggleSort = (key: SortKey) => {
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: true }));
    setShown(PAGE);
  };
  const filter =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setShown(PAGE);
    };

  // Summary cards cover the whole channel so filters don't move them.
  const with7d = shorts.filter((s) => s.views7d !== null);
  const avg7d = with7d.length ? Math.round(with7d.reduce((sum, s) => sum + s.views7d!, 0) / with7d.length) : null;
  const thisMonth = monthKey(new Date(now));
  const best = shorts.filter((s) => monthKey(new Date(s.publishedAt)) === thisMonth).toSorted((a, b) => b.views - a.views)[0];

  return (
    <div className="flex flex-col gap-6">
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card label="Total Shorts">
          <p className="mt-1 text-3xl font-bold tracking-tight text-heading">{fullNumber.format(shorts.length)}</p>
          <p className="mt-2 text-sm text-muted">{shorts.filter((s) => s.fromPipeline).length} from our pipeline</p>
        </Card>
        <Card label="Average 7-day views">
          <p className="mt-1 text-3xl font-bold tracking-tight text-heading">{avg7d === null ? "None yet" : compactNumber.format(avg7d)}</p>
          <p className="mt-2 text-sm text-muted">
            {with7d.length
              ? `Across ${with7d.length} ${with7d.length === 1 ? "Short" : "Shorts"} with a 7-day reading`
              : "Needs a pull about 7 days after a Short goes live"}
          </p>
        </Card>
        <Card label={`Best Short in ${monthName.format(new Date(now))}`}>
          {best ? (
            <>
              <p className="mt-1 text-3xl font-bold tracking-tight text-heading">{compactNumber.format(best.views)} views</p>
              <a
                href={`https://www.youtube.com/shorts/${best.videoId}`}
                target="_blank"
                rel="noreferrer"
                className="mt-2 line-clamp-2 text-sm text-primary hover:underline"
              >
                {best.title}
              </a>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted">No Shorts published this month yet.</p>
          )}
        </Card>
      </section>

      <section className="rounded-card border border-line bg-surface">
        <div className="flex flex-col gap-4 border-b border-line px-5 py-4">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-semibold text-heading">Shorts</h2>
            <span className="text-sm text-muted">
              {visible.length} of {shorts.length}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <SegmentedControl label="Published" options={dateOptions} value={dateFilter} onChange={filter(setDateFilter)} />
            <SegmentedControl label="Format" options={formatOptions} value={formatFilter} onChange={filter(setFormatFilter)} />
            <SegmentedControl label="Source" options={sourceOptions} value={sourceFilter} onChange={filter(setSourceFilter)} />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="whitespace-nowrap border-b border-line text-xs font-medium uppercase tracking-wide text-muted">
                <SortHeader label="Published" sortKey="publishedAt" sort={sort} onSort={toggleSort} align="left" className="pl-5" />
                <th className="px-3 py-3 text-left font-medium">Title</th>
                <th className="px-3 py-3 text-left font-medium">Format</th>
                {columns.map((c) => (
                  <SortHeader key={c.key} label={c.label} title={c.title} sortKey={c.key} sort={sort} onSort={toggleSort} align="right" />
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, shown).map((s) => (
                <tr key={s.videoId} className="border-b border-line last:border-0 hover:bg-page">
                  <td className="whitespace-nowrap py-3 pl-5 pr-3 text-muted">{shortDate.format(new Date(s.publishedAt))}</td>
                  <td className="min-w-72 px-3 py-3">
                    <a
                      href={`https://www.youtube.com/shorts/${s.videoId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-heading hover:text-primary"
                    >
                      {s.title}
                      <ExternalLink className="ml-1 inline size-3.5 text-muted" />
                    </a>
                    {s.fromPipeline && (
                      <span className="ml-2 whitespace-nowrap rounded-full bg-primary-tint px-2 py-0.5 text-xs font-medium text-primary">
                        Our pipeline
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    {s.format ? (
                      <span className="rounded-full bg-page px-2 py-0.5 text-xs text-body" title={s.formatGuessed ? "Guessed from the title" : "From the clip"}>
                        {formatLabels[s.format]}
                        {s.formatGuessed ? "?" : ""}
                      </span>
                    ) : (
                      <Missing />
                    )}
                  </td>
                  <NumberCell value={s.views48h} missing="Not captured" />
                  <NumberCell value={s.views7d} missing="Not captured" />
                  <NumberCell value={s.views} strong />
                  <NumberCell value={s.likes} missing="Hidden" />
                  <NumberCell value={s.comments} missing="Off" />
                  <td className="whitespace-nowrap px-3 py-3 pr-5 text-right tabular-nums">{percent(s.engagement) ?? <Missing />}</td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-10 text-center text-muted">
                    No Shorts match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {visible.length > shown && (
          <div className="border-t border-line px-5 py-3 text-center">
            <button type="button" onClick={() => setShown((n) => n + PAGE)} className="text-sm font-medium text-primary hover:underline">
              Show {Math.min(PAGE, visible.length - shown)} more
            </button>
          </div>
        )}
      </section>
      <p className="text-xs text-muted">
        Views at 48h and 7d come from the pulls closest to each mark, so they only exist for Shorts pulled near that age.
        A format with ? is guessed from the title; Shorts from our pipeline use the clip&apos;s format.
      </p>
    </div>
  );
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-surface p-5">
      <p className="text-sm text-muted">{label}</p>
      {children}
    </div>
  );
}

function SortHeader({
  label,
  title,
  sortKey,
  sort,
  onSort,
  align,
  className = "",
}: {
  label: string;
  title?: string;
  sortKey: SortKey;
  sort: { key: SortKey; desc: boolean };
  onSort: (key: SortKey) => void;
  align: "left" | "right";
  className?: string;
}) {
  const active = sort.key === sortKey;
  const Arrow = sort.desc ? ArrowDown : ArrowUp;
  return (
    <th
      aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}
      className={`px-3 py-3 font-medium ${align === "right" ? "text-right" : "text-left"} ${className}`}
    >
      <button
        type="button"
        title={title}
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-heading ${active ? "text-primary" : ""}`}
      >
        {label}
        {active && <Arrow className="size-3.5" />}
      </button>
    </th>
  );
}

function NumberCell({ value, missing = "n/a", strong }: { value: number | null; missing?: string; strong?: boolean }) {
  return (
    <td className={`whitespace-nowrap px-3 py-3 text-right tabular-nums ${strong ? "font-medium text-heading" : ""}`}>
      {value === null ? <Missing label={missing} /> : fullNumber.format(value)}
    </td>
  );
}

function Missing({ label = "n/a" }: { label?: string }) {
  return <span className="text-xs text-muted">{label}</span>;
}
