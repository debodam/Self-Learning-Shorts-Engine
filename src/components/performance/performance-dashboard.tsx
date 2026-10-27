"use client";

import { useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { SegmentedControl } from "@/components/segmented-control";
import { formatLabels, platformLabels, type ClipFormat, type Platform } from "@/lib/clips";
import { splitWeeks, totalViews, type PostedClip } from "@/lib/performance";

const platforms = Object.keys(platformLabels) as Platform[];

const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const fullNumber = new Intl.NumberFormat("en-US");
const shortDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "America/New_York",
});

type PlatformFilter = "all" | Platform;
type FormatFilter = "all" | ClipFormat;

const platformOptions: { value: PlatformFilter; label: string }[] = [
  { value: "all", label: "All" },
  ...platforms.map((p) => ({ value: p, label: platformLabels[p] })),
];

const formatOptions: { value: FormatFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "mock", label: formatLabels.mock },
  { value: "conversational", label: formatLabels.conversational },
];

export function PerformanceDashboard({ clips }: { clips: PostedClip[] }) {
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("all");
  const [formatFilter, setFormatFilter] = useState<FormatFilter>("all");

  const matchesFormat = (c: PostedClip) => formatFilter === "all" || c.format === formatFilter;
  const visibleClips = clips
    .filter(matchesFormat)
    .toSorted((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt));
  const visiblePlatforms = platformFilter === "all" ? platforms : [platformFilter];

  // Week boundaries come from all clips so the format filter doesn't shift them.
  const weeks = splitWeeks(clips);
  const { weekStart, weekEnd } = weeks;
  const thisWeek = weeks.thisWeek.filter(matchesFormat);
  const lastWeek = weeks.lastWeek.filter(matchesFormat);

  return (
    <div className="flex flex-col gap-6">
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-semibold text-heading">Views this week</h2>
          {weekStart && weekEnd && (
            <span className="text-sm text-muted">
              {shortDate.format(weekStart)} to {shortDate.format(weekEnd)}
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {platforms.map((platform) => {
            const current = totalViews(thisWeek, platform);
            const previous = totalViews(lastWeek, platform);
            const change = previous ? (current - previous) / previous : null;
            const dimmed = platformFilter !== "all" && platformFilter !== platform;
            return (
              <div
                key={platform}
                className={`rounded-card border border-line bg-surface p-5 transition-opacity ${
                  dimmed ? "opacity-50" : ""
                }`}
              >
                <p className="text-sm text-muted">{platformLabels[platform]}</p>
                <p className="mt-1 text-3xl font-bold tracking-tight text-heading">
                  {compactNumber.format(current)}
                </p>
                {change !== null && (
                  <p
                    className={`mt-2 flex items-center gap-1 text-sm ${
                      change >= 0 ? "text-emerald-600" : "text-red-600"
                    }`}
                  >
                    {change >= 0 ? (
                      <TrendingUp className="size-4" />
                    ) : (
                      <TrendingDown className="size-4" />
                    )}
                    {change >= 0 ? "+" : ""}
                    {Math.round(change * 100)}%
                    <span className="text-muted">vs last week</span>
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-card border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-5 py-4">
          <h2 className="font-semibold text-heading">Posted clips</h2>
          <div className="flex flex-wrap items-center gap-5">
            <SegmentedControl
              label="Platform"
              options={platformOptions}
              value={platformFilter}
              onChange={setPlatformFilter}
            />
            <SegmentedControl
              label="Format"
              options={formatOptions}
              value={formatFilter}
              onChange={setFormatFilter}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-medium uppercase tracking-wide text-muted">
                <th rowSpan={2} className="px-5 pt-3 pb-2 align-bottom font-medium">Posted</th>
                <th rowSpan={2} className="px-3 pt-3 pb-2 align-bottom font-medium">Clip</th>
                <th rowSpan={2} className="px-3 pt-3 pb-2 align-bottom font-medium">Format</th>
                {visiblePlatforms.map((platform) => (
                  <th
                    key={platform}
                    colSpan={3}
                    scope="colgroup"
                    className="border-l border-line px-3 pt-3 text-center font-semibold normal-case tracking-normal text-heading"
                  >
                    {platformLabels[platform]}
                  </th>
                ))}
              </tr>
              <tr className="whitespace-nowrap border-b border-line text-right text-xs text-muted">
                {visiblePlatforms.map((platform) => (
                  <MetricHeaders key={platform} />
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleClips.map((clip) => (
                <tr key={clip.id} className="border-b border-line last:border-0 hover:bg-page">
                  <td className="whitespace-nowrap px-5 py-3 text-muted">
                    {shortDate.format(new Date(clip.postedAt))}
                  </td>
                  <td className="min-w-64 px-3 py-3 font-medium text-heading">{clip.title}</td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <span className="rounded-full bg-page px-2 py-0.5 text-xs text-body">
                      {formatLabels[clip.format]}
                    </span>
                  </td>
                  {visiblePlatforms.map((platform) => {
                    const m = clip.metrics[platform];
                    return (
                      <MetricCells
                        key={platform}
                        views={m.views}
                        watched={m.avgPercentWatched}
                        shares={m.shares}
                      />
                    );
                  })}
                </tr>
              ))}
              {visibleClips.length === 0 && (
                <tr>
                  <td colSpan={3 + visiblePlatforms.length * 3} className="px-5 py-10 text-center text-muted">
                    No clips match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function MetricHeaders() {
  return (
    <>
      <th className="border-l border-line px-3 pb-2 pt-1 font-medium">Views</th>
      <th className="px-3 pb-2 pt-1 font-medium">Avg watched</th>
      <th className="px-3 pb-2 pt-1 font-medium">Shares</th>
    </>
  );
}

function MetricCells({ views, watched, shares }: { views: number; watched: number; shares: number }) {
  return (
    <>
      <td className="border-l border-line px-3 py-3 text-right font-medium tabular-nums text-heading">
        {fullNumber.format(views)}
      </td>
      <td className="px-3 py-3 text-right tabular-nums">{watched}%</td>
      <td className="px-3 py-3 text-right tabular-nums">{fullNumber.format(shares)}</td>
    </>
  );
}
