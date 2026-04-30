/**
 * Re-enable a disabled user account.
 *
 *   POST /api/admin/users/{id}/enable
 *     Body: (empty)
 *
 *     Clears the `disabled_at` / `disabled_reason` / `disabled_by`
 *     snapshot. The user can log in again immediately, but any sessions
 *     that were revoked at disable-time are NOT restored — the user must
 *     authenticate again to obtain a fresh session cookie.
 *
 *     Idempotency-aware: a 409 is returned when the account is already
 *     enabled.
 *
 *     The acting admin cannot toggle their own account (`409 self_action`).
 *
 * Authn / authz:
 *   - 401 when no session.
 *   - 403 when the session belongs to a non-admin user.
 *   - 404 when the id is malformed or the user does not exist.
 */
import { NextResponse } from "next/server";

import {
  AuthRequiredError,
  ForbiddenError,
  requireAdmin,
} from "@/lib/server/auth";
import { setUserDisabled } from "@/lib/server/admin-users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ErrorBody {
  error: string;
  code: string;
  details?: Record<string, unknown>;
}

function errorResponse(
  status: number,
  body: ErrorBody,
): NextResponse<ErrorBody> {
  return NextResponse.json(body, { status });
}

function unauthorized() {
  return errorResponse(401, {
    error: "Authentication required",
    code: "unauthenticated",
  });
}

function forbidden() {
  return errorResponse(403, {
    error: "Admin role required",
    code: "forbidden",
  });
}

function notFound() {
  return errorResponse(404, {
    error: "User not found",
    code: "not_found",
  });
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(_req: Request, ctx: RouteParams) {
  let actor;
  try {
    actor = await requireAdmin();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    if (err instanceof ForbiddenError) return forbidden();
    throw err;
  }

  const { id } = await ctx.params;
  if (!id) return notFound();

  try {
    const outcome = await setUserDisabled({
      userId: id,
      disabled: false,
      actorUserId: actor.id,
    });
    if (outcome.ok) {
      return NextResponse.json({ user: outcome.data }, { status: 200 });
    }
    switch (outcome.error.code) {
      case "not_found":
        return notFound();
      case "self_action":
        return errorResponse(409, {
          error: outcome.error.message,
          code: "self_action",
        });
      case "stale_status":
        return errorResponse(409, {
          error: "User account is already enabled",
          code: "stale_status",
          details: { currentStatus: outcome.error.currentStatus },
        });
      case "validation_failed":
        // Not used by the enable path (no body), but included so the
        // exhaustive switch type-checks.
        return errorResponse(400, {
          error: outcome.error.message,
          code: "validation_failed",
        });
    }
  } catch (err) {
    console.error(`[POST /api/admin/users/${id}/enable] failed`, err);
    return errorResponse(500, {
      error: "Failed to enable user",
      code: "internal_error",
    });
  }
}
