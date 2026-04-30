/**
 * Admin orders collection.
 *
 *   GET /api/admin/orders
 *     Paginated list across every customer's orders. Admin-only.
 *
 *     Query parameters (all optional):
 *       - status         all (default) | pending | paid | processing |
 *                        shipped | delivered | cancelled
 *       - dateFrom       ISO 8601 date/time. Inclusive lower bound on
 *                        `orders.created_at`.
 *       - dateTo         ISO 8601 date/time. Inclusive upper bound on
 *                        `orders.created_at`.
 *       - q              Free-text search. Matches the order id (full
 *                        UUID OR partial — admins can paste the short
 *                        order number), customer email, customer name,
 *                        shipping recipient, or discount code.
 *       - page           1-indexed page number (default 1).
 *       - pageSize       Items per page (default 25, max 100).
 *
 *     Response: `{ items, page, pageSize, total, totalPages, hasMore }`.
 *
 * Authn / authz:
 *   - 401 when no session.
 *   - 403 when the session belongs to a non-admin user.
 */
import { NextResponse } from "next/server";

import {
  AuthRequiredError,
  ForbiddenError,
  requireAdmin,
} from "@/lib/server/auth";
import {
  ADMIN_ORDERS_DEFAULT_PAGE_SIZE,
  ADMIN_ORDERS_MAX_PAGE_SIZE,
  ADMIN_ORDER_STATUS_FILTERS,
  listAdminOrders,
  parseAdminOrderStatusFilter,
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

function parseInteger(
  raw: string | null,
  field: string,
  min: number,
  max: number,
): { ok: true; value: number | undefined } | { ok: false; error: ErrorBody } {
  if (raw === null || raw === "") return { ok: true, value: undefined };
  if (!/^-?\d+$/.test(raw)) {
    return {
      ok: false,
      error: {
        error: `\`${field}\` must be an integer`,
        code: "validation_failed",
        fieldErrors: { [field]: ["Expected an integer"] },
      },
    };
  }
  const parsed = parseInt(raw, 10);
  if (parsed < min || parsed > max) {
    return {
      ok: false,
      error: {
        error: `\`${field}\` must be between ${min} and ${max}`,
        code: "validation_failed",
        fieldErrors: { [field]: [`Out of range (${min}-${max})`] },
      },
    };
  }
  return { ok: true, value: parsed };
}

function parseIsoDate(
  raw: string | null,
  field: string,
):
  | { ok: true; value: Date | undefined }
  | { ok: false; error: ErrorBody } {
  if (raw === null || raw === "") return { ok: true, value: undefined };
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    return {
      ok: false,
      error: {
        error: `\`${field}\` must be a valid ISO 8601 date/time`,
        code: "validation_failed",
        fieldErrors: { [field]: ["Could not parse as a date"] },
      },
    };
  }
  return { ok: true, value: d };
}

export async function GET(req: Request) {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    if (err instanceof ForbiddenError) return forbidden();
    throw err;
  }

  const url = new URL(req.url);
  const params = url.searchParams;

  const statusRaw = params.get("status");
  const statusFilter = parseAdminOrderStatusFilter(statusRaw);
  if (statusFilter === null) {
    return errorResponse(400, {
      error: `\`status\` must be one of: ${ADMIN_ORDER_STATUS_FILTERS.join(", ")}`,
      code: "validation_failed",
      fieldErrors: { status: ["Invalid status"] },
    });
  }

  const pageParsed = parseInteger(params.get("page"), "page", 1, 1_000_000);
  if (!pageParsed.ok) return errorResponse(400, pageParsed.error);

  const pageSizeParsed = parseInteger(
    params.get("pageSize"),
    "pageSize",
    1,
    ADMIN_ORDERS_MAX_PAGE_SIZE,
  );
  if (!pageSizeParsed.ok) return errorResponse(400, pageSizeParsed.error);

  const dateFrom = parseIsoDate(params.get("dateFrom"), "dateFrom");
  if (!dateFrom.ok) return errorResponse(400, dateFrom.error);
  const dateTo = parseIsoDate(params.get("dateTo"), "dateTo");
  if (!dateTo.ok) return errorResponse(400, dateTo.error);
  if (
    dateFrom.value &&
    dateTo.value &&
    dateFrom.value.getTime() > dateTo.value.getTime()
  ) {
    return errorResponse(400, {
      error: "`dateFrom` must be earlier than or equal to `dateTo`",
      code: "validation_failed",
      fieldErrors: { dateFrom: ["dateFrom > dateTo"] },
    });
  }

  const q = params.get("q") ?? undefined;

  try {
    const result = await listAdminOrders({
      status: statusFilter,
      page: pageParsed.value ?? 1,
      pageSize: pageSizeParsed.value ?? ADMIN_ORDERS_DEFAULT_PAGE_SIZE,
      dateFrom: dateFrom.value,
      dateTo: dateTo.value,
      q: q && q.trim().length > 0 ? q.trim() : undefined,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[GET /api/admin/orders] failed", err);
    return errorResponse(500, {
      error: "Failed to list orders",
      code: "internal_error",
    });
  }
}
