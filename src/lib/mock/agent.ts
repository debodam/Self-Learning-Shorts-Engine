import type { ClipForAgent } from "@/lib/agent/prompts";
import { shouldCut, type PlatformCaptions } from "@/lib/agent/rules";
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
    suggestedTitle: shortTitle(clip.title),
    framing: { speakerCount: twoSpeakers ? 2 : 1, layout: twoSpeakers ? "split" : "single", openOnLine: firstLine },
    reasoning: "Mock score: no Claude API key is set, so these are placeholder scores for layout and testing.",
  };
}

export function mockCaptions(clip: ClipForAgent): PlatformCaptions {
  const title = shortTitle(clip.title);
  const hook = clip.title.endsWith(".") ? clip.title : `${clip.title}.`;
  const topic = clip.format === "mock" ? "#mockinterview" : "#techcareers";
  return {
    youtube: {
      title,
      description: `A real moment from "${clip.sourceVideoTitle}".`,
      hashtags: ["#interviewprep", topic, "#shorts"],
    },
    tiktok: { hook, hashtags: ["#interviewprep", topic, "#careertok"] },
    instagram: {
      hook,
      context: [`From "${clip.sourceVideoTitle}".`, "Watch how the answer comes together under pressure."],
      cta: "Follow Aced for more real interview moments.",
      hashtags: ["#interviewprep", topic, "#techjobs", "#careeradvice", "#jobsearch"],
    },
  };
}
