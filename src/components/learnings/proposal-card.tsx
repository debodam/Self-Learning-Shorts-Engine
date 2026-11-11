"use client";

import { useState, useTransition } from "react";
import { approveProposal, rejectProposal, type LoopActionResult } from "@/app/learnings/actions";
import type { Metrics, Proposal } from "@/lib/db/learning-loop";

/** Word-level diff of two short texts (longest common subsequence). */
function wordDiff(a: string, b: string) {
  const x = a.split(/(\s+)/);
  const y = b.split(/(\s+)/);
  const dp = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { text: string; kind: "same" | "del" | "add" }[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      out.push({ text: x[i++], kind: "same" });
      j++;
    }
    else if (j < y.length && (i >= x.length || dp[i][j + 1] >= dp[i + 1][j])) out.push({ text: y[j++], kind: "add" });
    else out.push({ text: x[i++], kind: "del" });
  }
  return out;
}

const pct = (v: number | null) => (v === null ? "n/a" : `${Math.round(v * 100)}%`);
const num = (v: number | null) => (v === null ? "n/a" : v.toFixed(2));

function Delta({ before, after, format }: { before: number | null; after: number | null; format: (v: number | null) => string }) {
  if (before === null || after === null) return <span className="text-muted">{format(after)}</span>;
  const d = after - before;
  const tone = Math.abs(d) < 0.005 ? "text-muted" : d > 0 ? "text-emerald-700" : "text-red-700";
  return (
    <span className="tabular-nums">
      <span className="text-heading">{format(after)}</span>{" "}
      <span className={`text-xs ${tone}`}>
        ({d > 0 ? "+" : ""}
        {format === pct ? `${Math.round(d * 100)} pts` : d.toFixed(2)})
      </span>
    </span>
  );
}

function BacktestResult({ baseline, backtest }: { baseline: (Metrics & { costUsd: number | null }) | null; backtest: (Metrics & { costUsd: number | null }) | null }) {
  if (!backtest || !baseline) return <p className="text-sm text-muted">Not backtested yet.</p>;
  const rows: [string, number | null, number | null, (v: number | null) => string][] = [
    ["Rank accuracy (Spearman)", baseline.spearman, backtest.spearman, num],
    ["Range hit rate", baseline.rangeHitRate, backtest.rangeHitRate, pct],
    ["Top 7 hit rate (per month)", baseline.top7HitRate, backtest.top7HitRate, pct],
  ];
  return (
    <table className="w-full text-sm">
      <thead className="text-xs uppercase tracking-wide text-muted">
        <tr>
          <th className="py-1 text-left font-medium">Backtest on {backtest.count} recent Shorts</th>
          <th className="py-1 text-right font-medium">Current</th>
          <th className="py-1 text-right font-medium">With change</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, before, after, format]) => (
          <tr key={label} className="border-t border-line">
            <td className="py-1.5 text-body">{label}</td>
            <td className="py-1.5 text-right tabular-nums text-muted">{format(before)}</td>
            <td className="py-1.5 text-right">
              <Delta before={before} after={after} format={format} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ProposalCard({ proposal }: { proposal: Proposal }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<LoopActionResult | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const diff = wordDiff(proposal.oldText, proposal.newText);

  function act(fn: () => Promise<LoopActionResult>) {
    setResult(null);
    startTransition(async () => setResult(await fn()));
  }

  return (
    <article className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold text-heading">{proposal.title}</h4>
          <p className="mt-1 text-sm text-body">{proposal.reasoning}</p>
        </div>
        <StatusBadge proposal={proposal} />
      </div>

      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Change to prompt v{proposal.baseVersion}</p>
        <p className="whitespace-pre-wrap rounded-md bg-page px-3 py-2.5 text-sm leading-relaxed text-body">
          {diff.map((d, i) =>
            d.kind === "same" ? (
              <span key={i}>{d.text}</span>
            ) : d.kind === "del" ? (
              <del key={i} className="bg-red-50 text-red-700">
                {d.text}
              </del>
            ) : (
              <ins key={i} className="bg-emerald-50 text-emerald-800 no-underline">
                {d.text}
              </ins>
            ),
          )}
        </p>
      </div>

      <BacktestResult baseline={proposal.baseline} backtest={proposal.backtest} />

      {proposal.status === "rejected" && proposal.rejectionReason && <p className="text-sm text-muted">Rejected because: {proposal.rejectionReason}</p>}

      {proposal.status === "pending" && (
        <div className="flex flex-col gap-3 border-t border-line pt-3">
          {rejecting ? (
            <div className="flex flex-col gap-2">
              <label htmlFor={`reason-${proposal.id}`} className="text-sm font-medium text-heading">
                Why reject it?
              </label>
              <textarea
                id={`reason-${proposal.id}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-body"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pending || !reason.trim()}
                  onClick={() => act(() => rejectProposal(proposal.id, reason))}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
                >
                  {pending ? "Saving" : "Reject"}
                </button>
                <button type="button" onClick={() => setRejecting(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-body hover:bg-page">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (confirm(`Approve "${proposal.title}"? It becomes a new prompt version and scores every new clip from now on.`)) act(() => approveProposal(proposal.id));
                }}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
              >
                {pending ? "Saving" : "Approve"}
              </button>
              <button type="button" onClick={() => setRejecting(true)} className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-body hover:bg-page">
                Reject
              </button>
            </div>
          )}
        </div>
      )}
      {result && (
        <p role="status" className={`text-sm ${result.ok ? "text-muted" : "text-red-600"}`}>
          {result.message}
        </p>
      )}
    </article>
  );
}

function StatusBadge({ proposal }: { proposal: Proposal }) {
  if (proposal.status === "approved")
    return <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">Approved as v{proposal.resultingVersion}</span>;
  if (proposal.status === "rejected") return <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700">Rejected</span>;
  return <span className="rounded-full bg-primary-tint px-2.5 py-0.5 text-xs font-medium text-primary">Waiting for you</span>;
}
