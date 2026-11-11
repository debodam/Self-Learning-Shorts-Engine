import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import {
  buildCaptionsMessage,
  buildCaptionsRepairMessage,
  buildWeeklyReportMessage,
  BATCH_CALIBRATION_SYSTEM_PROMPT,
  buildBatchCalibrationMessage,
  buildScoringMessage,
  buildScoringRepairMessage,
  CAPTIONS_SYSTEM_PROMPT,
  WEEKLY_REPORT_SYSTEM_PROMPT,
  SCORING_SYSTEM_PROMPT,
  type BatchClipForAgent,
  type ClipForAgent,
  type SimilarShortForAgent,
  type ShortForBacktest,
  buildBacktestMessage,
  type WeeklyReportInput,
} from "@/lib/agent/prompts";
import {
  CAPTION_RULES,
  checkViewerText,
  HOOK_TYPES,
  shouldCut,
  validateCaption,
  type ClipCaption,
  type HookType,
} from "@/lib/agent/rules";
import type { RubricCategory } from "@/lib/clips";
import { isIntegrationConnected } from "@/lib/integrations/config";
import { requireEnv } from "@/lib/integrations/shared";
import { mockCaption, mockClipScore } from "@/lib/mock/agent";
import { CONFIDENCE_LEVELS, SHORT_FORMATS, type Confidence, type ShortFormat } from "@/lib/youtube-marks";

// Claude API calls for the clip agent. Docs: https://platform.claude.com/docs
// Every function returns mock data when ANTHROPIC_API_KEY isn't set.

const MODEL = "claude-opus-5-5";
// Scoring looks at frames and transcripts for every synced clip, so it runs on Sonnet:
// much better judgment than Haiku at about half the price of Opus.
export const SCORING_MODEL = "claude-sonnet-5-5";
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
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

/**
 * Estimated cost in USD. Cache reads bill at 0.1x input and 5 minute cache writes at 1.25x.
 * Priced at the requested model, so a rare refusal fallback to another model is approximate.
 */
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

const rubricScoresSchema = z.object({
  hook: z.number().int(),
  tension: z.number().int(),
  standalone: z.number().int(),
  payoff: z.number().int(),
  loopability: z.number().int(),
});

const scoreSchema = z.object({
  frames: z.array(z.object({ face_visible: z.boolean(), people: z.number().int() })),
  text_readable: z.boolean(),
  scores: rubricScoresSchema,
  hook_type: z.enum(HOOK_TYPES),
  suggested_title: z.string(),
  youtube: z.object({ title: z.string(), description: z.string() }),
  framing: z.object({
    speaker_count: z.number().int(),
    layout: z.enum(["single", "split"]),
    open_on_line: z.string(),
  }),
  reasoning: z.string(),
  predicted_views: z.object({ low: z.number().int(), expected: z.number().int(), high: z.number().int() }),
  prediction_reason: z.string(),
});

/** What the scorer saw in the clip's frames. */
export type ClipVision = {
  framesChecked: number;
  /** Frames where a person's face is clearly visible. */
  faceFrames: number;
  /** Most people visible in any one frame. */
  peopleCount: number;
  textReadable: boolean;
};

export type ClipScore = {
  scores: Record<RubricCategory, number>;
  total: number;
  /** True when Hook or Standalone is under 3, so the clip shouldn't be shortlisted. */
  cut: boolean;
  hookType: HookType;
  suggestedTitle: string;
  youtube: { title: string; description: string };
  framing: { speakerCount: number; layout: "single" | "split"; openOnLine: string };
  /** One sentence. */
  reasoning: string;
  /** Null when no frames were sent. */
  vision: ClipVision | null;
  /** Predicted settled YouTube views, anchored on the similar Shorts. */
  prediction: ClipPrediction;
  /** Tokens used, including any repair attempt. Zero for mock scores. */
  usage: TokenUsage;
};

export type ClipPrediction = { low: number; expected: number; high: number; reason: string };

