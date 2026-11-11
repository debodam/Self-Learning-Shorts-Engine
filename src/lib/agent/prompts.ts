import type { ClipFormat } from "@/lib/clips";
import { CAPTION_RULES, CUT_CATEGORIES, HOOK_TYPES, MIN_KEEP_SCORE } from "@/lib/agent/rules";

// System prompts and message builders for the clip agent. Keep the system prompts free of
// per-request data so they stay cacheable; everything clip-specific goes in the user message.

const ABOUT_ACED = `Aced makes interview prep content for tech roles: product management, software engineering, system design, data science, and career topics like offers and negotiation. Its long-form YouTube videos are mock interviews (a candidate and an interviewer working through a real interview question) and conversations (hiring managers, recruiters, and engineers talking about how hiring works). You help turn those videos into Shorts for YouTube, TikTok, and Instagram. The audience is people preparing for tech interviews, so viewers want to see real interview moments and learn something they can use.`;

const BRAND_AND_STYLE = `Brand and style, for everything a viewer will see (titles, descriptions, hooks, captions):
- The brand is "Aced". The company used to be called Exponent, and older videos may say so. Never write "Exponent" in anything a viewer sees; say "Aced" or leave the brand out.
- Never use em dashes. Use a period, comma, colon, or parentheses instead.
- Be factual and specific. Describe what actually happens in the clip, and name the company and role when the source video does ("Google PM candidate", "Meta system design interview").
- No clickbait. Don't promise what the clip doesn't deliver, don't use "you won't believe", "this changes everything", shock framing, ALL CAPS, or emoji.
- Refer to people by their role or name ("the Stripe GTM lead", "the candidate"), never with he, she, him, or her. A transcript doesn't tell you how someone identifies, and a wrong guess is a factual error.`;

const CUT_LABELS = CUT_CATEGORIES.map((c) => c[0].toUpperCase() + c.slice(1)).join(" or ");

const RUBRIC = `Score the clip from 1 to 5 on each category. Score against what a good Aced clip looks like, not a perfect viral clip:
- 3 is a solid clip Aced would happily post: a person on camera making a clear, specific point.
- 4 is strong: a sharper moment, a more useful takeaway, or a cleaner opening.
- 5 is exceptional and rare.
- 2 means a concrete problem you can name. 1 means the clip doesn't work at all on that category.

Categories:
- Hook: do the first few seconds give a reason to keep watching? 3 when someone states a clear topic, question, or claim early. 4 to 5 when it opens on stakes (pushback, a mistake, a sharp question, a surprising claim or number). Below 3 only when it opens on filler or small talk, starts mid-thought with no subject, or has no person on screen and text the viewer can't read.
- Tension: is there something the viewer wants to see resolved? Mock interviews earn 4 to 5 for a real challenge or pushback. Conversational clips are naturally calmer: a clear, specific point earns 3 even when the delivery is calm. Don't score a conversational clip below 3 just for being calm.
- Standalone: does it make sense to someone who hasn't seen the long-form video? A clear, specific insight from a person on camera is 3 to 4 even if calm. Below 3 only when it depends on missing context: unexplained names or personas, "as I showed you earlier", or a question the viewer never hears.
- Payoff: does the viewer leave with a takeaway they can use? A clear, specific insight is 3 to 4. 5 lands a sharp lesson or turn. Below 3 when it cuts off before the point or never makes one.
- Loopability: does the ending make the viewer want to rewatch? 3 ends cleanly on the point. 4 to 5 ends on a line that recontextualizes the start. Below 3 when it ends abruptly or on an outro.

Clips under ${MIN_KEEP_SCORE} on ${CUT_LABELS} get cut. Only score ${CUT_LABELS} below ${MIN_KEEP_SCORE} for a concrete reason like the ones above, and name that reason in your reasoning.

Use the full 1 to 5 range and spread scores out. Decide each category on its own evidence rather than starting from a default: a clip with a sharp opening but a weak ending should show that difference. Most clips should not end up with identical scores, and a run of 3s across every category means you haven't looked closely enough.`;

