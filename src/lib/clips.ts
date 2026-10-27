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
  projectUrl: string;
  /** Opus's own virality score, 0 to 100. */
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
  /** Missing for clips that didn't come from Opus, or when Opus couldn't be reached. */
  opus?: OpusMedia;
};

export const WEEKLY_APPROVAL_TARGET = 7;

export function totalScore(scores: Record<RubricCategory, number>) {
  return rubricCategories.reduce((sum, c) => sum + scores[c], 0);
}

export const MAX_TOTAL_SCORE = rubricCategories.length * 5;
