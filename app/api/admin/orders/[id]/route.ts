/**
 * Admin order detail.
 *
 *   GET /api/admin/orders/{id}
 *     Full detail for a single order (header + customer + line items +
 *     cancellation snapshot if present). Admin-only.
 *
 * Authn / authz:
 *   - 401 when no session.
 *   - 403 when the session belongs to a non-admin user.
 *   - 404 when the id is malformed or the order does not exist.
 */
import { NextResponse } from "next/server";

import {
  AuthRequiredError,
  ForbiddenError,
  requireAdmin,
} from "@/lib/server/auth";
import { getAdminOrder } from "@/lib/server/admin-orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ErrorBody {
  error: string;
  code: string;
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
    error: "Order not found",
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
    const order = await getAdminOrder(id);
    if (!order) return notFound();
    return NextResponse.json({ order }, { status: 200 });
  } catch (err) {
    console.error(`[GET /api/admin/orders/${id}] failed`, err);
    return errorResponse(500, {
      error: "Failed to load order",
      code: "internal_error",
    });
  }
}
