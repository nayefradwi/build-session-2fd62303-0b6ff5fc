/**
 * Admin order CSV export.
 *
 *   GET /api/admin/orders/export
 *     Streams a CSV containing every order matching the same filters as
 *     `GET /api/admin/orders`. The response is `text/csv` with a stable
 *     header row; column order is fixed and documented in
 *     `lib/server/admin-orders.ts` (`ADMIN_ORDERS_CSV_COLUMNS`).
 *
 *     Query parameters: `status`, `dateFrom`, `dateTo`, `q` — same
 *     semantics as the list endpoint. Pagination is intentionally NOT
 *     supported here; the export is capped at `ADMIN_ORDERS_EXPORT_MAX`
 *     rows. Larger windows should be sliced via `dateFrom` / `dateTo`.
 *
 *     Responses:
 *       - 200 `text/csv; charset=utf-8` with a `Content-Disposition`
 *         header so browsers offer a sensible download filename. The
 *         response carries an `X-Orders-Truncated` header (`"true"` /
 *         `"false"`) so callers can tell whether the export hit the cap.
 *       - 400 on a malformed status / date.
 *       - 401 / 403 — no session / non-admin.
 */
import { NextResponse } from "next/server";

import {
  AuthRequiredError,
  ForbiddenError,
  requireAdmin,
} from "@/lib/server/auth";
import {
  ADMIN_ORDER_STATUS_FILTERS,
  parseAdminOrderStatusFilter,
  streamAdminOrdersCsv,
} from "@/lib/server/admin-orders";

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

function exportFilename(): string {
  // Filename: orders-YYYYMMDD-HHmmss.csv (UTC). Stable for tooling.
  const now = new Date();
  const yyyy = now.getUTCFullYear().toString().padStart(4, "0");
  const mm = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = now.getUTCDate().toString().padStart(2, "0");
  const hh = now.getUTCHours().toString().padStart(2, "0");
  const min = now.getUTCMinutes().toString().padStart(2, "0");
  const ss = now.getUTCSeconds().toString().padStart(2, "0");
  return `orders-${yyyy}${mm}${dd}-${hh}${min}${ss}.csv`;
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
    const result = await streamAdminOrdersCsv({
      status: statusFilter,
      dateFrom: dateFrom.value,
      dateTo: dateTo.value,
      q: q && q.trim().length > 0 ? q.trim() : undefined,
    });
    const filename = exportFilename();
    return new Response(result.csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Orders-Row-Count": String(result.rowCount),
        "X-Orders-Truncated": result.truncated ? "true" : "false",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[GET /api/admin/orders/export] failed", err);
    return errorResponse(500, {
      error: "Failed to export orders",
      code: "internal_error",
    });
  }
}
