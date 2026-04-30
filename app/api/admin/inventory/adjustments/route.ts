/**
 * Stock-adjustment audit log.
 *
 *   GET /api/admin/inventory/adjustments
 *     Paginated history of every stock change. Supports `productId`,
 *     `userId`, `page`, `pageSize` query params. Each row carries the
 *     signed delta, before/after values, the actor (user id + email)
 *     and the optional reason.
 *
 * Requires the `admin` role.
 */
import { NextResponse } from "next/server";

import {
  AuthRequiredError,
  ForbiddenError,
  requireAdmin,
} from "@/lib/server/auth";
import {
  ADJUSTMENTS_DEFAULT_PAGE_SIZE,
  ADJUSTMENTS_MAX_PAGE_SIZE,
  listStockAdjustments,
} from "@/lib/server/inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ErrorBody {
  error: string;
  code: string;
  fieldErrors?: Record<string, string[]>;
}

function errorResponse(status: number, body: ErrorBody) {
  return NextResponse.json(body, { status });
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

  const pageParsed = parseInteger(params.get("page"), "page", 1, 1_000_000);
  if (!pageParsed.ok) return errorResponse(400, pageParsed.error);

  const pageSizeParsed = parseInteger(
    params.get("pageSize"),
    "pageSize",
    1,
    ADJUSTMENTS_MAX_PAGE_SIZE,
  );
  if (!pageSizeParsed.ok) return errorResponse(400, pageSizeParsed.error);

  const productId = params.get("productId") ?? undefined;
  const userId = params.get("userId") ?? undefined;

  try {
    const result = await listStockAdjustments({
      productId,
      userId,
      page: pageParsed.value ?? 1,
      pageSize: pageSizeParsed.value ?? ADJUSTMENTS_DEFAULT_PAGE_SIZE,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[GET /api/admin/inventory/adjustments] failed", err);
    return errorResponse(500, {
      error: "Failed to load stock adjustments",
      code: "internal_error",
    });
  }
}
