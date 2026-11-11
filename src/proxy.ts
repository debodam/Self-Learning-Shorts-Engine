import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

// Site-wide password gate (Next.js 16 renamed middleware to proxy). Every page, API
// route, and server action needs a valid session cookie, except the login page itself.
// Server actions also check the session on their own (src/lib/auth/require.ts), so a
// matcher change can't silently expose them.

const PUBLIC_PATHS = new Set(["/login"]);

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  if (await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  // API routes, server actions (POSTs), and other non-page requests get a plain 401.
  const isPageView = request.method === "GET" && !pathname.startsWith("/api/") && !request.headers.has("next-action");
  if (!isPageView) {
    return NextResponse.json({ error: "Password required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except Next's build assets and the favicon, which hold no data.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
