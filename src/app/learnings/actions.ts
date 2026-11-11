"use server";

import { after } from "next/server";
import { refresh } from "next/cache";
import { getDb } from "@/lib/db/client";
import { isIntegrationConnected } from "@/lib/integrations/config";
import { activatePromptVersion, applyTextChange, createPromptVersion } from "@/lib/prompt-versions";
import { runWeeklyReport } from "@/lib/weekly-report";

export type LoopActionResult = { ok: boolean; message: string };

const fail = (message: string): LoopActionResult => ({ ok: false, message });
const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

// TODO(auth): check the signed-in user in each of these once auth exists.

/** Applies a proposal's text change to its base version as a new, active version. */
export async function approveProposal(proposalId: string): Promise<LoopActionResult> {
  if (!isId(proposalId)) return fail("Unknown proposal.");
  const db = getDb();
  if (!db) return fail("Connect Supabase first.");
  const { data: p, error } = await db.from("prompt_proposals").select("*").eq("id", proposalId).single();
  if (error) return fail("That proposal doesn't exist.");
  if (p.status !== "pending") return fail(`That proposal was already ${p.status}.`);
  const { data: base, error: baseError } = await db.from("prompt_versions").select("text").eq("version", p.base_version).single();
  if (baseError) return fail(`Prompt version ${p.base_version} is missing.`);
  try {
    const text = applyTextChange(base.text, p.old_text, p.new_text);
    const version = await createPromptVersion(db, { text, notes: `${p.title} (approved proposal)`, proposalId });
    await db.from("prompt_proposals").update({ status: "approved", decided_at: new Date().toISOString(), resulting_version: version }).eq("id", proposalId);
    refresh();
    return { ok: true, message: `Approved. Version ${version} is now active and scores new clips.` };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Couldn't approve the proposal.");
  }
}

export async function rejectProposal(proposalId: string, reason: string): Promise<LoopActionResult> {
  if (!isId(proposalId)) return fail("Unknown proposal.");
  const why = typeof reason === "string" ? reason.trim().slice(0, 1000) : "";
  if (!why) return fail("Say why you're rejecting it, so the next report can learn from it.");
  const db = getDb();
  if (!db) return fail("Connect Supabase first.");
  const { data, error } = await db
    .from("prompt_proposals")
    .update({ status: "rejected", rejection_reason: why, decided_at: new Date().toISOString() })
    .eq("id", proposalId)
    .eq("status", "pending")
    .select("id");
  if (error) return fail(`Couldn't reject it: ${error.message}`);
  if (data.length === 0) return fail("That proposal was already decided.");
  refresh();
  return { ok: true, message: "Rejected. The reason is saved." };
}

/** Makes an earlier version active again. Nothing is deleted. */
export async function rollBackTo(version: number): Promise<LoopActionResult> {
  if (!Number.isInteger(version) || version < 1) return fail("Unknown version.");
  const db = getDb();
  if (!db) return fail("Connect Supabase first.");
  try {
    await activatePromptVersion(db, version);
    refresh();
    return { ok: true, message: `Version ${version} is active again.` };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Couldn't roll back.");
  }
}

/**
 * Starts the weekly report in the background (it takes several minutes and backtests
 * each proposal) and returns right away. The page shows it running until it finishes.
 * Spends Claude credits: a few dollars per run.
 */
export async function runWeeklyReportNow(): Promise<LoopActionResult> {
  const db = getDb();
  if (!db) return fail("Connect Supabase first.");
  if (!isIntegrationConnected("claude")) return fail("Connect Claude first.");
  const { data: running } = await db.from("report_runs").select("id, started_at").eq("status", "running").gte("started_at", new Date(Date.now() - 60 * 60 * 1000).toISOString()).limit(1);
  if (running?.length) return fail("A weekly report is already running.");
  const { data: run, error } = await db.from("report_runs").insert({ trigger: "button" }).select("id").single();
  if (error) return fail(`Couldn't start the report: ${error.message}`);
  after(async () => {
    try {
      const r = await runWeeklyReport(db, { log: (line) => console.log(`[weekly report] ${line}`) });
      await db.from("report_runs").update({ status: "done", finished_at: new Date().toISOString(), message: `${r.proposals} proposals, about $${r.costUsd.toFixed(2)}` }).eq("id", run.id);
    } catch (e) {
      console.error("Weekly report failed:", e);
      await db.from("report_runs").update({ status: "failed", finished_at: new Date().toISOString(), message: e instanceof Error ? e.message : String(e) }).eq("id", run.id);
    }
  });
  refresh();
  return { ok: true, message: "Started. It takes about 10 minutes; this page updates when it's done." };
}
