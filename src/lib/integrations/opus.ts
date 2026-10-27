import "server-only";
import { isIntegrationConnected } from "@/lib/integrations/config";
import { fetchJson, requireEnv } from "@/lib/integrations/shared";
import { mockOpusClips, mockOpusProjects, mockOpusScheduledPosts } from "@/lib/mock/opus";

// OpusClip REST API. Docs: https://help.opus.pro/api-reference/overview
// Every function returns mock data when OPUSCLIP_API_KEY isn't set.

const BASE_URL = "https://api.opus.pro/api";

export type OpusProject = {
  id: string;
  title: string | null;
  sourceUrl: string | null;
  createdAt: string | null;
};

export type OpusClip = {
  /** Composite ID as returned by Opus: "{projectId}.{clipId}". */
  id: string;
  /** Bare clip ID. This is what scheduling and posting endpoints expect. */
  clipId: string;
  projectId: string;
  title: string;
  description: string | null;
  hashtags: string[];
  transcript: string;
  durationSeconds: number;
  previewUrl: string | null;
  exportUrl: string | null;
  createdAt: string;
};

export type OpusScheduledPost = {
  scheduleId: string;
  projectId: string;
  clipId: string;
  postAccountId: string;
  publishAt: string;
  title: string;
};

const connected = () => isIntegrationConnected("opus");

function headers(): HeadersInit {
  const h: Record<string, string> = {
    Authorization: `Bearer ${requireEnv("OPUSCLIP_API_KEY")}`,
    "Content-Type": "application/json",
  };
  // Only needed when the API key's user belongs to more than one Opus organization.
  const orgId = process.env.OPUSCLIP_ORG_ID?.trim();
  if (orgId) h["x-opus-org-id"] = orgId;
  return h;
}

// Projects -------------------------------------------------------------------

export type SubmitVideoInput = {
  /** YouTube URL or a public MP4 link to the long-form video. */
  videoUrl: string;
  title?: string;
  /** Allowed clip lengths in seconds, as [min, max] ranges. */
  clipDurations?: [number, number][];
  topicKeywords?: string[];
  /** Opus calls this URL when the project finishes or fails. */
  webhookUrl?: string;
};

/** Submits a long-form video for clipping. Docs: POST /api/clip-projects */
export async function submitVideo(input: SubmitVideoInput): Promise<{ projectId: string }> {
  if (!connected()) {
    const known = mockOpusProjects.find((p) => p.sourceUrl === input.videoUrl);
    return { projectId: known?.id ?? `Pmock${Buffer.from(input.videoUrl).toString("base64url").slice(-10)}` };
  }

  const body = {
    videoUrl: input.videoUrl,
    ...(input.title && { uploadedVideoAttr: { title: input.title } }),
    curationPref: {
      model: "ClipBasic",
      clipDurations: input.clipDurations ?? [[30, 60]],
      ...(input.topicKeywords && { topicKeywords: input.topicKeywords }),
    },
    // Shorts are vertical.
    renderPref: { layoutAspectRatio: "portrait" },
    ...(input.webhookUrl && {
      conclusionActions: [{ type: "WEBHOOK", url: input.webhookUrl, notifyFailure: true }],
    }),
  };
  // TODO(opus): the docs don't show the create-project response body. Confirm where the
  // project ID lives; these are the likely shapes.
  const res = await fetchJson<{ id?: string; projectId?: string; data?: { id?: string; projectId?: string } }>(
    "OpusClip",
    `${BASE_URL}/clip-projects`,
    { method: "POST", headers: headers(), body: JSON.stringify(body) },
  );
  const projectId = res?.data?.projectId ?? res?.data?.id ?? res?.projectId ?? res?.id;
  if (!projectId) throw new Error(`OpusClip: no project ID in create-project response: ${JSON.stringify(res)}`);
  return { projectId };
}

/** Lists clip projects, newest first. */
export async function listProjects(): Promise<OpusProject[]> {
  if (!connected()) return mockOpusProjects;

  // TODO(opus): there is no documented REST endpoint for listing projects (only create,
  // share, and get clips). GET /api/clip-projects is a guess. Confirm with Opus support
  // or the API playground before relying on this.
  type Raw = { id: string; title?: string; videoUrl?: string; createdAt?: string };
  const res = await fetchJson<Raw[] | { data: Raw[] }>("OpusClip", `${BASE_URL}/clip-projects`, { headers: headers() });
  const rows = Array.isArray(res) ? res : res.data;
  return rows.map((p) => ({
    id: p.id,
    title: p.title ?? null,
    sourceUrl: p.videoUrl ?? null,
    createdAt: p.createdAt ?? null,
  }));
}

// Clips ----------------------------------------------------------------------

type RawExportableClip = {
  id: string;
  projectId: string;
  curationId: string;
  title: string;
  description?: string;
  /** One space-separated string, not an array. */
  hashtags?: string;
  text: string;
  durationMs: number;
  uriForPreview?: string;
  uriForExport?: string;
  createdAt: string;
};

