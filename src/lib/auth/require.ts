import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

/**
 * Throws unless the request carries a valid dashboard session. Every server action calls
 * this first: the proxy already blocks requests without one, but Next.js recommends
 * checking inside each action too, so a routing change can't expose them.
 */
export async function requireSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await verifySessionToken(token))) throw new Error("Your session ended. Reload the page and enter the password.");
}
