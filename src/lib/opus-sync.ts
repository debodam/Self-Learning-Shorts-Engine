import "server-only";
import type { ClipFormat } from "@/lib/clips";
import type { Db } from "@/lib/db/client";
import { listClips, listProjects, type OpusClip } from "@/lib/integrations/opus";
import { getChannelTitle } from "@/lib/integrations/youtube";

// Pulls clips from an OpusClip project into Supabase. Safe to run any number of times:
// source videos are matched by Opus project ID or YouTube URL, and clips by Opus clip ID,
// so a second run only adds clips that weren't there before. Existing clips are never
// changed, so scores, approvals, and edited titles survive a re-sync.

// TODO: format comes from the source video title for now. Store it on source_videos if
// titles stop following the "Mock Interview" convention.
export const formatFromTitle = (title: string): ClipFormat => (/mock interview/i.test(title) ? "mock" : "conversational");

export type SyncResult = {
  projectTitle: string;
  /** False when the source video row already existed. */
  createdSourceVideo: boolean;
  clipsFound: number;
  clipsAdded: number;
};

/** Saves clips as candidates under a source video, skipping any already saved. Returns how many were new. */
export async function saveOpusClips(db: Db, sourceVideo: { id: string; title: string }, clips: OpusClip[]) {
  if (clips.length === 0) return 0;
  const rows = clips.map((c) => ({
    source_video_id: sourceVideo.id,
    opus_clip_id: c.id,
    title: c.title,
    transcript: c.transcript,
    duration_seconds: c.durationSeconds || null,
    format: formatFromTitle(sourceVideo.title),
    status: "candidate" as const,
  }));
  // ignoreDuplicates is ON CONFLICT DO NOTHING, so only new rows come back.
  const { data, error } = await db
    .from("clips")
    .upsert(rows, { onConflict: "opus_clip_id", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`Failed to save clips for "${sourceVideo.title}": ${error.message}`);
  return data.length;
}

export async function syncOpusProject(db: Db, projectId: string): Promise<SyncResult> {
  const project = (await listProjects()).find((p) => p.id === projectId);
  if (!project) throw new Error(`OpusClip project ${projectId} not found`);
  if (!project.sourceUrl) throw new Error(`OpusClip project ${projectId} isn't from a YouTube video, so it can't be synced yet`);
  const title = project.title ?? project.sourceUrl;

  // The same YouTube video can be clipped in more than one Opus project. Those share one
  // source video row, since youtube_url is unique.
  const { data: existing, error: findError } = await db
    .from("source_videos")
    .select("id, title, opus_project_id")
    // Quoted, since URLs contain characters PostgREST filters treat as syntax.
    .or(`opus_project_id.eq."${projectId}",youtube_url.eq."${project.sourceUrl}"`)
    .limit(1)
    .maybeSingle();
  if (findError) throw new Error(`Failed to look up source video: ${findError.message}`);

  let sourceVideo = existing;
  if (!sourceVideo) {
    const { data, error } = await db
      .from("source_videos")
      .insert({
        youtube_url: project.sourceUrl,
        title,
        channel: (await getChannelTitle(project.sourceUrl)) ?? "",
        opus_project_id: projectId,
      })
      .select("id, title, opus_project_id")
      .single();
    if (error) throw new Error(`Failed to save source video "${title}": ${error.message}`);
    sourceVideo = data;
  } else if (!sourceVideo.opus_project_id) {
    const { error } = await db.from("source_videos").update({ opus_project_id: projectId }).eq("id", sourceVideo.id);
    if (error) throw new Error(`Failed to link source video "${title}" to Opus: ${error.message}`);
  }

  const clips = await listClips(projectId);
  const clipsAdded = await saveOpusClips(db, sourceVideo, clips);
  return { projectTitle: title, createdSourceVideo: !existing, clipsFound: clips.length, clipsAdded };
}