// Short, made-up examples with the scores they should get, so scores stay calibrated.
// Keep them in sync with the rubric when it changes.
const CALIBRATION_EXAMPLES = `Calibration examples (made up, to show the scale):

1. Conversational, one speaker, 40 seconds.
Transcript: "The number one reason I pass on PM candidates: they never say who the user is. They jump straight to features. When someone stops and asks who we're building for, I already know the rest of the interview will go well. So before you sketch anything, name the user and why they care."
Scores: Hook 4, Tension 3, Standalone 4, Payoff 4, Loopability 3. Total 18, kept.
Reasoning: Opens on a specific claim from a hiring manager and lands an actionable rule; calm, but the point is clear on its own.

2. Mock interview, two speakers, 50 seconds.
Transcript: "Interviewer: Why would Zillow build that? Agents already do it for free. Candidate: Fair. Let me rethink who actually feels this pain. Buyers outside a big city have no agent nearby, so the tool replaces the first agent visit, not the agent."
Scores: Hook 5, Tension 5, Standalone 4, Payoff 4, Loopability 3. Total 21, kept.
Reasoning: Opens on direct interviewer pushback and shows the candidate recover with a sharper user segment.

3. Conversational, one speaker, 35 seconds.
Transcript: "So, yeah, um, like I was saying about the second persona, Mark, that's where it gets interesting, because he's the one who, uh, you know, does the thing we talked about."
Scores: Hook 1, Tension 2, Standalone 1, Payoff 2, Loopability 2. Total 8, cut.
Reasoning: Opens on filler and depends on a persona and earlier discussion the viewer never sees.`;

const FRAMING = `Framing rules for the edit:
- Every person who speaks in the clip must be fully visible on screen while the clip plays. Never crop a speaker out.
- With 2 or more speakers, use a split layout so both are visible. Use a single layout only when one person speaks.
- Mock interview clips open on the moment of tension (the pushback, the mistake, the hard follow-up question), then cut back to the answer. Pick the exact line to open on.`;

const TITLE_RULES = `Title rules:
- Under 60 characters.
- Factual and specific: who, which company or role if known, and what happens. For example "Google PM candidate asks who the user is first" rather than "This PM answer is genius".
- No clickbait, no questions meant to bait a click, no emoji.
- "Part 1", "Part 2" and similar are intentional for multi-part clips. Keep them, and don't count them against the clip.`;

const VISUAL_CHECKS = `Frames: you'll see three still frames taken about 10%, 50%, and 90% of the way through the clip, in that order. For each frame, report:
- face_visible: true only when a real person's face is clearly visible and large enough to read their expression on a phone. A screen share, slides, a document, or a tiny webcam bubble in a corner is false.
- people: how many people are visible in that frame.
Then report text_readable: whether the important on-screen text (slides, documents, code, captions aside) would be readable on a phone screen. Answer true when there is no such text.

Aced Shorts need a person on camera. A clip that is mostly a screen share or slides without a visible speaker is a weak Short: score Hook and Standalone low and say so. When frames aren't available, judge from the transcript and report every frame as not visible.`;

export const SCORING_SYSTEM_PROMPT = `${ABOUT_ACED}

Your job here is to judge one candidate clip cut from a long-form video and decide whether it should make the weekly shortlist. You'll get the clip's transcript and details, frames from the clip when they're available, and usually the 5 most similar past Shorts on the Aced channel with their settled views.

Settled views are a Short's views once it has stopped growing: its total after 30 days, or its views at 7 days for newer Shorts. Use the similar Shorts in two ways:
- Score the rubric on the clip itself. The past Shorts can sharpen your judgment (if a similar idea flopped, look for why), but don't raise or lower rubric scores just because similar Shorts did well or badly.
- Predict this clip's settled views on YouTube as a range: low, expected, and high, with low <= expected <= high. Anchor on the similar Shorts' settled views, weighting the closest matches most, then adjust for how this clip's hook and payoff compare with theirs. Most Shorts land near the typical result, so keep the range honest rather than optimistic. In prediction_reason, write one line of at most 25 words that names the past Shorts you compared against (a short version of their titles) and how this clip differs.
When no similar Shorts are given, still give your best range from the rubric alone and say in prediction_reason that there were no similar Shorts to compare against.

${VISUAL_CHECKS}

${RUBRIC}

${CALIBRATION_EXAMPLES}

Also classify the hook as one of: ${HOOK_TYPES.join(", ")}.

${FRAMING}

${TITLE_RULES}

The suggested title follows the title rules. Also write the YouTube Shorts copy:
- youtube.title: under 60 characters, following the title rules. It can match the suggested title.
- youtube.description: 1 to 2 lines that say what happens in the clip and what the viewer learns. No hashtags.

${BRAND_AND_STYLE}

In your reasoning, explain the scores in one short sentence of at most 25 words that a reviewer can skim. Name the main strength or the main reason it's cut.`;

