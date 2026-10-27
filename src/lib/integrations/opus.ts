import "server-only";
import { isIntegrationConnected } from "@/lib/integrations/config";
import { fetchJson, requireEnv } from "@/lib/integrations/shared";
import { mockOpusClips, mockOpusClipsFor, mockOpusProjects, mockOpusScheduledPosts, mockSocialAccounts } from "@/lib/mock/opus";

// OpusClip REST API. Docs: https://help.opus.pro/api-reference/overview
// Every function returns mock data when OPUSCLIP_API_KEY isn't set.

const BASE_URL = "https://api.opus.pro/api";
const WEB_URL = "https://clip.opus.pro";

export type OpusProject = {
  /** The "P..." project ID that every other endpoint takes. */
  id: string;
  title: string | null;
  sourceUrl: string | null;
  createdAt: string | null;
  /** "COMPLETE" once clips are ready. */
  stage: string | null;
  clipCount: number | null;
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
  /** Opus's own virality score, 0 to 100. */
  opusScore: number | null;
  /** Signed media URLs. They expire about a day after the request, so don't store them. */
  previewUrl: string | null;
  thumbnailUrl: string | null;
  exportUrl: string | null;
  createdAt: string;
};

/**
 * Opens one clip in the OpusClip web editor. This is the route the web app itself uses
 * (/clip/{projectId} is the public share page and needs the project to be shared).
 * It only works when the browser is signed in to the workspace the API key belongs to.
 */
export function opusEditorUrl(projectId: string, clipId: string) {
  const params = new URLSearchParams({ editType: "normal", clipId });
  return `${WEB_URL}/editor-ux/${projectId}.${clipId}?${params}`;
}

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
  /** Applies a saved brand template (captions, fonts, layout). See findBrandTemplateId. */
  brandTemplateId?: string;
};

