import type { ClipFormat, Platform } from "@/lib/clips";
import { CAPTION_RULES, CUT_CATEGORIES, HOOK_TYPES, MIN_KEEP_SCORE } from "@/lib/agent/rules";

// System prompts and message builders for the clip agent. Keep the system prompts free of
// per-request data so they stay cacheable; everything clip-specific goes in the user message.

const ABOUT_ACED = `Aced makes interview prep content for tech roles: product management, software engineering, system design, data science, and career topics like offers and negotiation. Its long-form YouTube videos are mock interviews (a candidate and an interviewer working through a real interview question) and conversations (hiring managers, recruiters, and engineers talking about how hiring works). You help turn those videos into Shorts for YouTube, TikTok, and Instagram. The audience is people preparing for tech interviews, so viewers want to see real interview moments and learn something they can use.`;

const BRAND_AND_STYLE = `Brand and style, for everything a viewer will see (titles, descriptions, hooks, captions):
- The brand is "Aced". The company used to be called Exponent, and older videos may say so. Never write "Exponent" in anything a viewer sees; say "Aced" or leave the brand out.
- Never use em dashes. Use a period, comma, colon, or parentheses instead.
- Be factual and specific. Describe what actually happens in the clip, and name the company and role when the source video does ("Google PM candidate", "Meta system design interview").
- No clickbait. Don't promise what the clip doesn't deliver, don't use "you won't believe", "this changes everything", shock framing, ALL CAPS, or emoji.`;

const RUBRIC = `Score the clip from 1 to 5 on each category:

- Hook: do the first 3 seconds give a reason to keep watching? 5 opens on a moment with stakes (pushback, a mistake, a sharp question, a surprising claim). 1 opens on setup, small talk, or the middle of a thought.
- Tension: is there something unresolved the viewer wants to see play out? 5 is a real challenge or disagreement with an outcome in doubt. 1 is a calm explanation with nothing at stake.
- Standalone: does it make sense to someone who hasn't seen the long-form video? 5 needs no outside context. 1 depends on earlier parts of the interview or on references the viewer can't follow.
- Payoff: does the viewer leave with a resolution or a takeaway they can use? 5 lands a clear answer, lesson, or turn. 1 cuts off before the point or never makes one.
- Loopability: does the ending flow back into the opening, or make the viewer want to rewatch? 5 ends on a line that recontextualizes the start. 1 ends abruptly or with an outro.

Use the full range and be strict: a 5 should be rare. Anything under ${MIN_KEEP_SCORE} on ${CUT_CATEGORIES.map((c) => c[0].toUpperCase() + c.slice(1)).join(" or ")} gets cut, so score those two honestly rather than rounding up a clip you like.`;

const FRAMING = `Framing rules for the edit:
- Every person who speaks in the clip must be fully visible on screen while the clip plays. Never crop a speaker out.
- With 2 or more speakers, use a split layout so both are visible. Use a single layout only when one person speaks.
- Mock interview clips open on the moment of tension (the pushback, the mistake, the hard follow-up question), then cut back to the answer. Pick the exact line to open on.`;

const TITLE_RULES = `Title rules:
- Under 60 characters.
- Factual and specific: who, which company or role if known, and what happens. For example "Google PM candidate asks who the user is first" rather than "This PM answer is genius".
- No clickbait, no questions meant to bait a click, no emoji.`;

export const SCORING_SYSTEM_PROMPT = `${ABOUT_ACED}

Your job here is to judge one candidate clip cut from a long-form video and decide whether it should make the weekly shortlist. You'll get the clip's transcript and details, and sometimes past clips with similar content and how they performed. Use those past results to calibrate: if similar clips underperformed, look for the reason and score accordingly.

${RUBRIC}

Also classify the hook as one of: ${HOOK_TYPES.join(", ")}.

Predict views in the first 7 days on each of YouTube, TikTok, and Instagram if the clip is posted. Anchor on the past clips you're given: start from what clips with a similar format, hook type, and score got, and adjust for how this clip compares. With no past clips, keep estimates modest. Predictions are compared with actual results each week, so aim for accuracy, not optimism.

${FRAMING}

${TITLE_RULES}

The suggested title follows the title rules. Also write the YouTube Shorts copy:
- youtube.title: under 60 characters, following the title rules. It can match the suggested title.
- youtube.description: 1 to 2 lines that say what happens in the clip and what the viewer learns. No hashtags.

${BRAND_AND_STYLE}

In your reasoning, explain the scores in one short sentence of at most 25 words that a reviewer can skim. Name the main strength or the main reason it's cut.`;

