import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import {
  buildCaptionsMessage,
  buildCaptionsRepairMessage,
  buildLearningsMessage,
  buildScoringMessage,
  buildScoringRepairMessage,
  CAPTIONS_SYSTEM_PROMPT,
  LEARNINGS_SYSTEM_PROMPT,
  SCORING_SYSTEM_PROMPT,
  type ClipForAgent,
  type SimilarClip,
  type WeekClipResult,
} from "@/lib/agent/prompts";
import {
  CAPTION_RULES,
  checkViewerText,
  HOOK_TYPES,
  shouldCut,
  validateCaptions,
  type HookType,
  type PlatformCaptions,
} from "@/lib/agent/rules";
import type { Platform, RubricCategory } from "@/lib/clips";
import { isIntegrationConnected } from "@/lib/integrations/config";
import { requireEnv } from "@/lib/integrations/shared";
import { mockCaptions, mockClipScore, mockWeeklyLearning } from "@/lib/mock/agent";

// Claude API calls for the clip agent. Docs: https://platform.claude.com/docs
// Every function returns mock data when ANTHROPIC_API_KEY isn't set.

const MODEL = "claude-opus-5-5";
// Scoring runs on every synced clip, so it uses the low-cost model. Haiku has no
// server-side refusal fallback, so a declined clip fails and stays unscored.
export const SCORING_MODEL = "claude-haiku-5-5";
// Re-runs a request on Anthropic's recommended model if a safety classifier declines it.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export type TokenUsage = { input: number; output: number; cacheRead: number; cacheWrite: number };

export const emptyUsage = (): TokenUsage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite };
}

function toUsage(u: Anthropic.Beta.BetaUsage): TokenUsage {
  return { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 };
}

// List prices in USD per million tokens, for prompts up to 100K tokens. Check
// https://platform.claude.com/docs/en/about-claude/pricing when they change.
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

/** Estimated cost in USD. Cache reads bill at 0.1x input and 5 minute cache writes at 1.25x. */
export function estimateCostUsd(model: string, usage: TokenUsage) {
  const price = PRICES[model];
  if (!price) return null;
  const inputEquivalent = usage.input + usage.cacheRead * 0.1 + usage.cacheWrite * 1.25;
  return (inputEquivalent * price.input + usage.output * price.output) / 1_000_000;
}

let client: Anthropic | null = null;
function getClient() {
  client ??= new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  return client;
}

const connected = () => isIntegrationConnected("claude");

function assertUsable(response: Anthropic.Beta.BetaMessage, what: string) {
  if (response.stop_reason === "refusal") {
    throw new Error(`Claude declined to ${what} (${response.stop_details?.category ?? "no category"})`);
  }
  if (response.stop_reason === "max_tokens") throw new Error(`Claude ran out of tokens while trying to ${what}`);
}

// Scoring ----------------------------------------------------------------------

const scoreSchema = z.object({
  scores: z.object({
    hook: z.number().int(),
    tension: z.number().int(),
    standalone: z.number().int(),
    payoff: z.number().int(),
    loopability: z.number().int(),
  }),
  hook_type: z.enum(HOOK_TYPES),
  predicted_views: z.object({ youtube: z.number().int(), tiktok: z.number().int(), instagram: z.number().int() }),
  suggested_title: z.string(),
  youtube: z.object({ title: z.string(), description: z.string() }),
  framing: z.object({
    speaker_count: z.number().int(),
    layout: z.enum(["single", "split"]),
    open_on_line: z.string(),
  }),
  reasoning: z.string(),
});

export type ClipScore = {
  scores: Record<RubricCategory, number>;
  total: number;
  /** True when Hook or Standalone is under 3, so the clip shouldn't be shortlisted. */
  cut: boolean;
  hookType: HookType;
  /** Predicted views in the first 7 days. */
  predictedViews: Record<Platform, number>;
  suggestedTitle: string;
  youtube: { title: string; description: string };
  framing: { speakerCount: number; layout: "single" | "split"; openOnLine: string };
  /** One sentence. */
  reasoning: string;
  /** Tokens used, including any repair attempt. Zero for mock scores. */
  usage: TokenUsage;
};

