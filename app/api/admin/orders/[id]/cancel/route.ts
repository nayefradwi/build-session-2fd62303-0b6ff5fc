/**
 * Admin order cancellation.
 *
 *   POST /api/admin/orders/{id}/cancel
 *     Body: `{ reason: string }` — required free-form admin note.
 *     Marks the order as cancelled and snapshots the actor + timestamp +
 *     reason onto the row. Allowed only from non-terminal statuses
 *     (`pending`, `paid`, `processing`); a delivered or already-cancelled
 *     order is rejected.
 *
 *     Responses:
 *       - 200 `{ order }` on success.
 *       - 400 on a missing / malformed reason.
 *       - 401 / 403 — no session / non-admin.
 *       - 404 when the id is unknown.
 *       - 409 `{ code: "not_cancellable", details: { currentStatus, cancellable } }`
 *         when the order is already cancelled or delivered.
 *       - 409 `{ code: "stale_status", details: { currentStatus } }` when
 *         a concurrent admin transitioned the order between read and
 *         write.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  AuthRequiredError,
  ForbiddenError,
  requireAdmin,
} from "@/lib/server/auth";
import {
  CANCEL_REASON_MAX,
  cancelOrder,
  type CancelOrderError,
} from "@/lib/server/admin-orders";

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

const cancelSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "reason is required")
    .max(CANCEL_REASON_MAX, `reason is too long (max ${CANCEL_REASON_MAX})`),
});

function cancelErrorResponse(err: CancelOrderError): NextResponse<ErrorBody> {
  switch (err.code) {
    case "not_found":
      return errorResponse(404, {
        error: "Order not found",
        code: "not_found",
      });
    case "not_cancellable":
      return errorResponse(409, {
        error: `Order cannot be cancelled from status "${err.currentStatus}"`,
        code: "not_cancellable",
        details: {
          currentStatus: err.currentStatus,
          cancellable: [...err.cancellable],
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

export async function POST(req: Request, ctx: RouteParams) {
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

  const parsed = cancelSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(400, {
      error: "Invalid cancellation payload",
      code: "validation_failed",
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    const result = await cancelOrder({
      orderId: id,
      reason: parsed.data.reason,
      userId: admin.id,
    });
    if (!result.ok) return cancelErrorResponse(result.error);
    return NextResponse.json({ order: result.data }, { status: 200 });
  } catch (err) {
    console.error(`[POST /api/admin/orders/${id}/cancel] failed`, err);
    return errorResponse(500, {
      error: "Failed to cancel order",
      code: "internal_error",
    });
  }
}
