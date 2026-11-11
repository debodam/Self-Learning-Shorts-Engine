import { NextResponse, type NextRequest } from "next/server";
import { clientIp, lockedFor, MAX_FAILURES, recordFailure, recordSuccess } from "@/lib/auth/rate-limit";
import { createSessionToken, dashboardPassword, passwordMatches, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/auth/session";

// The password page: a plain HTML form (no layout, no JavaScript) that posts back here.
// The proxy lets /login through; everything else needs the cookie this sets.

/** Only same-site paths, so ?next= can't send someone to another site. */
function safeNext(value: FormDataEntryValue | string | null) {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") && !next.startsWith("/login") ? next : "/review";
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function page(message: string | null, next: string, status = 200) {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Aced Shorts Engine</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f7f7f8; color: #2b2b31;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; padding: 16px; }
  form { width: 100%; max-width: 360px; background: #fff; border: 1px solid #e7e7ea; border-radius: 12px; padding: 28px; }
  h1 { margin: 0 0 4px; font-size: 20px; color: #111114; }
  p { margin: 0 0 20px; font-size: 14px; color: #6b6b76; }
  label { display: block; font-size: 14px; font-weight: 500; color: #111114; margin-bottom: 6px; }
  input { width: 100%; padding: 10px 12px; font-size: 15px; border: 1px solid #e7e7ea; border-radius: 8px; }
  input:focus { outline: 2px solid #5b2ee5; outline-offset: 1px; border-color: transparent; }
  button { margin-top: 16px; width: 100%; padding: 10px 16px; font-size: 14px; font-weight: 500; color: #fff;
    background: #5b2ee5; border: 0; border-radius: 8px; cursor: pointer; }
  button:hover { background: #4c23cc; }
  .error { margin: 12px 0 0; color: #b91c1c; }
</style>
</head>
<body>
<form method="post" action="/login">
  <h1>Aced Shorts Engine</h1>
  <p>Enter the dashboard password.</p>
  <label for="password">Password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
  <input type="hidden" name="next" value="${escapeHtml(next)}">
  <button type="submit">Continue</button>
  ${message ? `<p class="error" role="alert">${escapeHtml(message)}</p>` : ""}
</form>
</body>
</html>`;
  return new NextResponse(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY" },
  });
}

export async function GET(request: NextRequest) {
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  if (!dashboardPassword()) return page("The dashboard password isn't configured. Set DASHBOARD_PASSWORD.", next, 503);
  return page(null, next);
}

export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const next = safeNext(form?.get("next") ?? null);
  if (!dashboardPassword()) return page("The dashboard password isn't configured. Set DASHBOARD_PASSWORD.", next, 503);

  const ip = clientIp(request.headers);
  const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60000));
  const locked = await lockedFor(ip);
  if (locked) return page(`Too many wrong passwords. Try again in ${minutes(locked)} minutes.`, next, 429);

  const password = form?.get("password");
  if (typeof password !== "string" || !(await passwordMatches(password))) {
    const lockout = await recordFailure(ip);
    if (lockout) return page(`Too many wrong passwords. Try again in ${minutes(lockout)} minutes.`, next, 429);
    return page(`Wrong password. ${MAX_FAILURES} wrong tries lock you out for 15 minutes.`, next, 401);
  }

  await recordSuccess(ip);
  const response = NextResponse.redirect(new URL(next, request.url), 303);
  response.cookies.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    // Required on Vercel (HTTPS). Plain-HTTP localhost dev can't keep a Secure cookie in every browser.
    secure: request.nextUrl.protocol === "https:" || process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
