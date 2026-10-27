import type { WeeklyLearning } from "@/lib/learnings";

// Stand-in for the agent's weekly learning report (Phase 3), newest first.
export const mockWeeklyLearnings: WeeklyLearning[] = [
  {
    id: "week-2026-10-19",
    weekStart: "2026-10-19",
    weekEnd: "2026-10-25",
    whatWorked: [
      "The interviewer interrupting a candidate who started coding early was the top clip on all three platforms, with 87.2K TikTok views and 1,183 shares.",
      "Mock interview clips averaged 80% watched on YouTube, 13 points above conversational clips.",
      "TikTok views rose 10% over last week while posting the same number of clips.",
    ],
    whatChanged: [
      "Raised the Tension weight for mock interview clips when ranking the shortlist.",
      "Start mock clips on the interviewer's pushback instead of the candidate's setup.",
      "Shortlist at least 2 clips per week where the interviewer corrects a process mistake.",
    ],
    why: "This week's best clip opened on the interviewer stepping in. Similar past clips retrieved from the archive, like the cache miss clip from Oct 16, show the same pattern: clips that open on a correction keep viewers longer than clips that open on the question.",
  },
  {
    id: "week-2026-10-12",
    weekStart: "2026-10-12",
    weekEnd: "2026-10-18",
    whatWorked: [
      "The recruiter breaking down a real offer line by line led TikTok and Instagram, with 94.1K TikTok views and the most Instagram shares of any clip so far.",
      "That offer clip also had the highest TikTok shares per view of any clip posted.",
    ],
    whatChanged: [
      "Added compensation and offers as a tracked topic so the agent can balance it in the shortlist.",
      "Cap compensation clips at 2 per week to keep the feed focused on interview prep.",
    ],
    why: "Shares drive reach on TikTok and Instagram, and offer clips get shared far more than anything else. Capping them keeps the channel about interviews while still using the topic that travels best.",
  },
  {
    id: "week-2026-10-05",
    weekStart: "2026-10-05",
    weekEnd: "2026-10-11",
    whatWorked: [
      "Clips under 45 seconds averaged 12 points higher watch time on Instagram than clips over 55 seconds.",
      "Titles naming the company and role, like \"Airbnb PM candidate\", beat generic titles on YouTube click-through.",
    ],
    whatChanged: [
      "Target 35 to 50 seconds when trimming clips, and flag anything over 55 seconds for review.",
      "Title prompt now asks for the company and role whenever the source video names them.",
    ],
    why: "Shorter clips loop more often on Instagram, which lifts average watch time. Specific titles set accurate expectations, so viewers who click tend to stay.",
  },
  {
    id: "week-2026-09-28",
    weekStart: "2026-09-28",
    weekEnd: "2026-10-04",
    whatWorked: [
      "Split layout clips with both the interviewer and candidate visible outperformed single-speaker crops by 18% on average watch time.",
    ],
    whatChanged: [
      "Reject any clip where a speaking person is cropped out of frame.",
      "Use split layout by default whenever 2 or more people speak in the clip.",
    ],
    why: "Viewers follow the exchange better when they can see who is reacting. Single-speaker crops lost viewers at the moment the other person started talking.",
  },
];
