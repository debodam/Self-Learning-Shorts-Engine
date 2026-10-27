import type { RubricCategory } from "@/lib/clips";

// Content rules the agent follows. The prompts quote these and the validators check
// them, so a rule only needs changing here.

/** Clips scoring below this on Hook or Standalone are cut. */
export const MIN_KEEP_SCORE = 3;
export const CUT_CATEGORIES: RubricCategory[] = ["hook", "standalone"];

export const HOOK_TYPES = [
  "interviewer_pushback",
  "candidate_mistake",
  "sharp_question",
  "contrarian_take",
  "specific_number",
  "insider_advice",
  "story",
] as const;
export type HookType = (typeof HOOK_TYPES)[number];

export const CAPTION_RULES = {
  /** The scoring agent's YouTube copy, and the limit on the caption's first line (the title). */
  youtube: { titleMaxChars: 59, descriptionLines: [1, 2] },
  /** The one caption posted to YouTube, TikTok, and Instagram. */
  caption: { contextLines: [1, 2], hashtags: [3, 5] },
} as const;

/**
 * The caption posted as is to all three platforms: the clip's factual title, 1 to 2 lines
 * of context, and 3 to 5 hashtags.
 */
export type ClipCaption = { title: string; context: string[]; hashtags: string[] };

export function shouldCut(scores: Record<RubricCategory, number>) {
  return CUT_CATEGORIES.some((c) => scores[c] < MIN_KEEP_SCORE);
}

const EM_DASH = "\u2014";
const BANNED_BRAND = /exponent/i;

/** Rules every piece of viewer-facing text must follow. Returns problems, empty when fine. */
export function checkViewerText(label: string, text: string): string[] {
  const issues: string[] = [];
  if (text.includes(EM_DASH)) issues.push(`${label} contains an em dash`);
  if (BANNED_BRAND.test(text)) issues.push(`${label} mentions Exponent; the brand is Aced`);
  return issues;
}

function checkHashtags(label: string, tags: string[], [min, max]: readonly [number, number]) {
  const issues: string[] = [];
  if (tags.length < min || tags.length > max) {
    issues.push(`${label} needs ${min === max ? min : `${min} to ${max}`} hashtags, has ${tags.length}`);
  }
  for (const tag of tags) {
    if (!/^#[\p{L}\p{N}_]+$/u.test(tag)) issues.push(`${label} hashtag "${tag}" must be # followed by letters, numbers, or _`);
  }
  if (new Set(tags.map((t) => t.toLowerCase())).size !== tags.length) issues.push(`${label} has duplicate hashtags`);
  return issues;
}

/** Checks a caption against CAPTION_RULES and the viewer text rules. Returns problems, empty when fine. */
export function validateCaption(c: ClipCaption): string[] {
  const { youtube, caption } = CAPTION_RULES;
  const issues: string[] = [];
  if (c.title.length > youtube.titleMaxChars) issues.push(`The title is ${c.title.length} characters; it must be under 60`);
  if (c.context.length < caption.contextLines[0] || c.context.length > caption.contextLines[1]) {
    issues.push(`Context must be 1 to 2 lines, has ${c.context.length}`);
  }
  if (c.context.some((line) => line.includes("\n"))) issues.push("Each context line must be a single line");
  issues.push(...checkHashtags("Caption", c.hashtags, caption.hashtags));
  issues.push(...checkViewerText("Caption", [c.title, ...c.context].join("\n")));
  return issues;
}

/** The caption text exactly as posted: title, then context, then hashtags. */
export function formatCaption(c: ClipCaption) {
  return [c.title, "", ...c.context, "", c.hashtags.join(" ")].join("\n");
}

/**
 * A person must be on camera for most of the clip: a face in at least this many of the
 * sampled frames. Fewer and the clip is cut, whatever its rubric scores.
 */
export const MIN_FACE_FRAMES = 2;
export const NO_SPEAKER_REASON = "No speaker on screen";
