import { runScoring } from "@/lib/clip-scoring";
import { addUsage, emptyUsage, estimateCostUsd, scoreClip, SCORING_MODEL } from "@/lib/integrations/claude";
import { listClips, submitVideo } from "@/lib/integrations/opus";
import { listRecentUploads } from "@/lib/integrations/youtube";
import { formatFromTitle, saveOpusClips } from "@/lib/opus-sync";
import { must, runJob, type JobContext } from "./lib";

// Weekly candidates:
//   1. Check the channel for long-form uploads we haven't seen and submit them to Opus.
//   2. Import clips from Opus projects that have finished processing.
//   3. Score every unscored clip. Clips under 3 on Hook or Standalone are rejected.
// Opus takes a while to process, so clips from a video submitted in step 1 usually
// arrive on the next run.

const UPLOADS_TO_CHECK = 25;
const DRY_RUN_SCORE_LIMIT = 3;

async function submitNewUploads({ db, dryRun, log }: JobContext) {
  const uploads = await listRecentUploads({ limit: UPLOADS_TO_CHECK });
  let fresh = uploads;
  if (db) {
    const known = must(
      await db.from("source_videos").select("youtube_url").in("youtube_url", uploads.map((u) => u.url)),
      "load known source videos",
    );
    const knownUrls = new Set(known.map((k) => k.youtube_url));
    fresh = uploads.filter((u) => !knownUrls.has(u.url));
  }
  log(`Checked ${uploads.length} recent long-form uploads: ${fresh.length} new.`);

  for (const upload of fresh) {
    if (dryRun) {
      log(`  Would submit "${upload.title}" to Opus.`);
      continue;
    }
    // Submit before inserting, so a failed submit is retried on the next run.
    const { projectId } = await submitVideo({ videoUrl: upload.url, title: upload.title });
    must(
      await db!.from("source_videos").insert({
        youtube_url: upload.url,
        title: upload.title,
        duration_seconds: upload.durationSeconds,
        channel: upload.channelTitle,
        opus_project_id: projectId,
      }).select("id"),
      `save source video ${upload.url}`,
    );
    log(`  Submitted "${upload.title}" to Opus as project ${projectId}.`);
  }
}

async function importFinishedProjects({ db, log }: JobContext) {
  if (!db) return;
  const videos = must(
    await db.from("source_videos").select("id, title, opus_project_id, clips (id)").not("opus_project_id", "is", null),
    "load submitted source videos",
  );
  const waiting = videos.filter((v) => v.clips.length === 0);
  if (waiting.length === 0) return log("No Opus projects waiting for clips.");

  for (const video of waiting) {
    const clips = await listClips(video.opus_project_id!);
    if (clips.length === 0) {
      log(`  "${video.title}": Opus is still processing.`);
      continue;
    }
    const added = await saveOpusClips(db, video, clips);
    log(`  "${video.title}": imported ${added} clips from Opus.`);
  }
}

async function scoreUnscored({ db, log }: JobContext) {
  if (db) {
    const run = await runScoring(db, { log });
    log(`Scored ${run.scored}: ${run.scored - run.cut} kept as candidates, ${run.cut} cut (${run.noSpeaker} no speaker), ${run.failed.length} failed.`);
    return;
  }

  // Dry run: score a few clips from Opus (mock data when Opus isn't connected) to show the output.
  const uploads = await listRecentUploads({ limit: 1 });
  // With a live Opus key there's no project to preview, so nothing is scored.
  const projectId = uploads[0] ? await submitVideoPreview(uploads[0].url) : null;
  const clips = (projectId ? await listClips(projectId) : []).slice(0, DRY_RUN_SCORE_LIMIT);
  log(`Scoring ${clips.length} clips with ${SCORING_MODEL}. Nothing is saved.`);
  let usage = emptyUsage();
  for (const clip of clips) {
    const score = await scoreClip({
      title: clip.title,
      transcript: clip.transcript,
      sourceVideoTitle: uploads[0].title,
      format: formatFromTitle(uploads[0].title),
      durationSeconds: clip.durationSeconds,
    });
    usage = addUsage(usage, score.usage);
    log(`  ${score.cut ? "Cut" : "Kept"} "${clip.title}": ${score.total}/25. ${score.reasoning}`);
  }
  log(`Tokens: ${usage.input} input, ${usage.output} output. Estimated cost: $${(estimateCostUsd(SCORING_MODEL, usage) ?? 0).toFixed(4)}.`);
}

/** In a dry run, find the Opus project for a URL without submitting anything. */
async function submitVideoPreview(url: string) {
  // Only the mock client is safe to call here; a live submit would create a real project.
  if (process.env.OPUSCLIP_API_KEY?.trim()) return null;
  return (await submitVideo({ videoUrl: url })).projectId;
}

runJob("Weekly candidates", async (ctx) => {
  await submitNewUploads(ctx);
  await importFinishedProjects(ctx);
  await scoreUnscored(ctx);
});
