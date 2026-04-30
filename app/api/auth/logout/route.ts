import { NextResponse } from "next/server";

import {
  clearSessionCookie,
  readSessionCookie,
  revokeSession,
} from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/logout
 *
 * Revokes the current DB-backed session (if any) and clears the
 * httpOnly session cookie. Always returns 200 — logging out an
 * already-anonymous client is a no-op, not an error.
 *
 * Because all browser tabs share the cookie store, clearing the
 * cookie here invalidates the session for every tab on the same
 * origin (subject to the next request the tabs make).
 */
export async function POST() {
  const sessionId = await readSessionCookie();
  if (sessionId) {
    try {
      await revokeSession(sessionId);
    } catch {
      // Revocation failure shouldn't block clearing the cookie. The
      // session row remains but it'll expire on its own; meanwhile
      // the user's browser will no longer present it.
    }
  }
  await clearSessionCookie();
  return NextResponse.json({ ok: true }, { status: 200 });
}

/** Some clients prefer GET for logout links — accept both. */
export async function GET() {
  return POST();
}
