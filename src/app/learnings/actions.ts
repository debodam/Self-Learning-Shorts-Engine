"use server";

import { requireSession } from "@/lib/auth/require";
import { after } from "next/server";
import { refresh } from "next/cache";
import { getDb } from "@/lib/db/client";
import { isIntegrationConnected } from "@/lib/integrations/config";
import { activatePromptVersion, applyTextChange, createPromptVersion } from "@/lib/prompt-versions";
import { runWeeklyReport } from "@/lib/weekly-report";

export type LoopActionResult = { ok: boolean; message: string };

const fail = (message: string): LoopActionResult => ({ ok: false, message });
const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

// Each action checks the dashboard session first (requireSession). Per-user accounts
// come later; until then anyone with the password can use them.

/** Applies a proposal's text change to its base version as a new, active version. */
export async function approveProposal(proposalId: string): Promise<LoopActionResult> {
  await requireSession();
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
  await requireSession();
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
  await requireSession();
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
 * Starts the weekly report and returns right away; the page shows it running until it
 * finishes. It takes about 10 minutes, longer than a Vercel function may run, so when
 * GITHUB_DISPATCH_TOKEN and GITHUB_REPOSITORY are set (on Vercel) it starts the Weekly
 * report workflow in GitHub Actions. Otherwise (local dev) it runs in this server after
 * the response. Spends Claude credits: about $1 to $2 per run.
 */
export async function runWeeklyReportNow(): Promise<LoopActionResult> {
  await requireSession();
  const db = getDb();
  if (!db) return fail("Connect Supabase first.");
  const { data: running } = await db.from("report_runs").select("id, started_at").eq("status", "running").gte("started_at", new Date(Date.now() - 60 * 60 * 1000).toISOString()).limit(1);
  if (running?.length) return fail("A weekly report is already running.");

  // On Vercel: run it in GitHub Actions, since it outlasts a Vercel function.
  const token = process.env.GITHUB_DISPATCH_TOKEN?.trim();
  // Vercel exposes the connected repo as VERCEL_GIT_REPO_OWNER and VERCEL_GIT_REPO_SLUG.
  const vercelRepo = process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG ? `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}` : undefined;
  const repository = process.env.GITHUB_REPOSITORY?.trim() || vercelRepo;
  if (token && repository) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) return fail("GITHUB_REPOSITORY must look like owner/repo.");
    const res = await fetch(`https://api.github.com/repos/${repository}/actions/workflows/weekly-report.yml/dispatches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      body: JSON.stringify({ ref: process.env.GITHUB_DISPATCH_REF?.trim() || "main" }),
    });
    if (!res.ok) return fail(`GitHub didn't start the workflow (${res.status}). Check that GITHUB_DISPATCH_TOKEN can run Actions on ${repository}.`);
    refresh();
    return { ok: true, message: "Started in GitHub Actions. It takes about 10 minutes; this page shows it once the run begins." };
  }

  // Locally: run it in this server after the response.
  if (!isIntegrationConnected("claude")) return fail("Connect Claude first.");
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