/** Submits a long-form video for clipping. Docs: POST /api/clip-projects */
export async function submitVideo(input: SubmitVideoInput): Promise<{ projectId: string }> {
  if (!connected()) {
    const known = mockOpusProjects.find((p) => p.sourceUrl === input.videoUrl);
    return { projectId: known?.id ?? `Pmock${Buffer.from(input.videoUrl).toString("base64url").slice(-10)}` };
  }

  const body = {
    videoUrl: input.videoUrl,
    ...(input.brandTemplateId && { brandTemplateId: input.brandTemplateId }),
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
  // Projects also carry an internal record ID; the "P..." one is what every other endpoint takes.
  const candidates = [res?.data?.projectId, res?.data?.id, res?.projectId, res?.id].filter(Boolean) as string[];
  const projectId = candidates.find((id) => /^P\w+$/.test(id)) ?? candidates[0];
  if (!projectId) throw new Error(`OpusClip: no project ID in create-project response: ${JSON.stringify(res)}`);
  return { projectId };
}

type RawProject = {
  /** Internal record ID. Not accepted by other endpoints. */
  id: string;
  projectId: string;
  title?: string;
  createdAt?: string;
  stage?: string;
  clipCount?: number;
  sourceInfo?: { type?: string; videoId?: string; title?: string };
};

/**
 * The project's processing stage ("COMPLETE" once clips are ready), or null when it
 * isn't in the project list yet. Mock projects are always complete.
 */
export async function getProjectStage(projectId: string): Promise<string | null> {
  if (!connected()) return "COMPLETE";
  const project = (await listProjects()).find((p) => p.id === projectId);
  return project?.stage ?? null;
}

/**
 * The brand template to clip with: OPUSCLIP_BRAND_TEMPLATE_ID, or else the organization's
 * template whose name starts with "Aced". Null when neither exists.
 */
export async function findBrandTemplateId(): Promise<string | null> {
  const configured = process.env.OPUSCLIP_BRAND_TEMPLATE_ID?.trim();
  if (configured) return configured;
  if (!connected()) return "mock-aced-template";
  type Raw = { templateId?: string; id?: string; name?: string };
  const res = await fetchJson<Raw[] | { data: Raw[] }>("OpusClip", `${BASE_URL}/brand-templates?q=mine`, { headers: headers() });
  const template = (Array.isArray(res) ? res : res.data).find((t) => /^aced\b/i.test(t.name ?? ""));
  return template?.templateId ?? template?.id ?? null;
}

export type OpusSocialAccount = {
  postAccountId: string;
  /** e.g. "YOUTUBE", "TIKTOK_BUSINESS", "INSTAGRAM_BUSINESS". */
  platform: string;
  /** The channel or account name. */
  name: string;
};

/** Social accounts connected to the Opus organization. Docs: GET /api/social-accounts */
export async function listSocialAccounts(): Promise<OpusSocialAccount[]> {
  if (!connected()) return mockSocialAccounts;
  type Raw = { postAccountId: string; platform: string; extUserName?: string };
  const res = await fetchJson<{ data: Raw[] }>("OpusClip", `${BASE_URL}/social-accounts?q=mine`, { headers: headers() });
  return res.data.map((a) => ({ postAccountId: a.postAccountId, platform: a.platform, name: a.extUserName ?? "" }));
}

/** Lists clip projects, newest first. */
export async function listProjects(): Promise<OpusProject[]> {
  if (!connected()) return mockOpusProjects;

  // Not in the REST docs, but it's what Opus's own CLI uses (opus-pro/opus-skills).
  // Pages start at 0; the response is { list, paging: { hasNext } }.
  const projects: OpusProject[] = [];
  for (let page = 0; ; page++) {
    const params = new URLSearchParams({ page: String(page), pageSize: "100" });
    const res = await fetchJson<{ list: RawProject[]; paging?: { hasNext?: boolean } }>(
      "OpusClip",
      `${BASE_URL}/clip-projects?${params}`,
      { headers: headers() },
    );
    projects.push(
      ...res.list.map((p) => ({
        id: p.projectId,
        title: p.title ?? p.sourceInfo?.title ?? null,
        sourceUrl:
          p.sourceInfo?.type === "YOUTUBE" && p.sourceInfo.videoId
            ? `https://www.youtube.com/watch?v=${p.sourceInfo.videoId}`
            : null,
        createdAt: p.createdAt ?? null,
        stage: p.stage ?? null,
        clipCount: p.clipCount ?? null,
      })),
    );
    if (!res.paging?.hasNext || res.list.length === 0) return projects;
  }
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
  score?: number;
  uriForPreview?: string;
  uriForThumbnail?: string;
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
    // Opus marks pauses with "__silence" tokens in the clip text.
    transcript: raw.text.replace(/\s*__silence\s*/g, " ").trim(),
    durationSeconds: Math.round(raw.durationMs / 1000),
    opusScore: raw.score ?? null,
    previewUrl: raw.uriForPreview ?? null,
    thumbnailUrl: raw.uriForThumbnail ?? null,
    exportUrl: raw.uriForExport ?? null,
    createdAt: raw.createdAt,
  };
}

/** Lists the clips Opus cut from a project. Docs: GET /api/exportable-clips?q=findByProjectId */
export async function listClips(projectId: string): Promise<OpusClip[]> {
  if (!connected()) {
    const known = mockOpusClips.filter((c) => c.projectId === projectId);
    return known.length ? known : mockOpusClipsFor(projectId);
  }

  // The docs show a bare array and pageNum/pageSize params. In practice the response is
  // { data, total } and the paging params are ignored: every clip comes back at once.
  const params = new URLSearchParams({ q: "findByProjectId", projectId });
  const res = await fetchJson<RawExportableClip[] | { data: RawExportableClip[] }>(
    "OpusClip",
    `${BASE_URL}/exportable-clips?${params}`,
    { headers: headers() },
  );
  return (Array.isArray(res) ? res : res.data).map(toClip);
}

// Signed media URLs last about a day, so a short cache keeps page loads within the
// 30 requests per minute rate limit without serving expired links.
const MEDIA_CACHE_MS = 30 * 60 * 1000;
const clipsCache = new Map<string, { at: number; clips: Promise<OpusClip[]> }>();

/** listClips with a 30 minute in-memory cache. For display only; syncing calls listClips. */
export function listClipsCached(projectId: string): Promise<OpusClip[]> {
  const hit = clipsCache.get(projectId);
  if (hit && Date.now() - hit.at < MEDIA_CACHE_MS) return hit.clips;
  const clips = listClips(projectId);
  clipsCache.set(projectId, { at: Date.now(), clips });
  clips.catch(() => clipsCache.delete(projectId));
  return clips;
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
