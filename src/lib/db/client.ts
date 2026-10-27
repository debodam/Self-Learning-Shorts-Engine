import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { isIntegrationConnected } from "@/lib/integrations/config";

export type Db = SupabaseClient<Database>;

let client: Db | null = null;

/**
 * Server-side Supabase client using the service role key, or null when Supabase
 * isn't configured. Callers fall back to mock data on null.
 */
export function getDb(): Db | null {
  // Same check as the Settings page, so "connected" there means real data here.
  if (!isIntegrationConnected("supabase")) return null;
  client ??= createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return client;
}
