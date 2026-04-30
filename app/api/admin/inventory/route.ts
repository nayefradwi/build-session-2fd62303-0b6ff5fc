/**
 * Admin inventory list.
 *
 *   GET /api/admin/inventory
 *     Paginated catalog stock view. Supports `q` (matches name/sku/slug,
 *     case-insensitive), `categoryId`, `status` (`any`|`in`|`out`|`low`),
 *     `page`, `pageSize`. Each row carries `inStock` / `outOfStock` /
 *     `lowStock` flags so admin UIs can highlight stock state without
 *     re-deriving it client-side. The active `lowStockThreshold` is
 *     echoed alongside the items for convenience.
 *
 * Requires the `admin` role:
 *   - 401 when no user is logged in
 *   - 403 when the user is logged in but not an admin
 */
import { NextResponse } from "next/server";

import {
  AuthRequiredError,
  ForbiddenError,
  requireAdmin,
} from "@/lib/server/auth";
import {
  INVENTORY_DEFAULT_PAGE_SIZE,
  INVENTORY_MAX_PAGE_SIZE,
  listInventory,
  type ListInventoryInput,
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

const VALID_STATUSES: ListInventoryInput["status"][] = [
  "any",
  "in",
  "out",
  "low",
];

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

  const pageParsed = parseInteger(params.get("page"), "page", 1, 1_000_000);
  if (!pageParsed.ok) return errorResponse(400, pageParsed.error);

  const pageSizeParsed = parseInteger(
    params.get("pageSize"),
    "pageSize",
    1,
    INVENTORY_MAX_PAGE_SIZE,
  );
  if (!pageSizeParsed.ok) return errorResponse(400, pageSizeParsed.error);

  const q = params.get("q") ?? undefined;
  const categoryId = params.get("categoryId") ?? undefined;
  const statusRaw = params.get("status");
  let status: ListInventoryInput["status"] | undefined;
  if (statusRaw !== null && statusRaw !== "") {
    if (
      !VALID_STATUSES.includes(statusRaw as ListInventoryInput["status"])
    ) {
      return errorResponse(400, {
        error: "`status` must be one of any|in|out|low",
        code: "validation_failed",
        fieldErrors: { status: ["Invalid value"] },
      });
    }
    status = statusRaw as ListInventoryInput["status"];
  }

  try {
    const result = await listInventory({
      q: q && q.trim().length > 0 ? q.trim() : undefined,
      page: pageParsed.value ?? 1,
      pageSize: pageSizeParsed.value ?? INVENTORY_DEFAULT_PAGE_SIZE,
      status,
      categoryId,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[GET /api/admin/inventory] failed", err);
    return errorResponse(500, {
      error: "Failed to list inventory",
      code: "internal_error",
    });
  }
}
