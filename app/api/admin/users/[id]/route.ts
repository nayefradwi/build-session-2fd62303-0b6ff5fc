/**
 * Admin user detail and delete.
 *
 *   GET /api/admin/users/{id}
 *     Full user detail (profile + status + addresses + order history +
 *     aggregate totals). Admin-only.
 *
 *   DELETE /api/admin/users/{id}
 *     Hard-delete a user account. Refused with `409 has_orders` when the
 *     user has any order rows — admins must use disable instead so the
 *     order ledger keeps its FK back to the customer. The acting admin
 *     cannot delete their own account (`409 self_action`).
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
import {
  deleteAdminUser,
  getAdminUserDetail,
} from "@/lib/server/admin-users";

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

export async function GET(_req: Request, ctx: RouteParams) {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    if (err instanceof ForbiddenError) return forbidden();
    throw err;
  }

  const { id } = await ctx.params;
  if (!id) return notFound();

  try {
    const detail = await getAdminUserDetail(id);
    if (!detail) return notFound();
    return NextResponse.json({ user: detail }, { status: 200 });
  } catch (err) {
    console.error(`[GET /api/admin/users/${id}] failed`, err);
    return errorResponse(500, {
      error: "Failed to load user",
      code: "internal_error",
    });
  }
}

export async function DELETE(_req: Request, ctx: RouteParams) {
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
    const result = await deleteAdminUser({
      userId: id,
      actorUserId: actor.id,
    });
    if (result.ok) {
      return new NextResponse(null, { status: 204 });
    }
    switch (result.error.code) {
      case "not_found":
        return notFound();
      case "self_action":
        return errorResponse(409, {
          error: result.error.message,
          code: "self_action",
        });
      case "has_orders":
        return errorResponse(409, {
          error: result.error.message,
          code: "has_orders",
          details: { orderCount: result.error.orderCount },
        });
    }
  } catch (err) {
    console.error(`[DELETE /api/admin/users/${id}] failed`, err);
    return errorResponse(500, {
      error: "Failed to delete user",
      code: "internal_error",
    });
  }
}
