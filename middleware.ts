import { NextRequest, NextResponse } from "next/server";

/**
 * Session-aware middleware.
 *
 * The full session lookup happens in route handlers (it touches the
 * database, which we don't want to do on the Edge for every request).
 * Here we:
 *   1. Read the session cookie if present.
 *   2. Forward its value as an `x-session-id` request header so server
 *      components / route handlers can avoid re-parsing cookies.
 *   3. Cheaply gate "protected" paths by cookie presence — if no
 *      cookie is present at all there's no point proxying the request
 *      to a handler that will only return 401. Real validity checks
 *      still happen downstream via `getCurrentUser()` / `requireUser()`.
 *
 * Edge-incompatible code (bcrypt, drizzle) stays out of this file.
 */

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "session";

/**
 * Path prefixes that require an authenticated session. Frontend
 * pages and backend api routes can both opt in here.
 *
 * Public auth endpoints (`/api/auth/*`) are intentionally NOT in
 * this list — login / register / logout must remain reachable.
 */
const PROTECTED_PREFIXES = ["/api/me", "/api/protected", "/dashboard", "/account"];

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

export function middleware(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const { pathname, search } = req.nextUrl;

  if (isProtectedPath(pathname) && !sessionId) {
    if (isApiPath(pathname)) {
      return NextResponse.json(
        { error: "Authentication required", code: "unauthenticated" },
        { status: 401 },
      );
    }
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

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
