import "server-only";

export type Integration = {
  id: string;
  name: string;
  description: string;
  envVars: string[];
  /** The roadmap phase that uses it (see CLAUDE.md). Settings only lists live phases. */
  phase: 1 | 2 | 3;
};

// Keep in sync with .env.example.
export const integrations: Integration[] = [
  {
    id: "supabase",
    phase: 1,
    name: "Supabase",
    description: "Postgres and pgvector storage for clips, metrics, and embeddings.",
    envVars: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
  },
  {
    id: "claude",
    phase: 1,
    name: "Claude",
    description: "Scores clips, writes titles and captions, and runs the weekly learning report.",
    envVars: ["ANTHROPIC_API_KEY"],
  },
  {
    id: "opus",
    phase: 1,
    name: "OpusClip",
    description: "Cuts long-form videos into candidate clips and handles reframing.",
    envVars: ["OPUSCLIP_API_KEY"],
  },
  {
    id: "youtube",
    phase: 2,
    name: "YouTube",
    description: "Data API key for public Shorts metrics on the Aced channel: views, likes, and comments.",
    envVars: ["YOUTUBE_API_KEY", "YOUTUBE_CHANNEL_ID"],
  },
  {
    id: "voyage",
    phase: 2,
    name: "Voyage AI",
    description: "Embeddings for clips and Shorts, so scoring can compare a clip with similar past Shorts.",
    envVars: ["VOYAGE_API_KEY"],
  },
  {
    id: "instagram",
    phase: 3,
    name: "Instagram",
    description: "Graph API for Reels posting and metrics.",
    envVars: ["INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_BUSINESS_ACCOUNT_ID"],
  },
  {
    id: "tiktok",
    phase: 3,
    name: "TikTok",
    description: "Content Posting and Display APIs for posting and metrics.",
    envVars: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_ACCESS_TOKEN"],
  },
];

/**
 * OPUSCLIP_MOCK=true forces mock Opus responses even with a key set, to test the weekly
 * flow without spending credits. Unlike a missing key, mock data may then be saved.
 */
export function isOpusMockForced() {
  return process.env.OPUSCLIP_MOCK?.trim() === "true";
}

/** Reports which env vars are set. Never returns their values. */
export function integrationStatus(integration: Integration) {
  const missing = integration.envVars.filter((name) => !process.env[name]?.trim());
  const forcedMock = integration.id === "opus" && isOpusMockForced();
  return { connected: missing.length === 0 && !forcedMock, missing, forcedMock };
}

export function isIntegrationConnected(id: string) {
  const integration = integrations.find((i) => i.id === id);
  if (!integration) throw new Error(`Unknown integration: ${id}`);
  return integrationStatus(integration).connected;
}
