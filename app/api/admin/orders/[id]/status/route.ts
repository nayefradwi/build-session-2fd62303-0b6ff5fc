/**
 * Admin order status transition.
 *
 *   PATCH /api/admin/orders/{id}/status
 *     Body: `{ to: "processing" | "shipped" | "delivered" | "paid" }`.
 *     Transitions the order along the linear forward state machine
 *     (`pending → processing → shipped → delivered`). The shorthand
 *     `paid` ↔ `processing` is honoured for orders created via the
 *     customer checkout path.
 *
 *     Cancellations live on a separate endpoint
 *     (`POST /api/admin/orders/{id}/cancel`) because they require a
 *     reason; this endpoint refuses `to: "cancelled"` outright.
 *
 *     Responses:
 *       - 200 `{ order }` on success.
 *       - 400 on a malformed body / unknown status target.
 *       - 401 / 403 — no session / non-admin.
 *       - 404 when the id is unknown.
 *       - 409 `{ code: "invalid_transition", details: { from, to, allowed } }`
 *         when the requested transition would skip a step or move
 *         backwards.
 *       - 409 `{ code: "stale_status", details: { currentStatus } }` when
 *         a concurrent admin moved the order between read and write —
 *         clients should re-read the order before retrying.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  AuthRequiredError,
  ForbiddenError,
  requireAdmin,
} from "@/lib/server/auth";
import {
  ORDER_STATUSES,
  transitionOrderStatus,
  type OrderTransitionError,
} from "@/lib/server/admin-orders";
import type { OrderStatus } from "@/lib/db/schema";

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

const ORDER_STATUS_VALUES = ORDER_STATUSES as readonly [string, ...string[]];

const transitionSchema = z.object({
  to: z.enum(ORDER_STATUS_VALUES),
});

function transitionErrorResponse(
  err: OrderTransitionError,
): NextResponse<ErrorBody> {
  switch (err.code) {
    case "not_found":
      return errorResponse(404, {
        error: "Order not found",
        code: "not_found",
      });
    case "invalid_transition":
      return errorResponse(409, {
        error: `Cannot transition from "${err.from}" to "${err.to}"`,
        code: "invalid_transition",
        details: {
          from: err.from,
          to: err.to,
          allowed: err.allowed,
        },
      });
    case "stale_status":
      return errorResponse(409, {
        error: "Order status changed under us — re-read before retrying",
        code: "stale_status",
        details: { currentStatus: err.currentStatus },
      });
    case "validation_failed":
      return errorResponse(400, {
        error: err.message,
        code: "validation_failed",
        fieldErrors: err.fields,
      });
  }
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: Request, ctx: RouteParams) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    if (err instanceof ForbiddenError) return forbidden();
    throw err;
  }

  const { id } = await ctx.params;
  if (!id) {
    return errorResponse(404, { error: "Order not found", code: "not_found" });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return errorResponse(400, {
      error: "Request body must be valid JSON",
      code: "invalid_json",
    });
  }

  const parsed = transitionSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(400, {
      error: "Invalid status transition payload",
      code: "validation_failed",
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    const result = await transitionOrderStatus({
      orderId: id,
      to: parsed.data.to as OrderStatus,
      userId: admin.id,
    });
    if (!result.ok) return transitionErrorResponse(result.error);
    return NextResponse.json({ order: result.data }, { status: 200 });
  } catch (err) {
    console.error(
      `[PATCH /api/admin/orders/${id}/status] failed`,
      err,
    );
    return errorResponse(500, {
      error: "Failed to transition order status",
      code: "internal_error",
    });
  }
}
