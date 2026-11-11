import type { ClipForAgent } from "@/lib/agent/prompts";
import { shouldCut, type ClipCaption } from "@/lib/agent/rules";
import type { ClipScore } from "@/lib/integrations/claude";
import { mockCandidateClips } from "@/lib/mock/candidate-clips";

// Stand-in agent output for when ANTHROPIC_API_KEY isn't set.

/** Shortens a title to under 60 characters at a word boundary. */
function shortTitle(title: string) {
  if (title.length < 60) return title;
  return title.slice(0, 59).replace(/\s+\S*$/, "");
}

export function mockClipScore(clip: ClipForAgent): ClipScore {
  // Reuse the review page's scores when the clip is one of the mock candidates.
  const known = mockCandidateClips.find((c) => c.title === clip.title);
  const scores = known?.scores ?? { hook: 4, tension: 3, standalone: 4, payoff: 4, loopability: 3 };
  const twoSpeakers = clip.format === "mock" || /interviewer|:\s/i.test(clip.transcript);
  const firstLine = clip.transcript.split(/(?<=[.?!])\s+/)[0] ?? "";
  return {
    scores,
    total: Object.values(scores).reduce((a, b) => a + b, 0),
    cut: shouldCut(scores),
    hookType: clip.format === "mock" ? "interviewer_pushback" : "insider_advice",
    vision: null,
    suggestedTitle: shortTitle(clip.title),
    youtube: { title: shortTitle(clip.title), description: `A real moment from "${clip.sourceVideoTitle}".` },
    framing: { speakerCount: twoSpeakers ? 2 : 1, layout: twoSpeakers ? "split" : "single", openOnLine: firstLine },
    reasoning: "Mock score: no Claude API key is set, so these are placeholder scores for layout and testing.",
    prediction: { low: 500, expected: 1500, high: 4000, reason: "Mock prediction: no Claude API key is set." },
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

export function mockCaption(clip: ClipForAgent): ClipCaption {
  const topic = clip.format === "mock" ? "#mockinterview" : "#techcareers";
  return {
    title: shortTitle(clip.title),
    context: [`A real moment from "${clip.sourceVideoTitle}".`],
    hashtags: ["#interviewprep", topic, "#careeradvice"],
  };
}
