import "server-only";
import { SCORING_SYSTEM_PROMPT } from "@/lib/agent/prompts";
import type { Db } from "@/lib/db/client";

// Versioned scoring prompts. The active version in Supabase scores every clip; the
// prompt in src/lib/agent/prompts.ts only seeds version 1. New versions come from
// approved proposals on the Learnings page, never automatically.

export type PromptVersion = { id: string; version: number; text: string; notes: string; active: boolean; createdAt: string; proposalId: string | null };

const toVersion = (r: { id: string; version: number; text: string; notes: string; active: boolean; created_at: string; proposal_id: string | null }): PromptVersion => ({
  id: r.id,
  version: r.version,
  text: r.text,
  notes: r.notes,
  active: r.active,
  createdAt: r.created_at,
  proposalId: r.proposal_id,
});

/** The active scoring prompt. Seeds version 1 from the code the first time. */
export async function getActivePrompt(db: Db): Promise<PromptVersion> {
  const { data, error } = await db.from("prompt_versions").select("*").eq("active", true).maybeSingle();
  if (error) throw new Error(`Failed to load the active prompt: ${error.message}`);
  if (data) return toVersion(data);

  const { count, error: countError } = await db.from("prompt_versions").select("*", { count: "exact", head: true });
  if (countError) throw new Error(`Failed to check prompt versions: ${countError.message}`);
  if (count) throw new Error("No prompt version is active. Pick one on the Learnings page.");
  const { data: seeded, error: seedError } = await db
    .from("prompt_versions")
    .insert({ version: 1, text: SCORING_SYSTEM_PROMPT, notes: "Initial scoring prompt and rubric.", active: true })
    .select("*")
    .single();
  // A concurrent seed wins the unique version; read that one.
  if (seedError) {
    const { data: again, error: againError } = await db.from("prompt_versions").select("*").eq("active", true).single();
    if (againError) throw new Error(`Failed to seed prompt version 1: ${seedError.message}`);
    return toVersion(again);
  }
  return toVersion(seeded);
}

export async function listPromptVersions(db: Db): Promise<PromptVersion[]> {
  const { data, error } = await db.from("prompt_versions").select("*").order("version", { ascending: false });
  if (error) throw new Error(`Failed to load prompt versions: ${error.message}`);
  return data.map(toVersion);
}

/** Makes one version active. The partial unique index allows only one at a time. */
export async function activatePromptVersion(db: Db, version: number) {
  const { data: target, error } = await db.from("prompt_versions").select("id").eq("version", version).single();
  if (error) throw new Error(`Prompt version ${version} doesn't exist.`);
  const { error: offError } = await db.from("prompt_versions").update({ active: false }).eq("active", true).neq("id", target.id);
  if (offError) throw new Error(`Failed to deactivate the current version: ${offError.message}`);
  const { error: onError } = await db.from("prompt_versions").update({ active: true }).eq("id", target.id);
  if (onError) throw new Error(`Failed to activate version ${version}: ${onError.message}`);
}

/** Creates the next version and makes it active. */
export async function createPromptVersion(db: Db, input: { text: string; notes: string; proposalId?: string }) {
  const { data: latest, error } = await db.from("prompt_versions").select("version").order("version", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Failed to load prompt versions: ${error.message}`);
  const version = (latest?.version ?? 0) + 1;
  const { error: insertError } = await db
    .from("prompt_versions")
    .insert({ version, text: input.text, notes: input.notes, proposal_id: input.proposalId ?? null, active: false });
  if (insertError) throw new Error(`Failed to save version ${version}: ${insertError.message}`);
  await activatePromptVersion(db, version);
  return version;
}

/** Applies an exact text change. Throws unless old_text appears exactly once. */
export function applyTextChange(text: string, oldText: string, newText: string) {
  const first = text.indexOf(oldText);
  if (!oldText || first === -1) throw new Error("The text to replace isn't in the prompt anymore.");
  if (text.indexOf(oldText, first + 1) !== -1) throw new Error("The text to replace appears more than once in the prompt.");
  return text.slice(0, first) + newText + text.slice(first + oldText.length);
}
