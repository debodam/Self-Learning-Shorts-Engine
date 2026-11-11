// Data access layer. Every function reads from Supabase when it's configured
// and returns mock data otherwise, so the app always runs without keys.
export { getLastScoringRunSummary, getReviewClips, getSyncedOpusProjectIds, getUpcomingPosts, getWeeks, withPickRenders } from "@/lib/db/clips";
export type { UpcomingPost, Week, WeekVideo } from "@/lib/db/clips";
export { getPostedClips } from "@/lib/db/performance";
