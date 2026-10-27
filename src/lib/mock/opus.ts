import type { OpusClip, OpusProject, OpusScheduledPost, OpusSocialAccount } from "@/lib/integrations/opus";

// Stand-in OpusClip responses for when OPUSCLIP_API_KEY isn't set.

export const mockOpusProjects: OpusProject[] = [
  {
    id: "P3102615bkxa",
    title: "Google PM Mock Interview: Design a Parking App",
    sourceUrl: "https://www.youtube.com/watch?v=aced0000001",
    createdAt: "2026-10-19T14:02:11Z",
    stage: "COMPLETE",
    clipCount: 2,
  },
  {
    id: "P3102615mzq7",
    title: "Meta System Design Mock Interview: Design Instagram",
    sourceUrl: "https://www.youtube.com/watch?v=aced0000004",
    createdAt: "2026-10-20T15:40:53Z",
    stage: "COMPLETE",
    clipCount: 1,
  },
];

export const mockOpusClips: OpusClip[] = [
  {
    id: "P3102615bkxa.qU3iVMSO77",
    clipId: "qU3iVMSO77",
    projectId: "P3102615bkxa",
    title: "Google PM candidate asks who the user is before designing anything",
    description: "The candidate pauses before sketching features and asks who the parking app is for.",
    hashtags: ["#productmanagement", "#mockinterview", "#pminterview"],
    transcript:
      "Interviewer: Design a parking app. Candidate: Before I jump in, who are we building this for? Commuters who park daily, or people visiting a city once? Those need very different products.",
    durationSeconds: 48,
    opusScore: null,
    previewUrl: "https://storage.example.com/opus/preview/qU3iVMSO77.mp4",
    thumbnailUrl: null,
    exportUrl: "https://storage.example.com/opus/export/qU3iVMSO77.mp4",
    createdAt: "2026-10-19T14:20:40Z",
  },
  {
    id: "P3102615bkxa.Lr8TdQ2wXa",
    clipId: "Lr8TdQ2wXa",
    projectId: "P3102615bkxa",
    title: "Candidate picks one success metric for a parking app",
    description: "Asked how they would measure success, the candidate commits to a single metric and explains why.",
    hashtags: ["#productmanagement", "#metrics"],
    transcript:
      "Interviewer: How would you know this worked? Candidate: I'd track the share of trips where someone finds a spot within five minutes of arriving.",
    durationSeconds: 39,
    opusScore: null,
    previewUrl: "https://storage.example.com/opus/preview/Lr8TdQ2wXa.mp4",
    thumbnailUrl: null,
    exportUrl: "https://storage.example.com/opus/export/Lr8TdQ2wXa.mp4",
    createdAt: "2026-10-19T14:20:40Z",
  },
  {
    id: "P3102615mzq7.Vb2Kp9YtRe",
    clipId: "Vb2Kp9YtRe",
    projectId: "P3102615mzq7",
    title: "Interviewer pushes back on a 10x traffic estimate for Instagram feed",
    description: "The interviewer questions the candidate's traffic estimate and the candidate reworks it out loud.",
    hashtags: ["#systemdesign", "#mockinterview"],
    transcript:
      "Interviewer: Where does 10x come from? Candidate: Fair, I assumed every user refreshes ten times a day. Let me redo that with real numbers.",
    durationSeconds: 55,
    opusScore: null,
    previewUrl: "https://storage.example.com/opus/preview/Vb2Kp9YtRe.mp4",
    thumbnailUrl: null,
    exportUrl: "https://storage.example.com/opus/export/Vb2Kp9YtRe.mp4",
    createdAt: "2026-10-20T16:05:12Z",
  },
];

export const mockOpusScheduledPosts: OpusScheduledPost[] = [
  {
    scheduleId: "sch_8k2m4n6p",
    projectId: "P3102615bkxa",
    clipId: "qU3iVMSO77",
    postAccountId: "acct_youtube_aced",
    publishAt: "2026-10-27T16:00:00.000Z",
    title: "Google PM candidate asks who the user is first",
  },
  {
    scheduleId: "sch_9q3r5s7t",
    projectId: "P3102615bkxa",
    clipId: "qU3iVMSO77",
    postAccountId: "acct_tiktok_aced",
    publishAt: "2026-10-27T16:00:00.000Z",
    title: "A Google PM candidate asks who the app is for before designing it.",
  },
];

