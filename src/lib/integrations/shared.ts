import "server-only";
import type { Platform } from "@/lib/clips";

/** A posted video on YouTube, TikTok, or Instagram, normalized across platforms. */
export type PlatformVideo = {
  platform: Platform;
  /** The platform's own ID (YouTube video ID, TikTok video ID, Instagram media ID). */
  id: string;
  title: string;
  url: string | null;
  publishedAt: string;
  /** Null when the platform doesn't report it (Instagram). */
  durationSeconds: number | null;
};

/**
 * One metrics snapshot for a posted video. Shaped like the metrics table.
 * A field is null when the platform's API doesn't report it.
 */
export type VideoMetrics = {
  platform: Platform;
  videoId: string;
  capturedAt: string;
  views: number | null;
  avgPercentWatched: number | null;
  /**
   * Average seconds watched, for platforms that report time instead of percent
   * (Instagram). Divide by the clip's duration to get a percent.
   */
  avgWatchSeconds: number | null;
  shares: number | null;
  saves: number | null;
  followsGained: number | null;
  comments: number | null;
  likes: number | null;
};

export class IntegrationError extends Error {
  constructor(
    readonly integration: string,
    message: string,
    readonly status?: number,
  ) {
    super(`${integration}: ${message}`);
    this.name = "IntegrationError";
  }
}

/** fetch() that parses JSON and throws IntegrationError on a non-2xx response. */
export async function fetchJson<T>(integration: string, url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new IntegrationError(integration, `${init?.method ?? "GET"} ${url} failed: ${response.status} ${text.slice(0, 500)}`, response.status);
  }
  return (text ? JSON.parse(text) : null) as T;
}

/** Returns the env var, or throws. Only call after checking the integration is connected. */
export function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}
