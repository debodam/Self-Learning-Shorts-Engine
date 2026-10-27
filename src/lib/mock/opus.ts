import type { OpusClip, OpusProject, OpusScheduledPost } from "@/lib/integrations/opus";

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