const MAX_SCORING_ATTEMPTS = 2;
const MAX_REASON_WORDS = 40;

/** Clamps to 1 to 5; the schema can't express the range. */
function clampScores(scores: z.infer<typeof rubricScoresSchema>) {
  return Object.fromEntries(
    Object.entries(scores).map(([k, v]) => [k, Math.min(5, Math.max(1, Math.round(v)))]),
  ) as Record<RubricCategory, number>;
}

/** Shortens a title to the limit at a word boundary. Last resort when Claude can't count. */
function trimTitle(title: string) {
  const max = CAPTION_RULES.youtube.titleMaxChars;
  if (title.length <= max) return title;
  return title.slice(0, max + 1).replace(/\s+\S*$/, "").replace(/[\s,:;.(-]+$/, "");
}

/** Strips stray markup the model sometimes leaves at the end of a reason. */
function cleanReason(reasoning: string) {
  return reasoning
    .replace(/<\/?[a-z]+\s*\/?>/gi, "")
    .replace(/[\s{}[\]]+$/, "")
    .trim();
}

function reasonIssues(reasoning: string) {
  const issues = checkViewerText("Reasoning", reasoning);
  const words = reasoning.trim().split(/\s+/).length;
  if (words > MAX_REASON_WORDS) issues.push(`Reasoning is ${words} words; keep it to one sentence of at most 25 words`);
  return issues;
}

function scoringIssues(out: z.infer<typeof scoreSchema>, frameCount: number, { allowLongTitles = false } = {}) {
  const { titleMaxChars, descriptionLines } = CAPTION_RULES.youtube;
  const issues = [
    ...checkViewerText("Suggested title", out.suggested_title),
    ...checkViewerText("YouTube title", out.youtube.title),
    ...checkViewerText("YouTube description", out.youtube.description),
    ...reasonIssues(out.reasoning),
  ];
  // Say exactly how much to cut: "must be under 60" alone gets a 60 character retry.
  const tooLong = (label: string, title: string) =>
    `${label} is ${title.length} characters; it must be ${titleMaxChars} or fewer, so cut at least ${title.length - titleMaxChars}`;
  if (!allowLongTitles) {
    if (out.suggested_title.length > titleMaxChars) issues.push(tooLong("Suggested title", out.suggested_title));
    if (out.youtube.title.length > titleMaxChars) issues.push(tooLong("YouTube title", out.youtube.title));
  }
  const lines = out.youtube.description.split("\n").filter((l) => l.trim()).length;
  if (lines < descriptionLines[0] || lines > descriptionLines[1]) issues.push(`YouTube description must be 1 to 2 lines, has ${lines}`);
  if (frameCount && out.frames.length !== frameCount) issues.push(`frames must have exactly ${frameCount} entries, one per frame in order`);
  const p = out.predicted_views;
  if (p.low < 0 || p.low > p.expected || p.expected > p.high) issues.push(`predicted_views must have 0 <= low <= expected <= high; got ${p.low}, ${p.expected}, ${p.high}`);
  issues.push(...checkViewerText("Prediction reason", out.prediction_reason));
  const words = out.prediction_reason.trim().split(/\s+/).length;
  if (words > MAX_REASON_WORDS) issues.push(`prediction_reason is ${words} words; keep it to one line of at most 25 words`);
  return issues;
}

/**
 * Scores a clip on the rubric from its transcript and, when given, JPEG frames from the
 * clip. Reports what the frames show and writes a factual title and YouTube copy. Checks
 * the text against the content rules and asks Claude to fix any problems once.
 */
export async function scoreClip(
  clip: ClipForAgent,
  similarShorts: SimilarShortForAgent[] = [],
  frames: Buffer[] = [],
  /** The active prompt version's text. Defaults to the seed prompt in the code. */
  systemPrompt: string = SCORING_SYSTEM_PROMPT,
): Promise<ClipScore> {
  if (!connected()) return mockClipScore(clip);

  // Images go before the text that refers to them.
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...frames.map((frame): Anthropic.Beta.BetaImageBlockParam => ({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: frame.toString("base64") },
    })),
    { type: "text", text: buildScoringMessage(clip, similarShorts, frames.length) },
  ];
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content }];
  let usage = emptyUsage();
  let issues: string[] = [];
  let out: z.infer<typeof scoreSchema> | null = null;
  for (let attempt = 1; attempt <= MAX_SCORING_ATTEMPTS; attempt++) {
    const response = await getClient().beta.messages.parse({
      model: SCORING_MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: betaZodOutputFormat(scoreSchema) },
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      messages,
    });
    usage = addUsage(usage, toUsage(response.usage));
    assertUsable(response, "score the clip");
    out = response.parsed_output;
    if (!out) throw new Error("Claude returned no parseable score");

    issues = scoringIssues(out, frames.length);
    if (issues.length === 0) break;
    // Append the whole response unchanged (thinking blocks included) before the follow-up.
    messages.push({ role: "assistant", content: response.content }, { role: "user", content: buildScoringRepairMessage(issues) });
  }
  if (!out) throw new Error("Claude returned no parseable score");
  // Titles a character or two over after the repair attempt get trimmed, and an
  // out-of-order range gets sorted, rather than losing the whole score. Anything else
  // still wrong fails the clip.
  const [low, expected, high] = [out.predicted_views.low, out.predicted_views.expected, out.predicted_views.high].map((v) => Math.max(0, v)).sort((a, b) => a - b);
  out = { ...out, predicted_views: { low, expected, high } };
  issues = scoringIssues(out, frames.length, { allowLongTitles: true });
  if (issues.length) throw new Error(`Score still breaks the rules after ${MAX_SCORING_ATTEMPTS} attempts: ${issues.join("; ")}`);
  out = {
    ...out,
    suggested_title: trimTitle(out.suggested_title),
    youtube: { ...out.youtube, title: trimTitle(out.youtube.title) },
    reasoning: cleanReason(out.reasoning),
    prediction_reason: cleanReason(out.prediction_reason),
  };

  const scores = clampScores(out.scores);
  const seen = out.frames.slice(0, frames.length);
  return {
    scores,
    total: Object.values(scores).reduce((a, b) => a + b, 0),
    cut: shouldCut(scores),
    hookType: out.hook_type,
    suggestedTitle: out.suggested_title,
    youtube: out.youtube,
    framing: {
      speakerCount: out.framing.speaker_count,
      // Enforce the split-layout rule even if the model picks single for 2+ speakers.
      layout: out.framing.speaker_count >= 2 ? "split" : out.framing.layout,
      openOnLine: out.framing.open_on_line,
    },
    reasoning: out.reasoning,
    vision: frames.length
      ? {
          framesChecked: frames.length,
          faceFrames: seen.filter((f) => f.face_visible).length,
          peopleCount: Math.max(0, ...seen.map((f) => f.people)),
          textReadable: out.text_readable,
        }
      : null,
    prediction: {
      low: Math.max(0, out.predicted_views.low),
      expected: Math.max(0, out.predicted_views.expected),
      high: Math.max(0, out.predicted_views.high),
      reason: out.prediction_reason,
    },
    usage,
  };
}

