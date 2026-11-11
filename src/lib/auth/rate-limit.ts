import "server-only";
import { getDb } from "@/lib/db/client";

// Lockout for the password gate: 5 wrong passwords lock an IP out for 15 minutes.
// Stored in Supabase (login_attempts) because Vercel's server instances don't share
// memory; falls back to this process's memory when Supabase isn't configured.

export const MAX_FAILURES = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

type Attempt = { failures: number; lastFailedAt: number | null; lockedUntil: number | null };
const memory = new Map<string, Attempt>();

/** The client IP from Vercel's (or any proxy's) forwarding headers. */
export function clientIp(headers: Headers) {
  return headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

async function ipHash(ip: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`aced-login:${ip}`));
  return Buffer.from(digest).toString("hex");
}

async function load(key: string): Promise<Attempt> {
  const db = getDb();
  if (!db) return memory.get(key) ?? { failures: 0, lastFailedAt: null, lockedUntil: null };
  const { data, error } = await db.from("login_attempts").select("failures, last_failed_at, locked_until").eq("ip_hash", key).maybeSingle();
  if (error) throw new Error(`Failed to check login attempts: ${error.message}`);
  return {
    failures: data?.failures ?? 0,
    lastFailedAt: data?.last_failed_at ? Date.parse(data.last_failed_at) : null,
    lockedUntil: data?.locked_until ? Date.parse(data.locked_until) : null,
  };
}

async function save(key: string, a: Attempt) {
  const db = getDb();
  if (!db) {
    memory.set(key, a);
    return;
  }
  const { error } = await db.from("login_attempts").upsert({
    ip_hash: key,
    failures: a.failures,
    last_failed_at: a.lastFailedAt ? new Date(a.lastFailedAt).toISOString() : null,
    locked_until: a.lockedUntil ? new Date(a.lockedUntil).toISOString() : null,
  });
  if (error) throw new Error(`Failed to save login attempts: ${error.message}`);
}

/** Milliseconds left on this IP's lockout, or 0. */
export async function lockedFor(ip: string, now = Date.now()) {
  const a = await load(await ipHash(ip));
  return a.lockedUntil && a.lockedUntil > now ? a.lockedUntil - now : 0;
}

/** Records a wrong password. Returns the lockout length when this one triggers it, else 0. */
export async function recordFailure(ip: string, now = Date.now()) {
  const key = await ipHash(ip);
  const a = await load(key);
  // Failures older than the lockout window, or from before a finished lockout, start over.
  const stale = !a.lastFailedAt || now - a.lastFailedAt > LOCKOUT_MS || (a.lockedUntil !== null && a.lockedUntil <= now);
  const failures = (stale ? 0 : a.failures) + 1;
  const lockedUntil = failures >= MAX_FAILURES ? now + LOCKOUT_MS : null;
  await save(key, { failures: lockedUntil ? 0 : failures, lastFailedAt: now, lockedUntil });
  return lockedUntil ? LOCKOUT_MS : 0;
}

export async function recordSuccess(ip: string) {
  const key = await ipHash(ip);
  await save(key, { failures: 0, lastFailedAt: null, lockedUntil: null });
}