function toClip(raw: RawExportableClip): OpusClip {
  return {
    id: raw.id,
    // The docs say curationId can stand in for the bare clip ID.
    clipId: raw.id.split(".")[1] ?? raw.curationId,
    projectId: raw.projectId,
    title: raw.title,
    description: raw.description ?? null,
    hashtags: raw.hashtags?.split(/\s+/).filter(Boolean) ?? [],
    transcript: raw.text,
    durationSeconds: Math.round(raw.durationMs / 1000),
    previewUrl: raw.uriForPreview ?? null,
    exportUrl: raw.uriForExport ?? null,
    createdAt: raw.createdAt,
  };
}

/** Lists the clips Opus cut from a project. Docs: GET /api/exportable-clips?q=findByProjectId */
export async function listClips(projectId: string): Promise<OpusClip[]> {
  if (!connected()) return mockOpusClips.filter((c) => c.projectId === projectId);

  const clips: OpusClip[] = [];
  const pageSize = 50;
  for (let pageNum = 1; ; pageNum++) {
    const params = new URLSearchParams({
      q: "findByProjectId",
      projectId,
      pageNum: String(pageNum),
      pageSize: String(pageSize),
    });
    // TODO(opus): the docs show a bare array response. Confirm whether some accounts get
    // it wrapped in { data } like the social posting endpoints.
    const page = await fetchJson<RawExportableClip[]>("OpusClip", `${BASE_URL}/exportable-clips?${params}`, {
      headers: headers(),
    });
    clips.push(...page.map(toClip));
    if (page.length < pageSize) return clips;
  }
}

/** Gets one clip. clipId may be the bare ID or the composite "{projectId}.{clipId}". */
export async function getClip(projectId: string, clipId: string): Promise<OpusClip | null> {
  // There's no single-clip endpoint, so this filters the project's clips.
  const bare = clipId.includes(".") ? clipId.split(".")[1] : clipId;
  const clips = await listClips(projectId);
  return clips.find((c) => c.clipId === bare) ?? null;
}

/** Returns a download URL for the rendered clip. */
export async function exportClip(projectId: string, clipId: string): Promise<{ downloadUrl: string }> {
  // TODO(opus): there is no documented single-clip export endpoint. Clips already carry
  // uriForExport, and collections can be exported with POST /api/collections/{id}/export.
  // Confirm uriForExport is a signed download URL rather than an internal storage URI.
  const clip = await getClip(projectId, clipId);
  if (!clip) throw new Error(`OpusClip: clip ${clipId} not found in project ${projectId}`);
  if (!clip.exportUrl) throw new Error(`OpusClip: clip ${clipId} has no export URL yet`);
  return { downloadUrl: clip.exportUrl };
}

// Scheduling -------------------------------------------------------------------

export type SchedulePostInput = {
  projectId: string;
  /** Bare clip ID, not the composite ID. */
  clipId: string;
  /** From GET /api/social-accounts?q=mine. One per connected platform account. */
  postAccountId: string;
  /** Required for Instagram business accounts. */
  subAccountId?: string;
  /** Must be in the future. Converted to UTC ISO 8601. */
  publishAt: Date;
  title: string;
  /** Description including hashtags. */
  description?: string;
  /** YouTube only. */
  privacy?: "public" | "private" | "unlisted";
};

/** Schedules a clip to post to one connected account. Docs: POST /api/publish-schedules */
export async function schedulePost(input: SchedulePostInput): Promise<{ scheduleId: string }> {
  if (input.publishAt.getTime() <= Date.now()) throw new Error("publishAt must be in the future");
  if (!connected()) return { scheduleId: `mock_${input.clipId}_${input.publishAt.getTime()}` };

  const body = {
    projectId: input.projectId,
    clipId: input.clipId,
    postAccountId: input.postAccountId,
    ...(input.subAccountId && { subAccountId: input.subAccountId }),
    publishAt: input.publishAt.toISOString(),
    postDetail: {
      title: input.title,
      custom: {
        ...(input.description && { description: input.description }),
        ...(input.privacy && { privacy: input.privacy }),
      },
    },
  };
  const res = await fetchJson<{ data: { scheduleId: string } }>("OpusClip", `${BASE_URL}/publish-schedules`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  return { scheduleId: res.data.scheduleId };
}

/** Lists upcoming scheduled posts. */
export async function listScheduledPosts(): Promise<OpusScheduledPost[]> {
  if (!connected()) return mockOpusScheduledPosts;

  // TODO(opus): there is no documented REST endpoint for listing schedules (only create
  // and DELETE /api/publish-schedules/{scheduleId}). GET /api/publish-schedules and this
  // response shape are guesses. Until confirmed, the posts table is the source of truth
  // for what was scheduled.
  type Raw = OpusScheduledPost;
  const res = await fetchJson<Raw[] | { data: Raw[] }>("OpusClip", `${BASE_URL}/publish-schedules`, {
    headers: headers(),
  });
  return Array.isArray(res) ? res : res.data;
}