// Batch calibration --------------------------------------------------------------

const calibrationSchema = z.object({
  clips: z.array(z.object({ key: z.string(), title: z.string(), scores: rubricScoresSchema, reasoning: z.string() })),
});

export type CalibratedScore = { scores: Record<RubricCategory, number>; reasoning: string };

/**
 * Compares the clips from one source video side by side and returns adjusted scores, so
 * the batch spreads out instead of bunching in the middle. Clips Claude leaves out, or
 * whose reason breaks the rules, keep their first-pass score or reason.
 */
export async function calibrateBatch(
  sourceVideoTitle: string,
  clips: BatchClipForAgent[],
): Promise<{ results: Map<string, CalibratedScore>; usage: TokenUsage }> {
  const results = new Map<string, CalibratedScore>();
  if (!connected() || clips.length < 2) return { results, usage: emptyUsage() };

  const response = await getClient().beta.messages.parse({
    model: SCORING_MODEL,
    max_tokens: 16000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: betaZodOutputFormat(calibrationSchema) },
    system: [{ type: "text", text: BATCH_CALIBRATION_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildBatchCalibrationMessage(sourceVideoTitle, clips) }],
  });
  const usage = toUsage(response.usage);
  assertUsable(response, "compare the batch");
  const out = response.parsed_output;
  if (!out) throw new Error("Claude returned no parseable batch scores");

  const byKey = new Map(clips.map((c) => [c.key, c]));
  const norm = (t: string) => t.trim().toLowerCase();
  for (const c of out.clips) {
    const original = byKey.get(c.key);
    // Only trust a result whose echoed title matches the key, so a mixed-up key can't
    // move one clip's scores onto another.
    if (!original || norm(original.title) !== norm(c.title)) continue;
    const reasoning = cleanReason(c.reasoning);
    results.set(c.key, {
      scores: clampScores(c.scores),
      reasoning: reasonIssues(reasoning).length ? original.reasoning : reasoning,
    });
  }
  return { results, usage };
}

