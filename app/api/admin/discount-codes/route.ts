/**
 * Admin discount-codes collection routes.
 *
 *   GET  /api/admin/discount-codes
 *     Paginated list of every discount code in the system. Supports a
 *     `q` search (matches the code or description), a `status` filter
 *     (`all` | `active` | `inactive` | `expired` | `exhausted`), and the
 *     usual `page` / `pageSize` knobs. Each row is returned with a
 *     derived `status` and `usageRemaining` so the admin UI never has to
 *     reproduce the "is this code currently usable?" predicate.
 *
 *   POST /api/admin/discount-codes
 *     Body: `{ code, type, value, minOrderValue?, expiresAt?, isActive?,
 *              usageLimit?, description? }`. Creates a new code.
 *     Returns 201 on success, 400 on validation, 409 on a code-uniqueness
 *     conflict.
 *
 * Both endpoints require an authenticated admin (role = "admin").
 * Unauthenticated callers receive 401; non-admin authenticated callers
 * receive 403.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  AuthRequiredError,
  ForbiddenError,
  requireAdmin,
} from "@/lib/server/auth";
import {
  DEFAULT_PAGE_SIZE,
  DISCOUNT_TYPES,
  MAX_PAGE_SIZE,
  createDiscountCode,
  listDiscountCodes,
  type DiscountCodeMutationError,
  type DiscountCodeStatus,
} from "@/lib/server/discount-codes";

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

function unauthorized(): NextResponse<ErrorBody> {
  return errorResponse(401, {
    error: "Authentication required",
    code: "unauthenticated",
  });
}

function forbidden(): NextResponse<ErrorBody> {
  return errorResponse(403, {
    error: "Admin role required",
    code: "forbidden",
  });
}

const ALLOWED_STATUSES: ReadonlyArray<DiscountCodeStatus | "all"> = [
  "all",
  "active",
  "inactive",
  "expired",
  "exhausted",
];

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

/**
 * Map the typed mutation error to an HTTP response.
 *
 *   - `code_taken`        → 409 (the resource exists but the requested
 *                           state conflicts with another row)
 *   - `validation_failed` → 400
 *   - `not_found`         → 404 (only reachable from update/delete; the
 *                           create path never produces it, but switching
 *                           on the discriminant keeps the helper total)
 */
function mutationErrorResponse(
  err: DiscountCodeMutationError,
): NextResponse<ErrorBody> {
  switch (err.code) {
    case "code_taken":
      return errorResponse(409, {
        error: "A discount code with that code already exists",
        code: "code_taken",
        details: { code: err.conflictingCode },
      });
    case "not_found":
      return errorResponse(404, {
        error: "Discount code not found",
        code: "not_found",
      });
    case "validation_failed":
      return errorResponse(400, {
        error: err.message,
        code: "validation_failed",
        fieldErrors: err.fields,
      });
  }
}

/**
 * GET /api/admin/discount-codes
 *
 * Query parameters (all optional):
 *   - q          search term (matches code OR description, case-insensitive)
 *   - status     all | active | inactive | expired | exhausted (default: all)
 *   - page       1-indexed page number (default 1)
 *   - pageSize   items per page (default 25, max 100)
 */
export async function GET(req: Request) {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    if (err instanceof ForbiddenError) return forbidden();
    throw err;
  }

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? undefined;

  const statusRaw = url.searchParams.get("status");
  let status: DiscountCodeStatus | "all" = "all";
  if (statusRaw !== null && statusRaw !== "") {
    if (!ALLOWED_STATUSES.includes(statusRaw as DiscountCodeStatus | "all")) {
      return errorResponse(400, {
        error: `\`status\` must be one of: ${ALLOWED_STATUSES.join(", ")}`,
        code: "validation_failed",
        fieldErrors: { status: ["Invalid status"] },
      });
    }
    status = statusRaw as DiscountCodeStatus | "all";
  }

  const pageParsed = parseInteger(
    url.searchParams.get("page"),
    "page",
    1,
    1_000_000,
  );
  if (!pageParsed.ok) return errorResponse(400, pageParsed.error);

  const pageSizeParsed = parseInteger(
    url.searchParams.get("pageSize"),
    "pageSize",
    1,
    MAX_PAGE_SIZE,
  );
  if (!pageSizeParsed.ok) return errorResponse(400, pageSizeParsed.error);

  try {
    const result = await listDiscountCodes({
      q,
      status,
      page: pageParsed.value ?? 1,
      pageSize: pageSizeParsed.value ?? DEFAULT_PAGE_SIZE,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[GET /api/admin/discount-codes] failed", err);
    return errorResponse(500, {
      error: "Failed to list discount codes",
      code: "internal_error",
    });
  }
}

/**
 * Zod schema for the POST body. Mirrors the helper's contract: code +
 * type + value are required; everything else is optional and may be
 * `null` to denote "no value" (e.g. no expiry).
 */
const createSchema = z.object({
  code: z.string().min(1, "code is required").max(64, "code is too long"),
  type: z.enum(DISCOUNT_TYPES as readonly [string, ...string[]]),
  value: z
    .number()
    .int("value must be an integer")
    .positive("value must be > 0"),
  minOrderValue: z
    .union([
      z.number().int("minOrderValue must be an integer").nonnegative(),
      z.null(),
    ])
    .optional(),
  expiresAt: z
    .union([
      z
        .string()
        .datetime({ offset: true, message: "expiresAt must be ISO 8601" }),
      z.null(),
    ])
    .optional(),
  isActive: z.boolean().optional(),
  usageLimit: z
    .union([
      z.number().int("usageLimit must be an integer").positive(),
      z.null(),
    ])
    .optional(),
  description: z.union([z.string().max(2000), z.null()]).optional(),
});

/**
 * POST /api/admin/discount-codes
 */
export async function POST(req: Request) {
  try {
    await requireAdmin();
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

  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(400, {
      error: "Invalid discount code payload",
      code: "validation_failed",
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    const result = await createDiscountCode({
      code: parsed.data.code,
      type: parsed.data.type,
      value: parsed.data.value,
      minOrderValue: parsed.data.minOrderValue ?? null,
      expiresAt: parsed.data.expiresAt ?? null,
      isActive: parsed.data.isActive,
      usageLimit: parsed.data.usageLimit ?? null,
      description: parsed.data.description ?? null,
    });
    if (!result.ok) return mutationErrorResponse(result.error);
    return NextResponse.json({ discountCode: result.data }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/admin/discount-codes] failed", err);
    return errorResponse(500, {
      error: "Failed to create discount code",
      code: "internal_error",
    });
  }
}
