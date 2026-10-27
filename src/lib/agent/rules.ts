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
  youtube: { titleMaxChars: 59, descriptionLines: [1, 2], hashtags: [3, 3] },
  tiktok: { hashtags: [3, 5] },
  instagram: { contextLines: [2, 3], hashtags: [5, 5] },
} as const;

export type PlatformCaptions = {
  youtube: { title: string; description: string; hashtags: string[] };
  tiktok: { hook: string; hashtags: string[] };
  instagram: { hook: string; context: string[]; cta: string; hashtags: string[] };
};

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

/** Checks captions against CAPTION_RULES and the viewer text rules. Returns problems, empty when fine. */
export function validateCaptions(c: PlatformCaptions): string[] {
  const { youtube, tiktok, instagram } = CAPTION_RULES;
  const issues: string[] = [];

  if (c.youtube.title.length > youtube.titleMaxChars) {
    issues.push(`YouTube title is ${c.youtube.title.length} characters; it must be under 60`);
  }
  const descLines = c.youtube.description.split("\n").filter((l) => l.trim()).length;
  if (descLines < youtube.descriptionLines[0] || descLines > youtube.descriptionLines[1]) {
    issues.push(`YouTube description must be 1 to 2 lines, has ${descLines}`);
  }
  issues.push(...checkHashtags("YouTube", c.youtube.hashtags, youtube.hashtags));

  if (c.tiktok.hook.includes("\n")) issues.push("TikTok hook must be one line");
  issues.push(...checkHashtags("TikTok", c.tiktok.hashtags, tiktok.hashtags));

  if (c.instagram.hook.includes("\n")) issues.push("Instagram hook must be one line");
  if (c.instagram.context.length < instagram.contextLines[0] || c.instagram.context.length > instagram.contextLines[1]) {
    issues.push(`Instagram context must be 2 to 3 lines, has ${c.instagram.context.length}`);
  }
  if (!/follow/i.test(c.instagram.cta) || !/aced/i.test(c.instagram.cta)) {
    issues.push("Instagram CTA must ask viewers to follow Aced");
  }
  issues.push(...checkHashtags("Instagram", c.instagram.hashtags, instagram.hashtags));

  const texts: [string, string][] = [
    ["YouTube title", c.youtube.title],
    ["YouTube description", c.youtube.description],
    ["TikTok hook", c.tiktok.hook],
    ["Instagram hook", c.instagram.hook],
    ["Instagram context", c.instagram.context.join("\n")],
    ["Instagram CTA", c.instagram.cta],
  ];
  for (const [label, text] of texts) issues.push(...checkViewerText(label, text));
  return issues;
}

/** Renders captions as the text each platform receives. */
export function formatCaptions(c: PlatformCaptions) {
  return {
    youtube: { title: c.youtube.title, description: `${c.youtube.description}\n\n${c.youtube.hashtags.join(" ")}` },
    tiktok: `${c.tiktok.hook}\n\n${c.tiktok.hashtags.join(" ")}`,
    instagram: [c.instagram.hook, "", ...c.instagram.context, "", c.instagram.cta, "", c.instagram.hashtags.join(" ")].join("\n"),
  };
}