export const CAPTIONS_SYSTEM_PROMPT = `${ABOUT_ACED}

Your job here is to write the caption for one approved clip. The same caption is posted as is to YouTube Shorts, TikTok, and Instagram Reels. You'll get the clip's factual title, transcript, and source video.

The caption is the title (given to you; it's added as the first line, so don't repeat it), then:
- context: ${CAPTION_RULES.caption.contextLines[0]} to ${CAPTION_RULES.caption.contextLines[1]} short lines that say what happens in the clip and what the viewer learns. Plain statements of fact, one line per array item, not questions aimed at the viewer and not teases.
- hashtags: ${CAPTION_RULES.caption.hashtags[0]} to ${CAPTION_RULES.caption.hashtags[1]} relevant tags. Each is # followed by letters, numbers, or underscores, with no spaces. Mix one or two broad tags (#interviewprep, #techcareers) with specific ones for the role, company, or topic. Don't repeat a tag.

${BRAND_AND_STYLE}`;

// Message builders -------------------------------------------------------------

export type ClipForAgent = {
  title: string;
  transcript: string;
  sourceVideoTitle: string;
  format: ClipFormat;
  durationSeconds?: number | null;
};

export type SimilarShortForAgent = {
  title: string;
  format: string | null;
  settledViews: number;
  /** Cosine similarity of the embeddings, 1 is identical. */
  similarity: number;
};

function clipDetails(clip: ClipForAgent) {
  const lines = [
    `Source video: ${clip.sourceVideoTitle}`,
    `Format: ${clip.format === "mock" ? "mock interview" : "conversational"}`,
    `Working title from the clipping tool: ${clip.title}`,
  ];
  if (clip.durationSeconds) lines.push(`Length: ${clip.durationSeconds} seconds`);
  return `${lines.join("\n")}\n\n<transcript>\n${clip.transcript}\n</transcript>`;
}

export function buildScoringRepairMessage(issues: string[]) {
  return `That breaks these rules:\n${issues.map((i) => `- ${i}`).join("\n")}\n\nScore the clip again with every rule met. Keep the scores unless the fix changes your judgment.`;
}

export function buildScoringMessage(clip: ClipForAgent, similarShorts: SimilarShortForAgent[] = [], frameCount = 0) {
  const frames = frameCount ? `The ${frameCount} frames above are from this clip.` : "No frames are available for this clip.";
  let message = `Score this clip. ${frames}\n\n${clipDetails(clip)}`;
  if (similarShorts.length > 0) {
    const rows = similarShorts.map(
      (s) => `- "${s.title}" (${s.format ?? "format unknown"}, similarity ${s.similarity.toFixed(2)}): ${s.settledViews} settled views`,
    );
    message += `\n\nThe ${similarShorts.length} most similar past Shorts on the channel, closest first:\n${rows.join("\n")}`;
  } else {
    message += "\n\nNo similar past Shorts with settled views are available.";
  }
  return message;
}

/** A published channel Short, scored as if it were a new candidate, for backtests. */
export type ShortForBacktest = { title: string; description: string; format: string | null; durationSeconds: number };