// Captions ---------------------------------------------------------------------

const captionSchema = z.object({
  context: z.array(z.string()),
  hashtags: z.array(z.string()),
});

const MAX_CAPTION_ATTEMPTS = 2;

export const CAPTIONS_MODEL = MODEL;

/**
 * Writes the one caption a clip is posted with on every platform: its factual title (as
 * given), 1 to 2 lines of context, and 3 to 5 hashtags. Checks it against the caption rules
 * and asks Claude to fix any problems once before giving up.
 */
export async function writeCaption(clip: ClipForAgent): Promise<{ caption: ClipCaption; usage: TokenUsage }> {
  if (!connected()) return { caption: mockCaption(clip), usage: emptyUsage() };

  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: buildCaptionsMessage(clip) }];
  let issues: string[] = [];
  let usage = emptyUsage();
  for (let attempt = 1; attempt <= MAX_CAPTION_ATTEMPTS; attempt++) {
    const response = await getClient().beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: betaZodOutputFormat(captionSchema) },
      system: [{ type: "text", text: CAPTIONS_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages,
    });
    usage = addUsage(usage, toUsage(response.usage));
    assertUsable(response, "write the caption");
    const out = response.parsed_output;
    if (!out) throw new Error("Claude returned no parseable caption");

    const caption = { title: clip.title.trim(), context: out.context.map((l) => l.trim()).filter(Boolean), hashtags: out.hashtags.map((h) => h.trim()) };
    issues = validateCaption(caption);
    if (issues.length === 0) return { caption, usage };
    // Append the whole response unchanged (thinking blocks included) before the follow-up.
    messages.push({ role: "assistant", content: response.content }, { role: "user", content: buildCaptionsRepairMessage(issues) });
  }
  throw new Error(`The caption still breaks the rules after ${MAX_CAPTION_ATTEMPTS} attempts: ${issues.join("; ")}`);
}

// Weekly report ---------------------------------------------------------------------

const reportSchema = z.object({
  what_worked: z.array(z.string()),
  what_didnt_work: z.array(z.string()),
  reasoning: z.string(),
  patterns: z.array(z.object({ dimension: z.enum(["format", "hook type", "headline style", "topic"]), finding: z.string() })),
  proposals: z.array(z.object({ title: z.string(), reasoning: z.string(), old_text: z.string(), new_text: z.string() })),
});

export type ReportProposal = { title: string; reasoning: string; oldText: string; newText: string };
export type WeeklyReportDraft = {
  whatWorked: string[];
  whatDidntWork: string[];
  reasoning: string;
  patterns: { dimension: string; finding: string }[];
  proposals: ReportProposal[];
  /** Proposals dropped because their old_text wasn't in the prompt exactly once. */
  dropped: string[];
  usage: TokenUsage;
};

const MAX_PROPOSALS = 3;
export const REPORT_MODEL = MODEL;

