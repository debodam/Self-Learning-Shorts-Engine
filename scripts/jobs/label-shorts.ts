import { labelShorts } from "@/lib/short-labels";
import { runJob } from "./lib";

// Labels every YouTube Short's format with Claude Haiku (mock interview, conversational,
// explainer, or other) from its title, description, and thumbnail. Pass --all to
// relabel Shorts that already have a label. Prints the label breakdown and the cost.

runJob("Label Shorts", async ({ db, log }) => {
  if (!db) throw new Error("Labeling writes to Supabase, so it can't run as a dry run.");
  const run = await labelShorts(db, { all: process.argv.includes("--all"), log });
  if (!run) throw new Error("Claude isn't connected.");

  const { data, error } = await db.from("youtube_shorts").select("format, format_confidence");
  if (error) throw new Error(`Failed to load labels: ${error.message}`);
  const counts = new Map<string, { total: number; high: number; medium: number; low: number }>();
  for (const row of data) {
    const key = row.format ?? "unlabeled";
    const c = counts.get(key) ?? { total: 0, high: 0, medium: 0, low: 0 };
    c.total++;
    if (row.format_confidence === "high" || row.format_confidence === "medium" || row.format_confidence === "low") c[row.format_confidence]++;
    counts.set(key, c);
  }
  log("Labels:");
  for (const [format, c] of [...counts].sort((a, b) => b[1].total - a[1].total)) {
    log(`  ${format}: ${c.total} (high ${c.high}, medium ${c.medium}, low ${c.low})`);
  }
  if (run.failed.length) {
    throw new Error(`${run.failed.length} Shorts couldn't be labeled: ${run.failed.map((f) => `"${f.title}" (${f.error})`).join(", ")}`);
  }
});