export function buildBacktestMessage(short: ShortForBacktest, similarShorts: SimilarShortForAgent[]) {
  const rows = similarShorts.map(
    (s) => `- "${s.title}" (${s.format ?? "format unknown"}, similarity ${s.similarity.toFixed(2)}): ${s.settledViews} settled views`,
  );
  return `Backtest: score this Short as if it were a new candidate that hasn't been posted yet. Only its title, description, and format are available: no transcript and no frames, so judge the rubric from what the title and description say the Short contains, and only give the rubric scores and the predicted views.

Title: ${short.title}
Format: ${short.format ?? "unknown"}
Length: ${short.durationSeconds} seconds
Description:
${short.description || "(none)"}

The ${similarShorts.length} most similar Shorts published before it, closest first:
${rows.join("\n")}`;
}

export function buildCaptionsMessage(clip: ClipForAgent) {
  return `Write the caption for this approved clip. Its title, the caption's first line, is: ${clip.title}\n\n${clipDetails(clip)}`;
}

export function buildCaptionsRepairMessage(issues: string[]) {
  return `That caption breaks these rules:\n${issues.map((i) => `- ${i}`).join("\n")}\n\nRewrite it so every rule is met. Keep what already works.`;
}

// Weekly learnings -------------------------------------------------------------

export const WEEKLY_REPORT_SYSTEM_PROMPT = `${ABOUT_ACED}

Your job here is the weekly review of the scoring agent: how well its view predictions matched what actually happened, what that says about the scoring prompt, and up to 3 specific changes to the prompt that a person will approve or reject. Nothing you propose changes anything on its own.

You'll get:
- The active scoring prompt, in full.
- Accuracy numbers: Spearman rank correlation between predicted and actual settled views, the share of Shorts whose actual views landed inside the predicted low to high range, and the share of top 7 picks that beat the channel's median settled views.
- Results for our own recently posted clips, when there are any.
- A backtest on the channel's past Shorts: each was predicted using only Shorts published before it. You get grouped stats (by format and by headline style) and the Shorts the prompt over- and under-predicted the most. The ratio is actual divided by expected views.

Write:
- what_worked: 1 to 4 findings about what the scoring got right, each one sentence with the numbers or Shorts behind it.
- what_didnt_work: 1 to 4 findings about where predictions or rankings were off, each one sentence with the numbers or Shorts behind it.
- reasoning: 2 to 4 sentences on why, connecting the findings to how the prompt is written.
- patterns: up to 8 findings, each tied to a dimension (format, hook type, headline style, or topic), that say which groups over- or underperformed their predictions and by how much.
- proposals: up to 3 changes to the scoring prompt or rubric. Each has a short title, the reasoning (which finding it addresses and why the change should help, 2 to 3 sentences), old_text, and new_text. old_text must be copied exactly, character for character, from the active prompt and must appear in it exactly once; keep it short, usually one sentence or one bullet. new_text replaces it. To add a sentence, set old_text to an existing sentence and new_text to that sentence plus the addition. Propose only changes the evidence supports; fewer is fine, and none is fine when nothing stands out. Don't propose changes to output fields, the title rules, or brand rules.

Base every claim on the numbers given. When the evidence is thin, say so rather than overstating a pattern. Don't use em dashes. Refer to the brand as Aced, never Exponent. Refer to people by their role or name, never with he, she, him, or her.`;

export type ReportGroupStat = { dimension: string; group: string; count: number; medianRatio: number; rangeHitRate: number };
export type ReportShortRow = { title: string; format: string | null; predicted: number; actual: number; ratio: number };
export type ReportClipRow = { title: string; format: string; hookType: string | null; predicted: number | null; actual: number | null; settled: boolean };
export type ReportAccuracy = { label: string; count: number; spearman: number | null; rangeHitRate: number | null; top7HitRate: number | null };

export type WeeklyReportInput = {
  weekStart: string;
  promptVersion: number;
  promptText: string;
  accuracy: ReportAccuracy[];
  ownClips: ReportClipRow[];
  groups: ReportGroupStat[];
  overPredicted: ReportShortRow[];
  underPredicted: ReportShortRow[];
};

const pct = (v: number | null) => (v === null ? "n/a" : `${Math.round(v * 100)}%`);

