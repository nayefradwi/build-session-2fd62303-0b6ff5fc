import { NextRequest, NextResponse } from "next/server";

/**
 * Lightweight session-aware middleware.
 *
 * The full session lookup happens in route handlers (it touches the
 * database, which we don't want to do on the Edge for every request).
 * Here we just:
 *   1. Read the session cookie if present.
 *   2. Forward its value as an `x-session-id` request header so server
 *      components / route handlers can avoid re-parsing cookies.
 *
 * This intentionally does NOT enforce auth — protected routes should
 * call `getCurrentUser()` from `@/lib/server/auth` and return 401 as
 * appropriate. Edge-incompatible code (bcrypt, drizzle) stays out of
 * this file.
 */

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "session";

export function middleware(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE_NAME)?.value;

  const requestHeaders = new Headers(req.headers);
  if (sessionId) {
    requestHeaders.set("x-session-id", sessionId);
  } else {
    requestHeaders.delete("x-session-id");
  }

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  // Run on every path except Next.js internals and static assets.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map)$).*)",
  ],
};
