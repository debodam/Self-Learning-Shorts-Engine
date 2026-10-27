export type ClipFormat = "mock" | "conversational";

export const formatLabels: Record<ClipFormat, string> = {
  mock: "Mock interview",
  conversational: "Conversational",
};

export const rubricCategories = [
  "hook",
  "tension",
  "standalone",
  "payoff",
  "loopability",
] as const;

export type RubricCategory = (typeof rubricCategories)[number];

export const rubricLabels: Record<RubricCategory, string> = {
  hook: "Hook",
  tension: "Tension",
  standalone: "Standalone",
  payoff: "Payoff",
  loopability: "Loop",
};

export type Platform = "youtube" | "tiktok" | "instagram";

export const platformLabels: Record<Platform, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
};

/** Live links from OpusClip. Media URLs are signed and short-lived, so they're never stored. */
export type OpusMedia = {
  thumbnailUrl: string | null;
  previewUrl: string | null;
  editorUrl: string;
  /** Opus's own virality score, 0 to 100. Shown for reference only: never used to rank or cut. */
  opusScore: number | null;
};

export type CandidateClip = {
  id: string;
  title: string;
  sourceVideo: string;
  format: ClipFormat;
  /** Null when the clip length is unknown. */
  durationSeconds: number | null;
  /** Each score is 1 to 5. Null until the agent scores the clip. */
  scores: Record<RubricCategory, number> | null;
  /** Predicted views in the first 7 days. Null until the agent scores the clip. */
  predictedViews: Record<Platform, number> | null;
  /** The agent's one-line reason for the scores. */
  reason?: string | null;
  /** A factual title the agent suggests. title keeps the original. */
  suggestedTitle?: string | null;
  /** Cut by the rubric (under 3 on Hook or Standalone) or a hard rule, so it can't be shortlisted. */
  cut?: boolean;
  /** Set when a hard rule cut the clip regardless of its scores, e.g. "No speaker on screen". */
  cutReason?: string | null;
  /** What the scorer saw in the clip's frames. Null when frames weren't checked. */
  vision?: { framesChecked: number; faceFrames: number; peopleCount: number; textReadable: boolean } | null;
  /** One of this week's top kept clips, so it can be approved. */
  shortlisted?: boolean;
  /** The Opus project the clip came from. Missing for clips not from Opus. */
  batchId?: string;
  transcript?: string | null;
  /** Missing for clips that didn't come from Opus, or when Opus couldn't be reached. */
  opus?: OpusMedia;
};

export const WEEKLY_APPROVAL_TARGET = 7;

export function totalScore(scores: Record<RubricCategory, number>) {
  return rubricCategories.reduce((sum, c) => sum + scores[c], 0);
}

export const MAX_TOTAL_SCORE = rubricCategories.length * 5;
