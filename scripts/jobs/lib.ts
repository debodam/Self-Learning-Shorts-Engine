import { appendFileSync } from "node:fs";
import { getDb, type Db } from "@/lib/db/client";
import { integrations, integrationStatus } from "@/lib/integrations/config";

// Shared setup for the scheduled jobs in this folder. Run them with `npm run job:<name>`.

export type JobContext = {
  /** Null in a dry run. */
  db: Db | null;
  dryRun: boolean;
  log: (line: string) => void;
};

/**
 * Runs a job. It's a dry run (reads only, no writes to Supabase or Opus) when --dry-run
 * or DRY_RUN=true is passed, or when Supabase isn't configured.
 */
export async function runJob(name: string, job: (ctx: JobContext) => Promise<void>) {
  const requested = process.argv.includes("--dry-run") || process.env.DRY_RUN === "true";
  const db = requested ? null : getDb();
  const dryRun = db === null;
  const summary: string[] = [`## ${name}`, ""];
  const log = (line: string) => {
    console.log(line);
    summary.push(line.startsWith("  ") ? `  - ${line.trim()}` : `- ${line}`);
  };

  const status = integrations.map((i) => `${i.name} ${integrationStatus(i).connected ? "live" : "mock"}`);
  log(`Integrations: ${status.join(", ")}`);
  if (dryRun) {
    log(requested ? "Dry run requested: nothing will be written." : "Supabase isn't configured, so this is a dry run: nothing will be written.");
  }

  try {
    await job({ db, dryRun, log });
    log("Done.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(error);
    summary.push("", `**Failed:** ${message}`);
    process.exitCode = 1;
  } finally {
    // Shows on the workflow run page in GitHub Actions.
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.join("\n")}\n`);
  }
}

/** Throws with context when a Supabase call fails, and narrows away null data. */
export function must<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error || result.data === null) throw new Error(`Failed to ${what}: ${result.error?.message ?? "no data returned"}`);
  return result.data;
}