export function buildWeeklyReportMessage(input: WeeklyReportInput) {
  const accuracy = input.accuracy
    .map((a) => `- ${a.label}: ${a.count} items, Spearman ${a.spearman?.toFixed(2) ?? "n/a"}, range hit ${pct(a.rangeHitRate)}, top 7 hit ${pct(a.top7HitRate)}`)
    .join("\n");
  const own = input.ownClips.length
    ? input.ownClips
        .map((c) => `- "${c.title}" (${c.format}, hook ${c.hookType ?? "unknown"}): predicted ${c.predicted ?? "n/a"}, actual ${c.actual ?? "n/a"}${c.settled ? "" : " (not settled yet)"}`)
        .join("\n")
    : "None yet.";
  const groups = input.groups
    .map((g) => `- ${g.dimension} = ${g.group}: ${g.count} Shorts, median actual/expected ${g.medianRatio.toFixed(2)}, range hit ${pct(g.rangeHitRate)}`)
    .join("\n");
  const rows = (list: ReportShortRow[]) => list.map((r) => `- "${r.title}" (${r.format ?? "unknown"}): predicted ${r.predicted}, actual ${r.actual}, ratio ${r.ratio.toFixed(2)}`).join("\n");
  return `Weekly review for the week of ${input.weekStart}. The active scoring prompt is version ${input.promptVersion}:

<prompt>
${input.promptText}
</prompt>

Accuracy:
${accuracy}

Our own posted clips:
${own}

Backtest groups:
${groups}

Most over-predicted (actual far below expected):
${rows(input.overPredicted)}

Most under-predicted (actual far above expected):
${rows(input.underPredicted)}`;
}

// Batch calibration -------------------------------------------------------------

export const BATCH_CALIBRATION_SYSTEM_PROMPT = `${ABOUT_ACED}

Each clip from one long-form video has already been scored on its own. Your job here is to compare them side by side and adjust the scores so the batch is ranked well: the best clips clearly score higher than average ones, and weak clips score lower. Clips scored one at a time tend to bunch up in the middle; spread them out.

${RUBRIC}

How to adjust:
- Read every clip before changing anything. Compare clips that have the same scores and decide which is actually better.
- Move a score only when the comparison justifies it, and keep the per-category reasoning honest: a better opening raises Hook, not Payoff.
- Most clips in a batch should not end up with identical scores. The strongest one or two clips in a batch of ten or more should usually total several points above the median.
- Each clip lists what its frames showed. A clip without a visible speaker is weak for Aced; don't raise it above clips with a person on camera.

For every clip, return its key, its working title copied exactly, the final five scores, and a reason of one short sentence of at most 25 words that says why it ranks where it does in this batch.

${BRAND_AND_STYLE}`;

export type BatchClipForAgent = {
  key: string;
  title: string;
  format: ClipFormat;
  durationSeconds: number | null;
  transcript: string;
  scores: Record<"hook" | "tension" | "standalone" | "payoff" | "loopability", number>;
  reasoning: string;
  /** e.g. "face in 3 of 3 frames, 2 people, text readable" or "frames not checked". */
  visual: string;
};

export function buildBatchCalibrationMessage(sourceVideoTitle: string, clips: BatchClipForAgent[]) {
  const rows = clips.map((c) => {
    const s = c.scores;
    return [
      `<clip key="${c.key}">`,
      `Working title: ${c.title}`,
      `Format: ${c.format === "mock" ? "mock interview" : "conversational"}${c.durationSeconds ? `, ${c.durationSeconds} seconds` : ""}`,
      `Frames: ${c.visual}`,
      `First-pass scores: Hook ${s.hook}, Tension ${s.tension}, Standalone ${s.standalone}, Payoff ${s.payoff}, Loopability ${s.loopability}`,
      `First-pass reason: ${c.reasoning}`,
      `<transcript>\n${c.transcript}\n</transcript>`,
      `</clip>`,
    ].join("\n");
  });
  return `Source video: ${sourceVideoTitle}\n${clips.length} clips.\n\n${rows.join("\n\n")}`;
}
