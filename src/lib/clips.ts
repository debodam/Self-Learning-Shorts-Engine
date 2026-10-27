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

export type CandidateClip = {
  id: string;
  title: string;
  sourceVideo: string;
  format: ClipFormat;
  /** Null until clip length is stored (not yet in the schema). */
  durationSeconds: number | null;
  /** Each score is 1 to 5. */
  scores: Record<RubricCategory, number>;
  /** Predicted views in the first 7 days. Null until the agent predicts them. */
  predictedViews: Record<Platform, number> | null;
};

export const WEEKLY_APPROVAL_TARGET = 7;

export function totalScore(clip: CandidateClip) {
  return rubricCategories.reduce((sum, c) => sum + clip.scores[c], 0);
}

export const MAX_TOTAL_SCORE = rubricCategories.length * 5;
