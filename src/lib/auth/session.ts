// Site-wide password gate: session tokens. Used by the proxy (src/proxy.ts), the login
// route, and server actions. Uses only Web Crypto, so it runs anywhere.
//
// The cookie never holds the password. It holds "<issued ms>.<HMAC>", signed with a key
// derived from DASHBOARD_PASSWORD, so changing the password signs everyone out.

export const SESSION_COOKIE = "aced_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const encoder = new TextEncoder();

/** The configured password, or null when DASHBOARD_PASSWORD isn't set (the gate then fails closed). */
export function dashboardPassword() {
  return process.env.DASHBOARD_PASSWORD?.trim() || null;
}

async function hmac(key: string, message: string) {
  const cryptoKey = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return Buffer.from(sig).toString("base64url");
}

/** Constant-time string comparison, so timing doesn't reveal how much matched. */
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const signingKey = (password: string) => `aced-dashboard-session-v1:${password}`;

/** Whether a submitted password is right. Compares HMACs so the check is constant-time. */
export async function passwordMatches(submitted: string) {
  const password = dashboardPassword();
  if (!password) return false;
  const [a, b] = await Promise.all([hmac("aced-password-check", submitted), hmac("aced-password-check", password)]);
  return safeEqual(a, b);
}

export async function createSessionToken(now = Date.now()) {
  const password = dashboardPassword();
  if (!password) throw new Error("DASHBOARD_PASSWORD isn't set.");
  const issued = String(now);
  return `${issued}.${await hmac(signingKey(password), issued)}`;
}

/** True for a token this password signed that hasn't expired. */
export async function verifySessionToken(token: string | undefined, now = Date.now()) {
  const password = dashboardPassword();
  if (!password || !token) return false;
  const [issued, sig] = token.split(".");
  if (!issued || !sig || !/^\d+$/.test(issued)) return false;
  const age = now - Number(issued);
  if (age < 0 || age > SESSION_MAX_AGE_SECONDS * 1000) return false;
  return safeEqual(sig, await hmac(signingKey(password), issued));
}
