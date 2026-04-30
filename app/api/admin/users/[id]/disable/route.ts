/**
 * Disable a user account.
 *
 *   POST /api/admin/users/{id}/disable
 *     Body: { reason?: string }
 *
 *     Snapshots `disabled_at` / `disabled_reason` / `disabled_by` onto the
 *     user row, and revokes every active session and refresh token for
 *     the target user so a previously-issued cookie stops working
 *     immediately. Idempotency-aware: a 409 is returned when the account
 *     is already disabled (the caller should refresh and retry).
 *
 *     The acting admin cannot disable their own account (`409 self_action`).
 *
 * Authn / authz:
 *   - 401 when no session.
 *   - 403 when the session belongs to a non-admin user.
 *   - 404 when the id is malformed or the user does not exist.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  AuthRequiredError,
  ForbiddenError,
  requireAdmin,
} from "@/lib/server/auth";
import {
  DISABLE_REASON_MAX,
  setUserDisabled,
} from "@/lib/server/admin-users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ErrorBody {
  error: string;
  code: string;
  fieldErrors?: Record<string, string[]>;
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

const disableSchema = z
  .object({
    reason: z
      .union([
        z.string().max(DISABLE_REASON_MAX, "Reason is too long"),
        z.null(),
      ])
      .optional(),
  })
  .strict();

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, ctx: RouteParams) {
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

  // Body is optional — POSTing with no body is treated as { reason: null }.
  let parsed: z.infer<typeof disableSchema> = {};
  const text = await req.text();
  if (text.trim().length > 0) {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return errorResponse(400, {
        error: "Request body must be valid JSON",
        code: "invalid_json",
      });
    }
    const result = disableSchema.safeParse(json);
    if (!result.success) {
      return errorResponse(400, {
        error: "Invalid disable payload",
        code: "validation_failed",
        fieldErrors: result.error.flatten().fieldErrors,
      });
    }
    parsed = result.data;
  }

  try {
    const outcome = await setUserDisabled({
      userId: id,
      disabled: true,
      actorUserId: actor.id,
      reason: parsed.reason ?? null,
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
          error: "User account is already disabled",
          code: "stale_status",
          details: { currentStatus: outcome.error.currentStatus },
        });
      case "validation_failed":
        return errorResponse(400, {
          error: outcome.error.message,
          code: "validation_failed",
          fieldErrors: outcome.error.fields,
        });
    }
  } catch (err) {
    console.error(`[POST /api/admin/users/${id}/disable] failed`, err);
    return errorResponse(500, {
      error: "Failed to disable user",
      code: "internal_error",
    });
  }
}
