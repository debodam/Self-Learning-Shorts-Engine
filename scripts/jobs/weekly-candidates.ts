import type { SimilarClip } from "@/lib/agent/prompts";
import type { ClipFormat } from "@/lib/clips";
import type { Db } from "@/lib/db/client";
import { scoreClip } from "@/lib/integrations/claude";
import { listClips, submitVideo } from "@/lib/integrations/opus";
import { listRecentUploads } from "@/lib/integrations/youtube";
import { must, runJob, type JobContext } from "./lib";

// Weekly candidates:
//   1. Check the channel for long-form uploads we haven't seen and submit them to Opus.
//   2. Import clips from Opus projects that have finished processing.
//   3. Score every unscored clip. Clips under 3 on Hook or Standalone are rejected.
// Opus takes a while to process, so clips from a video submitted in step 1 usually
// arrive on the next run.

const UPLOADS_TO_CHECK = 25;
const PAST_CLIPS_FOR_CALIBRATION = 20;
const DRY_RUN_SCORE_LIMIT = 3;

// TODO: format comes from the source video title for now. Store it on source_videos if
// titles stop following the "Mock Interview" convention.
const formatFromTitle = (title: string): ClipFormat => (/mock interview/i.test(title) ? "mock" : "conversational");

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
    const rows = clips.map((c) => ({
      source_video_id: video.id,
      opus_clip_id: c.id,
      title: c.title,
      transcript: c.transcript,
      duration_seconds: c.durationSeconds || null,
      format: formatFromTitle(video.title),
      status: "candidate" as const,
    }));
    must(
      await db.from("clips").upsert(rows, { onConflict: "opus_clip_id", ignoreDuplicates: true }).select("id"),
      `save clips for ${video.title}`,
    );
    log(`  "${video.title}": imported ${clips.length} clips from Opus.`);
  }
}

/** Recently posted clips with their latest views, so the agent can calibrate predictions. */
async function loadPastClips(db: Db): Promise<SimilarClip[]> {
  const rows = must(
    await db
      .from("clips")
      .select("title, format, hook_type, score_total, posts (platform, metrics (views, captured_at))")
      .eq("status", "posted")
      .order("created_at", { ascending: false })
      .order("captured_at", { referencedTable: "posts.metrics", ascending: false })
      .limit(1, { referencedTable: "posts.metrics" })
      .limit(PAST_CLIPS_FOR_CALIBRATION),
    "load past clips",
  );
  return rows.map((r) => ({
    title: r.title,
    format: r.format,
    hookType: r.hook_type,
    scoreTotal: r.score_total,
    views: Object.fromEntries(r.posts.flatMap((p) => (p.metrics[0]?.views != null ? [[p.platform, p.metrics[0].views]] : []))),
  }));
}

async function scoreUnscoredClips({ db, dryRun, log }: JobContext) {
  type Unscored = { id: string; title: string; transcript: string | null; format: ClipFormat; duration_seconds: number | null; source: string };
  let unscored: Unscored[];
  let pastClips: SimilarClip[] = [];

  if (db) {
    const rows = must(
      await db
        .from("clips")
        .select("id, title, transcript, format, duration_seconds, source_videos (title)")
        .eq("status", "candidate")
        .is("scored_at", null),
      "load unscored clips",
    );
    unscored = rows.map((r) => ({ ...r, source: r.source_videos.title }));
    pastClips = await loadPastClips(db);
  } else {
    // Dry run: score a few clips from Opus (mock data when Opus isn't connected) to show the output.
    const uploads = await listRecentUploads({ limit: 1 });
    const clips = uploads[0] ? await listClips((await submitVideoPreview(uploads[0].url)) ?? "") : [];
    unscored = clips.slice(0, DRY_RUN_SCORE_LIMIT).map((c) => ({
      id: c.id,
      title: c.title,
      transcript: c.transcript,
      format: formatFromTitle(uploads[0].title),
      duration_seconds: c.durationSeconds,
      source: uploads[0].title,
    }));
  }
  log(`Scoring ${unscored.length} clips with ${pastClips.length} past clips for calibration.`);

  let kept = 0;
  for (const clip of unscored) {
    if (!clip.transcript) {
      log(`  Skipped "${clip.title}": no transcript.`);
      continue;
    }
    const score = await scoreClip(
      { title: clip.title, transcript: clip.transcript, sourceVideoTitle: clip.source, format: clip.format, durationSeconds: clip.duration_seconds },
      pastClips.filter((p) => p.format === clip.format),
    );
    if (!score.cut) kept++;
    log(`  ${score.cut ? "Cut" : "Kept"} "${clip.title}": ${score.total}/25, predicted ${score.predictedViews.tiktok} TikTok views.`);
    if (dryRun) continue;

    must(
      await db!
        .from("clips")
        .update({
          score_hook: score.scores.hook,
          score_tension: score.scores.tension,
          score_standalone: score.scores.standalone,
          score_payoff: score.scores.payoff,
          score_loopability: score.scores.loopability,
          hook_type: score.hookType,
          predicted_views_youtube: score.predictedViews.youtube,
          predicted_views_tiktok: score.predictedViews.tiktok,
          predicted_views_instagram: score.predictedViews.instagram,
          score_reasoning: score.reasoning,
          scored_at: new Date().toISOString(),
          status: score.cut ? "rejected" : "candidate",
        })
        .eq("id", clip.id)
        .select("id"),
      `save score for ${clip.title}`,
    );
  }
  log(`Scored ${unscored.length}: ${kept} kept as candidates, ${unscored.length - kept} cut.`);
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
  await scoreUnscoredClips(ctx);
});