export const CAPTIONS_SYSTEM_PROMPT = `${ABOUT_ACED}

Your job here is to write the post copy for one approved clip on each platform. You'll get the clip's title, transcript, and source video.

${BRAND_AND_STYLE}

The hook line is the first thing a viewer reads. It states the specific moment in the clip as a plain fact, for example "A Google PM candidate asks who the app is for before designing anything." It is not a question aimed at the viewer and not a tease.

YouTube Shorts:
- title: under 60 characters, following the title rules below.
- description: 1 to 2 lines that say what happens in the clip and what the viewer learns.
- hashtags: exactly ${CAPTION_RULES.youtube.hashtags[0]}.

TikTok:
- hook: one factual hook line.
- hashtags: ${CAPTION_RULES.tiktok.hashtags[0]} to ${CAPTION_RULES.tiktok.hashtags[1]}.

Instagram Reels:
- hook: one factual hook line.
- context: ${CAPTION_RULES.instagram.contextLines[0]} to ${CAPTION_RULES.instagram.contextLines[1]} short lines that add what the viewer should notice or take away. One line per array item.
- cta: one line asking viewers to follow Aced, tied to the clip's topic, for example "Follow Aced for more real PM interview moments."
- hashtags: exactly ${CAPTION_RULES.instagram.hashtags[0]}.

${TITLE_RULES}

Hashtags: each is # followed by letters, numbers, or underscores, with no spaces. Mix one or two broad tags (#interviewprep, #techcareers) with specific ones for the role, company, or topic. Don't repeat a tag within a platform.`;

// Message builders -------------------------------------------------------------

export type ClipForAgent = {
  title: string;
  transcript: string;
  sourceVideoTitle: string;
  format: ClipFormat;
  durationSeconds?: number | null;
};

export type SimilarClip = {
  title: string;
  format: ClipFormat;
  hookType: string | null;
  scoreTotal: number | null;
  /** Latest views per platform; missing when not posted there or no metrics yet. */
  views: Partial<Record<Platform, number>>;
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

export function buildScoringMessage(clip: ClipForAgent, similarClips: SimilarClip[] = []) {
  let message = `Score this clip.\n\n${clipDetails(clip)}`;
  if (similarClips.length > 0) {
    const rows = similarClips.map((s) => {
      const views = (["youtube", "tiktok", "instagram"] as const)
        .map((p) => `${p} ${s.views[p] ?? "n/a"}`)
        .join(", ");
      return `- "${s.title}" (${s.format}, hook: ${s.hookType ?? "unknown"}, score ${s.scoreTotal ?? "n/a"}/25): views ${views}`;
    });
    message += `\n\nPast clips and how they performed:\n${rows.join("\n")}`;
  }
  return message;
}

export function buildCaptionsMessage(clip: ClipForAgent) {
  return `Write the post copy for this approved clip.\n\n${clipDetails(clip)}`;
}

export function buildCaptionsRepairMessage(issues: string[]) {
  return `That copy breaks these rules:\n${issues.map((i) => `- ${i}`).join("\n")}\n\nRewrite all three platforms so every rule is met. Keep what already works.`;
}

// Weekly learnings -------------------------------------------------------------

export const LEARNINGS_SYSTEM_PROMPT = `${ABOUT_ACED}

Your job here is to review one week of posted clips and write the weekly learning report. For each clip you'll get its format, hook type, rubric scores, the views you predicted when you scored it, and the actual results so far on each platform.

Write three things:
- what_worked: 2 to 4 findings about what performed, each one sentence with the specific clip or numbers behind it.
- what_changed: 1 to 3 concrete changes to how clips get scored, picked, framed, or captioned next week. Each should be something a person or the agent can act on.
- reasoning: 2 to 4 sentences connecting the findings to the changes. Call out where predictions were far off and what that says about the scoring.

Base every claim on the numbers given. With only a few clips, say the evidence is thin rather than overstating a pattern. Don't use em dashes. Refer to the brand as Aced.`;

export type WeekClipResult = {
  title: string;
  format: ClipFormat;
  hookType: string | null;
  scoreTotal: number | null;
  predicted: Partial<Record<Platform, number>>;
  actual: Partial<Record<Platform, { views: number | null; avgPercentWatched: number | null; shares: number | null }>>;
};

export function buildLearningsMessage(weekStart: string, clips: WeekClipResult[]) {
  const rows = clips.map((c) => {
    const platforms = (["youtube", "tiktok", "instagram"] as const).map((p) => {
      const a = c.actual[p];
      const actual = a ? `${a.views ?? "n/a"} views, ${a.avgPercentWatched ?? "n/a"}% watched, ${a.shares ?? "n/a"} shares` : "no data";
      return `  ${p}: predicted ${c.predicted[p] ?? "n/a"} views; actual ${actual}`;
    });
    return `- "${c.title}" (${c.format}, hook: ${c.hookType ?? "unknown"}, score ${c.scoreTotal ?? "n/a"}/25)\n${platforms.join("\n")}`;
  });
  return `Week starting ${weekStart}. ${clips.length} clips posted.\n\n${rows.join("\n")}`;
}
