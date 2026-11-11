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

export type UploadSession = {
  /** Goes in submitVideo's videoUrl once the file is uploaded. */
  uploadId: string;
  /** Resumable upload URL the browser PUTs the file to. Null in mock mode. */
  uploadUrl: string | null;
};

/**
 * Starts a direct file upload: creates an OpusClip upload link, then opens a resumable
 * Google Cloud Storage session on it. The browser PUTs the file straight to the returned
 * URL, so the video never passes through our server (Vercel caps request size).
 * Docs: https://help.opus.pro/api-reference/endpoints/upload-video-create-project
 *
 * The session is opened with the browser's Origin, because GCS only answers cross-origin
 * requests on a resumable session from the origin that started it.
 */
export async function createUploadSession(origin: string): Promise<UploadSession> {
  if (!connected()) return { uploadId: `upload-mock-${Date.now()}`, uploadUrl: null };

  const link = await fetchJson<{ url?: string; uploadId?: string; data?: { url?: string; uploadId?: string } }>("OpusClip", `${BASE_URL}/upload-links`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ video: { usecase: "LocalUpload" } }),
  });
  const url = link.url ?? link.data?.url;
  const uploadId = link.uploadId ?? link.data?.uploadId;
  if (!url || !uploadId) throw new Error("OpusClip didn't return an upload link.");

  const start = await fetch(url, { method: "POST", headers: { "x-goog-resumable": "start", "Content-Length": "0", Origin: origin } });
  const uploadUrl = start.headers.get("location");
  if (!start.ok || !uploadUrl) throw new Error(`OpusClip's upload storage didn't start the upload (${start.status}).`);
  return { uploadId, uploadUrl };
}

export type SubmitVideoInput = {
  /** YouTube URL, a public MP4 link, or the uploadId of a file uploaded with createUploadSession. */
  videoUrl: string;
  title?: string;
  /** Allowed clip lengths in seconds, as [min, max] ranges. */
  clipDurations?: [number, number][];
  topicKeywords?: string[];
  /** Opus calls this URL when the project finishes or fails. */
  webhookUrl?: string;
  /** Applies a saved brand template (captions, fonts, layout, headline style). See findBrandTemplateId. */
  brandTemplateId?: string;
  /**
   * Auto headline: a one-line title card at the start of each of the top 10 clips. The web
   * app turns it on by default, but the API inherits the org default (off) unless it's set.
   * The brand template only styles it.
   */
  autoHeadline?: boolean;
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
      // Called enableAutoHook in the API; "Auto headline" in the web app.
      ...(input.autoHeadline !== undefined && { enableAutoHook: input.autoHeadline }),
    },
    // A brand template carries its own render settings (vertical layout included), and a
    // partial renderPref could override them, so only set it without a template.
    ...(!input.brandTemplateId && { renderPref: { layoutAspectRatio: "portrait" } }),
    ...(input.webhookUrl && {
      conclusionActions: [{ type: "WEBHOOK", url: input.webhookUrl, notifyFailure: true }],
    }),
  };
  // The exact request, minus the key, so a project's settings can be checked later.
  console.info(`OpusClip submit: POST ${BASE_URL}/clip-projects ${JSON.stringify(body)}`);
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

export type OpusBrandTemplate = { id: string; name: string };

/** The organization's saved brand templates. Docs: GET /api/brand-templates */
export async function listBrandTemplates(): Promise<OpusBrandTemplate[]> {
  if (!connected()) return [{ id: "mock-aced-template", name: "Aced Template #1" }];
  type Raw = { templateId?: string; id?: string; name?: string };
  const res = await fetchJson<Raw[] | { data: Raw[] }>("OpusClip", `${BASE_URL}/brand-templates?q=mine`, { headers: headers() });
  return (Array.isArray(res) ? res : res.data).flatMap((t) => {
    const id = t.templateId ?? t.id;
    return id ? [{ id, name: t.name ?? "" }] : [];
  });
}