const MAX_SCORING_ATTEMPTS = 2;
const MAX_REASON_WORDS = 40;

/** Shortens a title to the limit at a word boundary. Last resort when Claude can't count. */
function trimTitle(title: string) {
  const max = CAPTION_RULES.youtube.titleMaxChars;
  if (title.length <= max) return title;
  return title.slice(0, max + 1).replace(/\s+\S*$/, "").replace(/[\s,:;.(-]+$/, "");
}

function scoringIssues(out: z.infer<typeof scoreSchema>, { allowLongTitles = false } = {}) {
  const { titleMaxChars, descriptionLines } = CAPTION_RULES.youtube;
  const issues = [
    ...checkViewerText("Suggested title", out.suggested_title),
    ...checkViewerText("YouTube title", out.youtube.title),
    ...checkViewerText("YouTube description", out.youtube.description),
  ];
  // Say exactly how much to cut: "must be under 60" alone gets a 60 character retry.
  const tooLong = (label: string, title: string) =>
    `${label} is ${title.length} characters; it must be ${titleMaxChars} or fewer, so cut at least ${title.length - titleMaxChars}`;
  if (!allowLongTitles) {
    if (out.suggested_title.length > titleMaxChars) issues.push(tooLong("Suggested title", out.suggested_title));
    if (out.youtube.title.length > titleMaxChars) issues.push(tooLong("YouTube title", out.youtube.title));
  }
  const words = out.reasoning.trim().split(/\s+/).length;
  if (words > MAX_REASON_WORDS) issues.push(`Reasoning is ${words} words; keep it to one sentence of at most 25 words`);
  const lines = out.youtube.description.split("\n").filter((l) => l.trim()).length;
  if (lines < descriptionLines[0] || lines > descriptionLines[1]) issues.push(`YouTube description must be 1 to 2 lines, has ${lines}`);
  return issues;
}

/**
 * Scores a clip on the rubric and writes a factual title and YouTube copy. Checks the
 * text against the content rules and asks Claude to fix any problems once.
 */
export async function scoreClip(clip: ClipForAgent, similarClips: SimilarClip[] = []): Promise<ClipScore> {
  if (!connected()) return mockClipScore(clip);

  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: buildScoringMessage(clip, similarClips) }];
  let usage = emptyUsage();
  let issues: string[] = [];
  let out: z.infer<typeof scoreSchema> | null = null;
  for (let attempt = 1; attempt <= MAX_SCORING_ATTEMPTS; attempt++) {
    const response = await getClient().beta.messages.parse({
      model: SCORING_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: betaZodOutputFormat(scoreSchema) },
      system: [{ type: "text", text: SCORING_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages,
    });
    usage = addUsage(usage, toUsage(response.usage));
    assertUsable(response, "score the clip");
    out = response.parsed_output;
    if (!out) throw new Error("Claude returned no parseable score");

    issues = scoringIssues(out);
    if (issues.length === 0) break;
    // Append the whole response unchanged (thinking blocks included) before the follow-up.
    messages.push({ role: "assistant", content: response.content }, { role: "user", content: buildScoringRepairMessage(issues) });
  }
  if (!out) throw new Error("Claude returned no parseable score");
  // Titles a character or two over after the repair attempt get trimmed rather than
  // losing the whole score. Anything else still wrong fails the clip.
  issues = scoringIssues(out, { allowLongTitles: true });
  if (issues.length) throw new Error(`Score still breaks the rules after ${MAX_SCORING_ATTEMPTS} attempts: ${issues.join("; ")}`);
  out = { ...out, suggested_title: trimTitle(out.suggested_title), youtube: { ...out.youtube, title: trimTitle(out.youtube.title) } };

  // Clamp in case the model strays outside 1 to 5; the schema can't express the range.
  const scores = Object.fromEntries(
    Object.entries(out.scores).map(([k, v]) => [k, Math.min(5, Math.max(1, v))]),
  ) as Record<RubricCategory, number>;

  return {
    scores,
    total: Object.values(scores).reduce((a, b) => a + b, 0),
    cut: shouldCut(scores),
    hookType: out.hook_type,
    predictedViews: {
      youtube: Math.max(0, out.predicted_views.youtube),
      tiktok: Math.max(0, out.predicted_views.tiktok),
      instagram: Math.max(0, out.predicted_views.instagram),
    },
    suggestedTitle: out.suggested_title,
    youtube: out.youtube,
    framing: {
      speakerCount: out.framing.speaker_count,
      // Enforce the split-layout rule even if the model picks single for 2+ speakers.
      layout: out.framing.speaker_count >= 2 ? "split" : out.framing.layout,
      openOnLine: out.framing.open_on_line,
    },
    reasoning: out.reasoning,
    usage,
  };
}