/** Same names as the real organization's accounts, so the account checks can be tested. */
export const mockSocialAccounts: OpusSocialAccount[] = [
  { postAccountId: "mock_youtube_exponent", platform: "YOUTUBE", name: "Exponent", subAccountId: null, profileUrl: "https://www.youtube.com/channel/mock-exponent" },
  { postAccountId: "mock_youtube_ace_your_interviews", platform: "YOUTUBE", name: "Ace Your Interviews", subAccountId: null, profileUrl: null },
  { postAccountId: "mock_tiktok_aced", platform: "TIKTOK_BUSINESS", name: "Aced (formerly Exponent)", subAccountId: null, profileUrl: "https://www.tiktok.com/@aced_io" },
  { postAccountId: "mock_instagram_aced", platform: "INSTAGRAM_BUSINESS", name: "Aced (formerly Exponent)", subAccountId: "mock_ig_sub", profileUrl: "https://www.instagram.com/aced__io" },
];

const MOCK_CLIP_SCRIPTS: { title: string; transcript: string; durationSeconds: number }[] = [
  {
    title: "Interviewer pushes back on the candidate's first metric",
    transcript:
      "Interviewer: You said daily active users. Why would that tell you the feature worked? Candidate: Fair point. DAU could go up for reasons unrelated to the feature. I'd look at the share of new users who complete their first booking within a week instead.",
    durationSeconds: 46,
  },
  {
    title: "Hiring manager on the one question they ask every PM",
    transcript:
      "Every PM interview I run, I ask one question: tell me about a time you killed your own project. The candidates who have a real answer, with numbers and what they learned, are the ones I hire. The ones who say they've never killed anything worry me.",
    durationSeconds: 38,
  },
  {
    title: "Candidate structures a system design answer in 30 seconds",
    transcript:
      "Candidate: Before I draw anything, let me lay out how I'll approach this. First requirements and scale, then the API, then the data model, then I'll go deep on the feed ranking since that's the hard part. Interviewer: Good, that's exactly the structure I want to see.",
    durationSeconds: 41,
  },
  {
    title: "Recruiter explains why candidates get ghosted after onsites",
    transcript:
      "So, um, yeah, like I mentioned earlier with the second team, that's kind of where it goes, you know, it depends on the thing we talked about before.",
    durationSeconds: 29,
  },
  {
    title: "Candidate admits a mistake and recovers mid-interview",
    transcript:
      "Candidate: Actually, wait. I double counted the storage. If each post is a kilobyte and we have a billion a day, that's a terabyte a day, not ten. Let me redo the estimate. Interviewer: I like that you caught that yourself.",
    durationSeconds: 52,
  },
  {
    title: "Engineer's advice on negotiating a competing offer",
    transcript:
      "When you have a competing offer, don't lead with the number. Lead with the team you want to join and why, then say the other offer is higher and ask if they can close the gap. Recruiters can move much more for someone they know wants to be there.",
    durationSeconds: 44,
  },
];

/**
 * Six plausible clips for any mock project, so the weekly flow can be tested end to end
 * without Opus. No media URLs, so the scorer judges them from transcripts alone.
 */
export function mockOpusClipsFor(projectId: string): OpusClip[] {
  return MOCK_CLIP_SCRIPTS.map((script, i) => {
    const clipId = `mock${i + 1}`;
    return {
      id: `${projectId}.${clipId}`,
      clipId,
      projectId,
      title: script.title,
      description: null,
      hashtags: [],
      transcript: script.transcript,
      durationSeconds: script.durationSeconds,
      opusScore: null,
      previewUrl: null,
      thumbnailUrl: null,
      exportUrl: null,
      createdAt: new Date().toISOString(),
    };
  });
}
