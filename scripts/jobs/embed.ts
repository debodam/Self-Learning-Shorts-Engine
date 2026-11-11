import { embedMissing } from "@/lib/embeddings";
import { voyageConnected } from "@/lib/integrations/voyage";
import { runJob } from "./lib";

// Embeds every clip and YouTube Short that doesn't have a Voyage embedding yet, so the
// scoring agent can find similar past Shorts. Shorts wait for their format label first,
// so run it after the metrics pull. Pass --all to re-embed everything.
//
// GitHub Actions runs it daily after the metrics pull with REQUIRE_LIVE=true, so a
// missing key fails the run.

runJob("Embed clips and Shorts", async ({ db, log }) => {
  if (!voyageConnected()) {
    if (process.env.REQUIRE_LIVE === "true") throw new Error("VOYAGE_API_KEY is missing. Add it under Settings > Secrets and variables > Actions.");
    log("Voyage isn't connected, so nothing was embedded.");
    return;
  }
  if (!db) {
    if (process.env.REQUIRE_LIVE === "true") throw new Error("Supabase secrets are missing, so nothing can be embedded.");
    log("Dry run: nothing was embedded.");
    return;
  }
  await embedMissing(db, { all: process.argv.includes("--all"), log });
});
