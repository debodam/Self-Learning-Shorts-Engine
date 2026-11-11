import type { ChannelShort } from "@/lib/integrations/youtube";

// Stand-in Shorts for the Performance page when YOUTUBE_API_KEY or YOUTUBE_CHANNEL_ID is
// missing. Never saved to Supabase.

const rows: [string, number, number, number, number, number][] = [
  // title, days ago, duration seconds, views, likes, comments
  ["How a Stripe GTM lead splits senior and junior analyst work", 2, 48, 3_400, 120, 9],
  ["The one question that sinks most PM candidates", 4, 55, 18_200, 610, 34],
  ["Mock system design: where the candidate lost the interviewer", 6, 59, 9_800, 290, 21],
  ["What Google looks for in a product sense answer", 9, 42, 26_500, 980, 47],
  ["Mock PM interview: prioritizing a roadmap under pressure", 12, 58, 7_100, 205, 12],
  ["Why behavioral answers need numbers", 15, 37, 4_900, 150, 6],
  ["A data scientist on reading A/B test results", 21, 51, 12_300, 402, 19],
  ["Mock interview: estimating Uber rides in New York", 27, 60, 15_700, 530, 41],
];

const DAY_MS = 24 * 60 * 60 * 1000;

export function mockChannelShorts(): ChannelShort[] {
  const now = Date.now();
  return rows.map(([title, daysAgo, durationSeconds, views, likes, comments], i) => ({
    videoId: `mock-short-${i + 1}`,
    title,
    description: "Sample data. Connect YouTube in .env.local to see the real channel.",
    publishedAt: new Date(now - daysAgo * DAY_MS).toISOString(),
    durationSeconds,
    views,
    likes,
    comments,
  }));
}
