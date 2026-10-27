import type { ClipFormat } from "@/lib/clips";
import type { PostedClip } from "@/lib/performance";

// Stand-in for metrics pulled from YouTube, TikTok, and Instagram (Phase 1 pipelines).
// Two weeks of daily posts at 12pm Eastern (16:00 UTC while on daylight time).
type Row = [
  date: string,
  title: string,
  format: ClipFormat,
  youtube: [views: number, avgPercentWatched: number, shares: number],
  tiktok: [views: number, avgPercentWatched: number, shares: number],
  instagram: [views: number, avgPercentWatched: number, shares: number],
];

const rows: Row[] = [
  ["2026-10-25", "Candidate defends a pull model for the news feed fanout", "mock", [41200, 78, 312], [58900, 54, 611], [17400, 66, 205]],
  ["2026-10-24", "Hiring manager explains what 'tell me about yourself' is really testing", "conversational", [36800, 71, 288], [72300, 49, 904], [24100, 63, 377]],
  ["2026-10-23", "Meta PM candidate picks one metric for Marketplace and defends it", "mock", [29700, 82, 197], [33100, 58, 342], [12800, 69, 141]],
  ["2026-10-22", "Ex-Google recruiter on why referrals still get read first", "conversational", [22400, 67, 154], [41800, 46, 520], [15900, 58, 198]],
  ["2026-10-21", "Interviewer stops a candidate who starts coding before clarifying inputs", "mock", [53600, 85, 466], [87200, 61, 1183], [29300, 72, 418]],
  ["2026-10-20", "Two PMs compare how Amazon and Google run the product sense round", "conversational", [18300, 64, 102], [21700, 43, 233], [9800, 55, 96]],
  ["2026-10-19", "Candidate estimates daily rides for Uber in São Paulo out loud", "mock", [33900, 76, 241], [46500, 52, 498], [14200, 64, 167]],
  ["2026-10-18", "Data scientist explains why their A/B test result was not significant", "mock", [27100, 74, 186], [30400, 50, 301], [11300, 61, 122]],
  ["2026-10-17", "Engineering manager on the difference between senior and staff answers", "conversational", [31500, 69, 263], [52900, 47, 689], [19700, 60, 284]],
  ["2026-10-16", "Candidate adds a cache and the interviewer asks what happens on a miss", "mock", [44800, 81, 352], [61200, 57, 743], [21600, 68, 259]],
  ["2026-10-15", "Recruiter breaks down a real Big Tech offer line by line", "conversational", [39600, 66, 418], [94100, 51, 1527], [33800, 62, 602]],
  ["2026-10-14", "Airbnb PM candidate is asked to cut their roadmap in half", "mock", [21900, 73, 138], [25600, 48, 247], [10100, 59, 104]],
  ["2026-10-13", "Candidate catches their own off-by-one error in a binary search", "mock", [26400, 79, 171], [28700, 55, 269], [9400, 63, 88]],
  ["2026-10-12", "Former Stripe PM on the one question they ask every candidate", "conversational", [19800, 62, 121], [34500, 45, 412], [13600, 57, 173]],
];

export const mockPostedClips: PostedClip[] = rows.map(
  ([date, title, format, youtube, tiktok, instagram], i) => {
    const metrics = (m: [number, number, number]) => ({
      views: m[0],
      avgPercentWatched: m[1],
      shares: m[2],
    });
    return {
      id: `posted-${String(rows.length - i).padStart(2, "0")}`,
      title,
      format,
      postedAt: `${date}T16:00:00Z`,
      metrics: {
        youtube: metrics(youtube),
        tiktok: metrics(tiktok),
        instagram: metrics(instagram),
      },
    };
  },
);