/**
 * The brand template to clip with, looked up by name from Opus each time rather than
 * stored: OPUSCLIP_BRAND_TEMPLATE_NAME, default "Aced Template #1". Null if it's missing.
 */
export async function findBrandTemplateId(): Promise<string | null> {
  const name = process.env.OPUSCLIP_BRAND_TEMPLATE_NAME?.trim() || "Aced Template #1";
  const template = (await listBrandTemplates()).find((t) => t.name.trim().toLowerCase() === name.toLowerCase());
  return template?.id ?? null;
}

export type OpusSocialAccount = {
  postAccountId: string;
  /** e.g. "YOUTUBE", "TIKTOK_BUSINESS", "INSTAGRAM_BUSINESS". */
  platform: string;
  /** The channel or account name. */
  name: string;
  /** Instagram business accounts (and Facebook pages) need this when posting. */
  subAccountId: string | null;
  /** e.g. https://www.tiktok.com/@aced_io */
  profileUrl: string | null;
};

/** Social accounts connected to the Opus organization. Docs: GET /api/social-accounts */
export async function listSocialAccounts(): Promise<OpusSocialAccount[]> {
  if (!connected()) return mockSocialAccounts;
  type Raw = { postAccountId: string; platform: string; extUserName?: string; subAccountId?: string; extUserProfileLink?: string };
  const res = await fetchJson<{ data: Raw[] }>("OpusClip", `${BASE_URL}/social-accounts?q=mine`, { headers: headers() });
  return res.data.map((a) => ({
    postAccountId: a.postAccountId,
    platform: a.platform,
    name: a.extUserName ?? "",
    subAccountId: a.subAccountId ?? null,
    profileUrl: a.extUserProfileLink ?? null,
  }));
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

// Headlines and renders --------------------------------------------------------
// Opus's REST docs don't cover clip editing, but its official CLI (opus-pro/opus-skills)
// edits clips by fetching the clip's editing script, changing it, and posting it back to
// re-render. A headline is a text overlay at the start of the clip. A re-render rebuilds
// both the preview and the HD export file with the overlay burned in, and uses no credits.

/** How long an added headline stays on screen, from the start of the clip. */
const HEADLINE_SECONDS = 5;
/**
 * Where the headline's center sits, as Opus measures it: 1 is the top edge, 0 the middle,
 * -1 the bottom. 0.58 is about 21% down the frame. Grids that crop vertical video to 3:4
 * (Instagram's profile grid) lose roughly the top 12%, which cut off headlines near the top
 * edge; at 21% the whole box stays in frame and still sits above speakers' faces.
 */
const HEADLINE_Y = 0.58;

type EditingTrack = { trackType?: string; sections?: EditingSection[] } & Record<string, unknown>;
type TextElement = { text?: string } & Record<string, unknown>;
type BoxPosition = { type?: string; xPct?: number; yPct?: number; wPct?: number; hPct?: number };
type EditingSection = {
  sectionTimeline?: { in?: number; out?: number };
  segments?: ({ content?: { textElements?: TextElement[] } & Record<string, unknown>; position?: BoxPosition; positionAdjustment?: BoxPosition } & Record<string, unknown>)[];
} & Record<string, unknown>;

/** Where a headline section sits now. Moves are stored as positionAdjustment, as Opus's editor does. */
function headlineBox(section: EditingSection): BoxPosition {
  const segment = section.segments?.[0];
  return segment?.positionAdjustment ?? segment?.position ?? {};
}
type HeadlineStyle = {
  font?: { family?: string; style?: string[]; color?: string; numericalSize?: number };
  backgroundColor?: string;
  borderRadius?: number;
  textAlign?: string;
  widthPct?: number;
  /** Set when Opus generated an Auto headline itself. */
  headline?: string | null;
};
type RenderJob = { pending?: boolean; concludedAt?: string };
type ClipDetail = {
  editingScript?: { tracks?: EditingTrack[] };
  renderPref?: { autoHookStyle?: HeadlineStyle };
  uriForPreview?: string;
  uriForThumbnail?: string;
  uriForExport?: string;
  engineClipUpdatedAt?: string;
  renderAsVideoPreview?: RenderJob;
  renderAsVideoFile?: RenderJob;
};
type ClipDetailWithScript = ClipDetail & { editingScript: { tracks: EditingTrack[] } };

async function getClipDetail(opusClipId: string): Promise<ClipDetailWithScript> {
  const res = await fetchJson<ClipDetail | { data: ClipDetail }>(
    "OpusClip",
    `${BASE_URL}/exportable-clips/${encodeURIComponent(opusClipId)}?include=editingScript`,
    { headers: headers() },
  );
  const detail = "data" in res && res.data ? res.data : (res as ClipDetail);
  if (!Array.isArray(detail.editingScript?.tracks)) throw new Error(`OpusClip: clip ${opusClipId} has no editing script`);
  return detail as ClipDetailWithScript;
}

function overlayText(section: EditingSection) {
  return (section.segments?.[0]?.content?.textElements ?? []).map((e) => e.text ?? "").join("").replace(/\s+/g, " ").trim();
}

/** The text overlay that opens the clip (its headline), if any. */
function findHeadlineSection(tracks: EditingTrack[]) {
  return tracks
    .filter((t) => t.trackType === "TextOverlayTrack" || /hook|headline/i.test(t.trackType ?? ""))
    .flatMap((t) => t.sections ?? [])
    .filter((s) => (s.sectionTimeline?.in ?? Infinity) < 1000 && overlayText(s))
    .sort((a, b) => (a.sectionTimeline!.in ?? 0) - (b.sectionTimeline!.in ?? 0))[0];
}

/** A clip's headline and render state, read live from Opus. */
export type ClipRender = {
  /** The headline text, or null when the clip has none. */
  headline: string | null;
  /**
   * "overlay": a text layer at the start of the clip (Opus's Auto headline from the editor,
   * or one added here); it can be edited. "opus": a headline Opus generated that isn't a
   * text layer in the editing script, so it can't be edited through the API.
   */
  headlineSource: "overlay" | "opus" | null;
  previewUrl: string | null;
  thumbnailUrl: string | null;
  exportUrl: string | null;
  /** A preview or HD render is still running. */
  rendering: boolean;
  /** The HD export file was rendered after the clip's last edit, so it includes it. */
  exportCurrent: boolean;
};

// Mock mode keeps headlines in memory so the flow can be tested end to end.
const mockHeadlines = new Map<string, string>();

export async function getClipRender(opusClipId: string): Promise<ClipRender> {
  if (!connected()) {
    const headline = mockHeadlines.get(opusClipId) ?? null;
    return { headline, headlineSource: headline ? "overlay" : null, previewUrl: null, thumbnailUrl: null, exportUrl: null, rendering: false, exportCurrent: true };
  }
  const d = await getClipDetail(opusClipId);
  const section = findHeadlineSection(d.editingScript.tracks);
  const opusHeadline = d.renderPref?.autoHookStyle?.headline?.trim() || null;
  const rendering = Boolean(d.renderAsVideoPreview?.pending || d.renderAsVideoFile?.pending);
  const edited = d.engineClipUpdatedAt ? Date.parse(d.engineClipUpdatedAt) : 0;
  const exported = d.renderAsVideoFile?.concludedAt ? Date.parse(d.renderAsVideoFile.concludedAt) : 0;
  return {
    headline: section ? overlayText(section) : opusHeadline,
    headlineSource: section ? "overlay" : opusHeadline ? "opus" : null,
    previewUrl: d.uriForPreview || null,
    thumbnailUrl: d.uriForThumbnail || null,
    exportUrl: d.uriForExport || null,
    rendering,
    // Clips never edited have no render job on record; their export is the original render.
    exportCurrent: Boolean(d.uriForExport) && !rendering && (!d.renderAsVideoFile || exported >= edited),
  };
}

const renderCache = new Map<string, { at: number; render: Promise<ClipRender> }>();

/**
 * getClipRender with a 60 second cache for page loads. A clip that's still rendering
 * isn't cached, so the card's refresh sees the finished render right away. Edits clear it.
 */
export function getClipRenderCached(opusClipId: string) {
  const hit = renderCache.get(opusClipId);
  if (hit && Date.now() - hit.at < 60 * 1000) return hit.render;
  const render = getClipRender(opusClipId);
  renderCache.set(opusClipId, { at: Date.now(), render });
  render.then(
    (r) => {
      if (r.rendering || !r.exportCurrent) renderCache.delete(opusClipId);
    },
    () => renderCache.delete(opusClipId),
  );
  return render;
}

/** Drops cached media and render state for a clip, after it's edited. */
function forgetClip(opusClipId: string) {
  renderCache.delete(opusClipId);
  clipsCache.delete(opusClipId.split(".")[0]);
}

let idCounter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(idCounter++).toString(36)}`;

function textElements(text: string, window: object) {
  return text.split(/\s+/).filter(Boolean).map((word) => ({ text: `${word} `, color: 0, ...window }));
}

/**
 * Builds the editing script with the headline set to text: the existing headline's text is
 * replaced, or a new text overlay is added for the first few seconds, styled like the
 * brand template's Auto headline. Pure, so it can be checked without saving anything.
 */
export function withHeadline(detail: ClipDetailWithScript, text: string) {
  const tracks = structuredClone(detail.editingScript.tracks);
  const existing = findHeadlineSection(tracks);
  if (existing) {
    const segment = existing.segments![0];
    const content = segment.content!;
    const first = content.textElements?.[0] ?? {};
    const window = { duration: first.duration, timeline: first.timeline ?? existing.sectionTimeline };
    content.textElements = textElements(text, window);
    // Keeps the box size and moves it to the standard height.
    const box = headlineBox(existing);
    segment.positionAdjustment = { type: "CPct", xPct: box.xPct ?? 0, yPct: HEADLINE_Y, wPct: box.wPct ?? 0.8, hPct: box.hPct ?? 0.2 };
    return { ...detail.editingScript, tracks };
  }

  const clipEndMs = Math.max(
    0,
    ...tracks.filter((t) => t.trackType === "KeyFrameTrack").flatMap((t) => (t.sections ?? []).map((s) => s.sectionTimeline?.out ?? 0)),
  );
  if (clipEndMs <= 0) throw new Error("OpusClip: couldn't find the clip's length in its editing script");
  const endMs = Math.min(HEADLINE_SECONDS * 1000, clipEndMs);
  const style = detail.renderPref?.autoHookStyle ?? {};
  const window = { duration: { type: "TS", sO: 0, eO: endMs }, timeline: { in: 0, out: endMs } };
  const section = {
    id: newId("section"),
    sectionDuration: window.duration,
    sectionTimeline: window.timeline,
    sceneId: "S.000",
    segments: [
      {
        id: newId("segment"),
        contentType: "TextOverlay",
        ...window,
        // In the top half of the frame, as wide as the template's headline box.
        position: { type: "CPct", xPct: 0, yPct: HEADLINE_Y, wPct: style.widthPct ?? 0.8, hPct: 0.2 },
        content: {
          id: newId("content"),
          textElements: textElements(text, window),
          textOverlayType: "paragraph",
          textStyle: {
            backgroundColor: style.backgroundColor ?? "#8000FFFF",
            fontFamily: style.font?.family ?? "Montserrat",
            fontWeight: style.font?.style?.[0] ?? "700",
            fontColor: style.font?.color ?? "#FFFFFFFF",
            fontSize: style.font?.numericalSize ?? 40,
            italic: false,
            borderRadius: style.borderRadius ?? 10,
            textAlign: style.textAlign ?? "center",
          },
          scale: 1,
          rotation: 0,
          ...window,
        },
      },
    ],
  };
  let track = tracks.find((t) => t.trackType === "TextOverlayTrack" && Array.isArray(t.sections));
  if (!track) {
    track = { id: newId("track"), trackType: "TextOverlayTrack", sections: [] };
    tracks.push(track);
  }
  track.sections!.push(section as EditingSection);
  return { ...detail.editingScript, tracks };
}

/**
 * Sets a clip's headline (adding one if it has none) at the standard height and starts a
 * re-render of its preview and HD file. Passing the current text just moves it there.
 * Doesn't use Opus credits. Refuses to touch a headline Opus generated outside the editing
 * script, since that can't be edited through the API.
 */
export async function setClipHeadline(opusClipId: string, text: string): Promise<void> {
  if (!connected()) {
    mockHeadlines.set(opusClipId, text);
    return;
  }
  const detail = await getClipDetail(opusClipId);
  const current = findHeadlineSection(detail.editingScript.tracks);
  if (!current && detail.renderPref?.autoHookStyle?.headline) {
    throw new Error(`This clip's headline was generated by Opus in a way the API can't edit: "${detail.renderPref.autoHookStyle.headline}".`);
  }
  // Nothing to do when the text matches and the headline already sits at the standard height.
  if (current && overlayText(current) === text.replace(/\s+/g, " ").trim() && headlineBox(current).yPct === HEADLINE_Y) return;
  await fetchJson("OpusClip", `${BASE_URL}/exportable-clips/${encodeURIComponent(opusClipId)}/re-render`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ editingScript: withHeadline(detail, text) }),
  });
  forgetClip(opusClipId);
}

/**
 * Waits until the clip's preview and HD renders have finished and the HD file includes its
 * latest edit. Re-renders usually take under a minute.
 */
export async function waitForRender(opusClipId: string, { timeoutMs = 4 * 60 * 1000, intervalMs = 5000 } = {}) {
  const started = Date.now();
  // Give Opus a moment to register a render that was just requested.
  if (connected()) await new Promise((r) => setTimeout(r, Math.min(intervalMs, 3000)));
  for (;;) {
    const render = await getClipRender(opusClipId);
    if (render.exportCurrent && !render.rendering) {
      forgetClip(opusClipId);
      return render;
    }
    if (Date.now() - started > timeoutMs) throw new Error("OpusClip is still rendering this clip. Try again in a few minutes.");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Exposed for checking an edit locally without saving it. */
export const getClipDetailForCheck = getClipDetail;

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
  subAccountId?: string | null;
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
      mediaType: "video",
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

export type PostNowInput = Omit<SchedulePostInput, "publishAt">;

/** Publishes a clip to one connected account right away. Docs: POST /api/post-tasks */
export async function postNow(input: PostNowInput): Promise<{ postId: string }> {
  if (!connected()) return { postId: `mock_post_${input.clipId}_${input.postAccountId}_${Date.now()}` };
  const body = {
    projectId: input.projectId,
    clipId: input.clipId,
    postAccountId: input.postAccountId,
    ...(input.subAccountId && { subAccountId: input.subAccountId }),
    postDetail: {
      title: input.title,
      mediaType: "video",
      custom: {
        ...(input.description && { description: input.description }),
        ...(input.privacy && { privacy: input.privacy }),
      },
    },
  };
  const res = await fetchJson<{ data: { postId: string } }>("OpusClip", `${BASE_URL}/post-tasks`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  return { postId: res.data.postId };
}

/** Cancels a scheduled post before it publishes. Docs: DELETE /api/publish-schedules/{scheduleId} */
export async function cancelScheduledPost(scheduleId: string): Promise<void> {
  if (!connected()) return;
  await fetchJson("OpusClip", `${BASE_URL}/publish-schedules/${encodeURIComponent(scheduleId)}`, {
    method: "DELETE",
    headers: headers(),
  });
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
