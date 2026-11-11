"use client";

import { useState } from "react";
import type { AccuracyPoint } from "@/lib/db/learning-loop";

// Prediction accuracy over time: one line per metric on one 0-based axis (Spearman runs
// -1 to 1, the hit rates 0 to 1, so all three share a unitless scale). Backtests are
// filled markers, our posted clips hollow. Dashed rules mark where the prompt version
// changes. Colors are the validated categorical slots 1 to 3; the table below the chart
// is the accessible view (slot 3 is under 3:1 against white).

const SERIES = [
  { key: "spearman", label: "Rank accuracy (Spearman)", color: "#2a78d6", format: (v: number) => v.toFixed(2) },
  { key: "rangeHitRate", label: "Range hit rate", color: "#eb6834", format: (v: number) => `${Math.round(v * 100)}%` },
  { key: "top7HitRate", label: "Top 7 hit rate", color: "#1baf7a", format: (v: number) => `${Math.round(v * 100)}%` },
] as const;

const W = 720;
const H = 260;
const M = { top: 16, right: 16, bottom: 32, left: 40 };
const dateLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

export function AccuracyChart({ points }: { points: AccuracyPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length === 0) {
    return <p className="text-sm text-muted">No accuracy measured yet. Run a backtest or the weekly report.</p>;
  }
  const values = points.flatMap((p) => SERIES.map((s) => p[s.key]).filter((v): v is number => v !== null));
  const yMin = Math.min(0, Math.floor(Math.min(...values) * 4) / 4);
  const yMax = 1;
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  // Evenly spaced by measurement: runs cluster in time, and order is what matters.
  const x = (i: number) => M.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => M.top + ((yMax - v) / (yMax - yMin)) * innerH;
  const ticks = Array.from({ length: Math.round((yMax - yMin) / 0.25) + 1 }, (_, i) => yMin + i * 0.25);
  const versionChanges = points.flatMap((p, i) => (i > 0 && p.promptVersion !== points[i - 1].promptVersion ? [i] : []));

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-body">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="h-0.5 w-4 rounded" style={{ background: s.color }} />
            {s.label}
          </li>
        ))}
        <li className="flex items-center gap-2 text-muted">
          <span className="size-2 rounded-full bg-muted" /> backtest
          <span className="ml-2 size-2 rounded-full border border-muted" /> our posted clips
        </li>
      </ul>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Prediction accuracy over time">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="#e7e7ea" strokeWidth={t === 0 ? 1.5 : 1} />
              <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px]">
                {t.toFixed(2)}
              </text>
            </g>
          ))}
          {versionChanges.map((i) => (
            <g key={i}>
              <line x1={(x(i) + x(i - 1)) / 2} x2={(x(i) + x(i - 1)) / 2} y1={M.top} y2={H - M.bottom} stroke="#6b6b76" strokeDasharray="4 4" />
              <text x={(x(i) + x(i - 1)) / 2 + 4} y={M.top + 10} className="fill-muted text-[11px]">
                v{points[i].promptVersion}
              </text>
            </g>
          ))}
          {points.length > 0 && (
            <text x={x(0)} y={H - 8} textAnchor={points.length === 1 ? "middle" : "start"} className="fill-muted text-[11px]">
              {dateLabel.format(new Date(points[0].createdAt))} (v{points[0].promptVersion})
            </text>
          )}
          {points.length > 1 && (
            <text x={x(points.length - 1)} y={H - 8} textAnchor="end" className="fill-muted text-[11px]">
              {dateLabel.format(new Date(points.at(-1)!.createdAt))}
            </text>
          )}
          {SERIES.map((s) => {
            const pts = points.map((p, i) => ({ i, v: p[s.key], source: p.source })).filter((p): p is { i: number; v: number; source: AccuracyPoint["source"] } => p.v !== null);
            return (
              <g key={s.key}>
                {pts.length > 1 && (
                  <polyline points={pts.map((p) => `${x(p.i)},${y(p.v)}`).join(" ")} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
                )}
                {pts.map((p) => (
                  <circle
                    key={p.i}
                    cx={x(p.i)}
                    cy={y(p.v)}
                    r={4}
                    fill={p.source === "backtest" ? s.color : "#ffffff"}
                    stroke={p.source === "backtest" ? "#ffffff" : s.color}
                    strokeWidth={2}
                  />
                ))}
              </g>
            );
          })}
          {/* Hit targets wider than the marks, one per measurement. */}
          {points.map((_, i) => (
            <rect
              key={i}
              x={x(i) - Math.max(8, innerW / Math.max(1, points.length - 1) / 2)}
              y={M.top}
              width={Math.max(16, innerW / Math.max(1, points.length - 1))}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={H - M.bottom} stroke="#6b6b76" strokeWidth={1} pointerEvents="none" />}
        </svg>
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-2 z-10 rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-sm"
            style={{ left: `${(x(hover) / W) * 100}%`, transform: x(hover) > W / 2 ? "translateX(calc(-100% - 12px))" : "translateX(12px)" }}
          >
            <p className="font-medium text-heading">
              {dateLabel.format(new Date(points[hover].createdAt))}, v{points[hover].promptVersion}, {points[hover].source === "backtest" ? "backtest" : "our posted clips"}
            </p>
            <p className="text-muted">{points[hover].count} items</p>
            {SERIES.map((s) => (
              <p key={s.key} className="flex items-center gap-2 text-body">
                <span className="h-0.5 w-3 rounded" style={{ background: s.color }} />
                {s.label}: {points[hover][s.key] === null ? "n/a" : s.format(points[hover][s.key]!)}
              </p>
            ))}
          </div>
        )}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer font-medium text-primary hover:underline">Show as a table</summary>
        <table className="mt-2 w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="py-1 pr-3 font-medium">Measured</th>
              <th className="py-1 pr-3 font-medium">Version</th>
              <th className="py-1 pr-3 font-medium">Source</th>
              <th className="py-1 pr-3 text-right font-medium">Items</th>
              {SERIES.map((s) => (
                <th key={s.key} className="py-1 pr-3 text-right font-medium">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.id} className="border-t border-line">
                <td className="py-1 pr-3">{dateLabel.format(new Date(p.createdAt))}</td>
                <td className="py-1 pr-3">v{p.promptVersion}</td>
                <td className="py-1 pr-3">{p.source === "backtest" ? "Backtest" : "Our posted clips"}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{p.count}</td>
                {SERIES.map((s) => (
                  <td key={s.key} className="py-1 pr-3 text-right tabular-nums">
                    {p[s.key] === null ? "n/a" : s.format(p[s.key]!)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
