// Data access layer. Every function reads from Supabase when it's configured
// and returns mock data otherwise, so the app always runs without keys.
export { getCandidateClips, getSyncedOpusProjectIds, getUnscoredClips } from "@/lib/db/clips";
export { getWeeklyLearnings } from "@/lib/db/learnings";
export { getPostedClips } from "@/lib/db/performance";