// Captions ---------------------------------------------------------------------

const captionsSchema = z.object({
  youtube: z.object({ title: z.string(), description: z.string(), hashtags: z.array(z.string()) }),
  tiktok: z.object({ hook: z.string(), hashtags: z.array(z.string()) }),
  instagram: z.object({
    hook: z.string(),
    context: z.array(z.string()),
    cta: z.string(),
    hashtags: z.array(z.string()),
  }),
});

const MAX_CAPTION_ATTEMPTS = 2;

/**
 * Writes YouTube, TikTok, and Instagram copy for an approved clip. Checks it against the
 * caption rules and asks Claude to fix any problems once before giving up.
 */
export async function writeCaptions(clip: ClipForAgent): Promise<PlatformCaptions> {
  if (!connected()) return mockCaptions(clip);

  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: buildCaptionsMessage(clip) }];
  let issues: string[] = [];
  for (let attempt = 1; attempt <= MAX_CAPTION_ATTEMPTS; attempt++) {
    const response = await getClient().beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: betaZodOutputFormat(captionsSchema) },
      system: [{ type: "text", text: CAPTIONS_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages,
    });
    assertUsable(response, "write captions");
    const captions = response.parsed_output;
    if (!captions) throw new Error("Claude returned no parseable captions");

    issues = validateCaptions(captions);
    if (issues.length === 0) return captions;
    // Append the whole response unchanged (thinking blocks included) before the follow-up.
    messages.push({ role: "assistant", content: response.content }, { role: "user", content: buildCaptionsRepairMessage(issues) });
  }
  throw new Error(`Captions still break the rules after ${MAX_CAPTION_ATTEMPTS} attempts: ${issues.join("; ")}`);
}

// Weekly learnings -------------------------------------------------------------

const learningsSchema = z.object({
  what_worked: z.array(z.string()),
  what_changed: z.array(z.string()),
  reasoning: z.string(),
});

export type WeeklyLearningDraft = { whatWorked: string[]; whatChanged: string[]; reasoning: string };

/** Compares a week's predictions with actual results and writes the learnings entry. */
export async function writeWeeklyLearnings(weekStart: string, clips: WeekClipResult[]): Promise<WeeklyLearningDraft> {
  if (!connected()) return mockWeeklyLearning(clips);

  const response = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: betaZodOutputFormat(learningsSchema) },
    system: [{ type: "text", text: LEARNINGS_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildLearningsMessage(weekStart, clips) }],
  });
  assertUsable(response, "write the weekly learnings");
  const out = response.parsed_output;
  if (!out) throw new Error("Claude returned no parseable learnings");

  const issues = [...out.what_worked, ...out.what_changed, out.reasoning].flatMap((t) => checkViewerText("Learnings", t));
  if (issues.length) throw new Error(`Claude's learnings broke the rules: ${[...new Set(issues)].join("; ")}`);
  return { whatWorked: out.what_worked, whatChanged: out.what_changed, reasoning: out.reasoning };
}
