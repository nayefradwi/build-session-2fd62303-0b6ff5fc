/**
 * Admin inventory bulk update.
 *
 *   POST /api/admin/inventory/bulk
 *     Body:
 *       {
 *         updates: [
 *           { productId, stock?, delta?, reason? },
 *           ...
 *         ],
 *         defaultReason?: string,
 *       }
 *
 *     Applies many stock changes in one call. Each line is independent —
 *     a single failure does not roll back the others. The response is a
 *     `{ applied, failed, results: [...] }` envelope so admin UIs can
 *     surface per-row errors. Up to 500 lines per call.
 *
 * Requires the `admin` role:
 *   - 401 when no user is logged in
 *   - 403 when the user is logged in but not an admin
 *   - 400 on malformed payload
 */
import { NextResponse } from "next/server";

import {
  AuthRequiredError,
  ForbiddenError,
  requireAdmin,
} from "@/lib/server/auth";
import {
  bulkUpdateProductStock,
  type BulkStockLineInput,
} from "@/lib/server/inventory";

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

export async function POST(req: Request) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    if (err instanceof ForbiddenError) return forbidden();
    throw err;
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

  if (!json || typeof json !== "object") {
    return errorResponse(400, {
      error: "Request body must be a JSON object",
      code: "validation_failed",
    });
  }

  const body = json as { updates?: unknown; defaultReason?: unknown };

  if (!Array.isArray(body.updates)) {
    return errorResponse(400, {
      error: "`updates` must be an array",
      code: "validation_failed",
      fieldErrors: { updates: ["Expected an array of stock change lines"] },
    });
  }

  // Coerce each line to the typed shape; the service layer validates the
  // payload contents and returns per-line errors for malformed rows.
  const updates: BulkStockLineInput[] = body.updates.map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
      productId: typeof r.productId === "string" ? r.productId : "",
      stock: typeof r.stock === "number" ? r.stock : undefined,
      delta: typeof r.delta === "number" ? r.delta : undefined,
      reason:
        typeof r.reason === "string"
          ? r.reason
          : r.reason === null
            ? null
            : undefined,
    };
  });

  const defaultReason =
    typeof body.defaultReason === "string"
      ? body.defaultReason
      : body.defaultReason === null
        ? null
        : undefined;

  try {
    const result = await bulkUpdateProductStock({
      updates,
      defaultReason,
      userId: admin.id,
    });
    if (!result.ok) {
      return errorResponse(400, {
        error: result.error.message,
        code: result.error.code,
        fieldErrors: result.error.fields,
      });
    }
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[POST /api/admin/inventory/bulk] failed", err);
    return errorResponse(500, {
      error: "Failed to apply bulk stock updates",
      code: "internal_error",
    });
  }
}
