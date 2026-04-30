/**
 * Admin analytics — recent orders.
 *
 *   GET /api/admin/analytics/recent-orders
 *     Most recently created orders, joined with the customer for the
 *     dashboard side panel. Admin-only.
 *
 *     Query parameters (all optional):
 *       - dateFrom    ISO 8601. Inclusive lower bound on `orders.created_at`.
 *       - dateTo      ISO 8601. Inclusive upper bound on `orders.created_at`.
 *       - limit       1..50, default 10.
 *       - bypassCache `1` / `true` skips the in-process cache.
 *
 *     Response shape: see `RecentOrdersResult` in `lib/server/admin-analytics`.
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
  RECENT_ORDERS_DEFAULT_LIMIT,
  RECENT_ORDERS_MAX_LIMIT,
  getRecentOrders,
} from "@/lib/server/admin-analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ErrorBody {
  error: string;
  code: string;
  fieldErrors?: Record<string, string[]>;
}

function errorResponse(
  status: number,
  body: ErrorBody,
): NextResponse<ErrorBody> {
  return NextResponse.json(body, { status });
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

function parseBool(raw: string | null): boolean {
  if (raw === null) return false;
  const v = raw.toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export async function GET(req: Request) {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      return errorResponse(401, {
        error: "Authentication required",
        code: "unauthenticated",
      });
    }
    if (err instanceof ForbiddenError) {
      return errorResponse(403, {
        error: "Admin role required",
        code: "forbidden",
      });
    }
    throw err;
  }

  const url = new URL(req.url);
  const params = url.searchParams;

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
  const limitParsed = parseInteger(
    params.get("limit"),
    "limit",
    1,
    RECENT_ORDERS_MAX_LIMIT,
  );
  if (!limitParsed.ok) return errorResponse(400, limitParsed.error);
  const bypassCache = parseBool(params.get("bypassCache"));

  try {
    const result = await getRecentOrders({
      dateFrom: dateFrom.value,
      dateTo: dateTo.value,
      limit: limitParsed.value ?? RECENT_ORDERS_DEFAULT_LIMIT,
      bypassCache,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[GET /api/admin/analytics/recent-orders] failed", err);
    return errorResponse(500, {
      error: "Failed to fetch recent orders",
      code: "internal_error",
    });
  }
}