function proposalIssues(promptText: string, p: { title: string; old_text: string; new_text: string }) {
  const count = p.old_text ? promptText.split(p.old_text).length - 1 : 0;
  const issues: string[] = [];
  if (count !== 1) issues.push(`"${p.title}": old_text appears ${count} times in the prompt; it must be copied exactly and appear once`);
  if (p.old_text === p.new_text) issues.push(`"${p.title}": new_text is the same as old_text`);
  issues.push(...checkViewerText(`"${p.title}" new_text`, p.new_text));
  return issues;
}

/**
 * Writes the weekly learnings and up to 3 proposed prompt changes from accuracy numbers
 * and backtest results. Asks Claude to fix rule breaks once, then drops any proposal
 * whose old_text still isn't in the prompt exactly once.
 */
export async function writeWeeklyReport(input: WeeklyReportInput): Promise<WeeklyReportDraft> {
  if (!connected()) throw new Error("Claude isn't connected, so the weekly report can't be written.");
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: buildWeeklyReportMessage(input) }];
  let usage = emptyUsage();
  let out: z.infer<typeof reportSchema> | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const response = await getClient().beta.messages.parse({
      model: MODEL,
      max_tokens: 32000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: betaZodOutputFormat(reportSchema) },
      system: [{ type: "text", text: WEEKLY_REPORT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages,
    });
    usage = addUsage(usage, toUsage(response.usage));
    assertUsable(response, "write the weekly report");
    out = response.parsed_output;
    if (!out) throw new Error("Claude returned no parseable weekly report");
    const text = [...out.what_worked, ...out.what_didnt_work, out.reasoning, ...out.patterns.map((p) => p.finding), ...out.proposals.flatMap((p) => [p.title, p.reasoning])];
    const issues = [
      ...text.flatMap((t) => checkViewerText("Report", t)),
      ...out.proposals.slice(0, MAX_PROPOSALS).flatMap((p) => proposalIssues(input.promptText, p)),
      ...(out.proposals.length > MAX_PROPOSALS ? [`at most ${MAX_PROPOSALS} proposals; got ${out.proposals.length}`] : []),
    ];
    if (issues.length === 0 || attempt === 2) break;
    messages.push({ role: "assistant", content: response.content });
    messages.push({
      role: "user",
      content: `That breaks these rules:\n${[...new Set(issues)].map((i) => `- ${i}`).join("\n")}\n\nWrite the report again with every rule met. Copy old_text exactly from the prompt.`,
    });
  }
  if (!out) throw new Error("Claude returned no parseable weekly report");
  const textIssues = [...out.what_worked, ...out.what_didnt_work, out.reasoning].flatMap((t) => checkViewerText("Report", t));
  if (textIssues.length) throw new Error(`The weekly report broke the content rules: ${[...new Set(textIssues)].join("; ")}`);
  const kept = out.proposals.slice(0, MAX_PROPOSALS).filter((p) => proposalIssues(input.promptText, p).length === 0);
  return {
    whatWorked: out.what_worked,
    whatDidntWork: out.what_didnt_work,
    reasoning: out.reasoning,
    patterns: out.patterns.filter((p) => checkViewerText("Pattern", p.finding).length === 0),
    proposals: kept.map((p) => ({ title: p.title, reasoning: p.reasoning, oldText: p.old_text, newText: p.new_text })),
    dropped: out.proposals.filter((p) => !kept.includes(p)).map((p) => p.title),
    usage,
  };
}

// Short format labels --------------------------------------------------------------

// Labeling is a simple classification run on every Short on the channel, so it uses Haiku.
export const LABEL_MODEL = "claude-haiku-5-5";

