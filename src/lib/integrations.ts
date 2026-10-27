import "server-only";

export type Integration = {
  id: string;
  name: string;
  description: string;
  envVars: string[];
};

// Keep in sync with .env.example.
export const integrations: Integration[] = [
  {
    id: "supabase",
    name: "Supabase",
    description: "Postgres and pgvector storage for clips, metrics, and embeddings.",
    envVars: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
  },
  {
    id: "claude",
    name: "Claude",
    description: "Scores clips, writes titles and captions, and runs the weekly learning report.",
    envVars: ["ANTHROPIC_API_KEY"],
  },
  {
    id: "opus",
    name: "OpusClip",
    description: "Cuts long-form videos into candidate clips and handles reframing.",
    envVars: ["OPUSCLIP_API_KEY"],
  },
  {
    id: "youtube",
    name: "YouTube",
    description: "Data and Analytics APIs for source videos, Shorts posting, and metrics.",
    envVars: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN", "YOUTUBE_CHANNEL_ID"],
  },
  {
    id: "instagram",
    name: "Instagram",
    description: "Graph API for Reels posting and metrics.",
    envVars: ["INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_BUSINESS_ACCOUNT_ID"],
  },
  {
    id: "tiktok",
    name: "TikTok",
    description: "Content Posting and Display APIs for posting and metrics.",
    envVars: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_ACCESS_TOKEN"],
  },
];

/** Reports which env vars are set. Never returns their values. */
export function integrationStatus(integration: Integration) {
  const missing = integration.envVars.filter((name) => !process.env[name]?.trim());
  return { connected: missing.length === 0, missing };
}

export function isIntegrationConnected(id: string) {
  const integration = integrations.find((i) => i.id === id);
  if (!integration) throw new Error(`Unknown integration: ${id}`);
  return integrationStatus(integration).connected;
}