const LABEL_SYSTEM_PROMPT = `You label YouTube Shorts from Aced, a tech and product interview prep company, by content format.

Formats:
- mock_interview: a candidate answering interview questions while an interviewer asks or reacts. Role-played practice interviews and clips cut from them count, even when only the answer is shown.
- conversational: people talking with each other about careers, companies, or interviews, such as a podcast, panel, or interview with an expert, where nobody is being interviewed for a job.
- explainer: one presenter teaching a concept or giving advice directly to the viewer, with or without graphics, such as "What is an API?" or interview tips to camera.
- other: anything else, such as promos, announcements, memes, or behind the scenes.

Use the title, the description, and the thumbnail together. Descriptions often repeat channel boilerplate about mock interviews or coaching; ignore boilerplate and judge the Short itself.

Confidence: high when the signals agree and the format is clear, medium when you are fairly sure but one signal is weak or missing, low when you are mostly guessing.

The reason is one short sentence naming the deciding signal.`;

const labelSchema = z.object({
  format: z.enum(SHORT_FORMATS),
  confidence: z.enum(CONFIDENCE_LEVELS),
  reason: z.string(),
});

export type ShortForLabel = { title: string; description: string; thumbnail: { data: Buffer; mediaType: "image/jpeg" | "image/png" | "image/webp" } | null };
export type ShortLabel = { format: ShortFormat; confidence: Confidence; reason: string; usage: TokenUsage };

/** Labels one Short's content format from its title, description, and thumbnail. */
export async function labelShortFormat(short: ShortForLabel): Promise<ShortLabel> {
  if (!connected()) throw new Error("Claude isn't connected, so Shorts can't be labeled.");
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (short.thumbnail) {
    content.push({ type: "image", source: { type: "base64", media_type: short.thumbnail.mediaType, data: short.thumbnail.data.toString("base64") } });
  }
  content.push({
    type: "text",
    text: `${short.thumbnail ? "The image above is the thumbnail." : "No thumbnail is available."}\n\nTitle: ${short.title}\n\nDescription:\n${short.description || "(none)"}`,
  });
  const response = await getClient().beta.messages.parse({
    model: LABEL_MODEL,
    max_tokens: 2000,
    // A simple classification: low effort keeps thinking (and cost) to a minimum.
    thinking: { type: "adaptive" },
    output_config: { effort: "low", format: betaZodOutputFormat(labelSchema) },
    system: LABEL_SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });
  assertUsable(response, "label the Short");
  const out = response.parsed_output;
  if (!out) throw new Error("Claude returned no parseable label");
  return { format: out.format, confidence: out.confidence, reason: out.reason.trim(), usage: toUsage(response.usage) };
}

// Backtests -------------------------------------------------------------------------

const backtestSchema = z.object({
  scores: rubricScoresSchema,
  predicted_views: z.object({ low: z.number().int(), expected: z.number().int(), high: z.number().int() }),
  prediction_reason: z.string(),
});

export type BacktestPrediction = { rubricTotal: number; low: number; expected: number; high: number; reason: string; usage: TokenUsage };

/**
 * Scores a published Short with a given prompt version as if it were new, using only
 * Shorts published before it. Same model and effort as real scoring, so a backtest
 * measures the prompt that would actually run.
 */
export async function predictForBacktest(systemPrompt: string, short: ShortForBacktest, similar: SimilarShortForAgent[]): Promise<BacktestPrediction> {
  if (!connected()) throw new Error("Claude isn't connected, so there's nothing to backtest.");
  const response = await getClient().beta.messages.parse({
    model: SCORING_MODEL,
    max_tokens: 16000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: betaZodOutputFormat(backtestSchema) },
    system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildBacktestMessage(short, similar) }],
  });
  assertUsable(response, "backtest the Short");
  const out = response.parsed_output;
  if (!out) throw new Error("Claude returned no parseable backtest prediction");
  const [low, expected, high] = [out.predicted_views.low, out.predicted_views.expected, out.predicted_views.high]
    .map((v) => Math.max(0, v))
    .sort((a, b) => a - b);
  const scores = clampScores(out.scores);
  return {
    rubricTotal: Object.values(scores).reduce((a, b) => a + b, 0),
    low,
    expected,
    high,
    reason: cleanReason(out.prediction_reason),
    usage: toUsage(response.usage),
  };
}
