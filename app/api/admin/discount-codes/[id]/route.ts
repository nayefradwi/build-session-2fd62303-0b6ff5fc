/**
 * Admin discount-code detail routes.
 *
 *   GET    /api/admin/discount-codes/{id}
 *     Fetch a single discount code (with derived `status` and
 *     `usageRemaining`).
 *
 *   PUT    /api/admin/discount-codes/{id}
 *     Body: any subset of `{ code, type, value, minOrderValue, expiresAt,
 *           isActive, usageLimit, description }`. Updates the supplied
 *     fields (partial-update semantics). Empty bodies are rejected.
 *
 *   DELETE /api/admin/discount-codes/{id}
 *     Hard-deletes the code. Returns 200 with `{ ok: true }` on success
 *     and 404 if the id is unknown.
 *
 * Every endpoint requires the `admin` role:
 *   - 401 when no user is logged in
 *   - 403 when a non-admin user is logged in
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  AuthRequiredError,
  ForbiddenError,
  requireAdmin,
} from "@/lib/server/auth";
import {
  DISCOUNT_TYPES,
  deleteDiscountCode,
  getDiscountCodeById,
  updateDiscountCode,
  type DiscountCodeMutationError,
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

function notFound(): NextResponse<ErrorBody> {
  return errorResponse(404, {
    error: "Discount code not found",
    code: "not_found",
  });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      return notFound();
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

/**
 * Update payload. Every field is optional, but the body must contain at
 * least one of them — empty PUTs are rejected with a 400 so callers
 * don't accidentally bump `updatedAt` to no effect.
 */
const updateSchema = z
  .object({
    code: z.string().min(1).max(64).optional(),
    type: z
      .enum(DISCOUNT_TYPES as readonly [string, ...string[]])
      .optional(),
    value: z.number().int().positive().optional(),
    minOrderValue: z
      .union([z.number().int().nonnegative(), z.null()])
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
      .union([z.number().int().positive(), z.null()])
      .optional(),
    description: z.union([z.string().max(2000), z.null()]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Update payload must include at least one field",
  });

/** GET /api/admin/discount-codes/{id} */
export async function GET(_req: Request, ctx: RouteParams) {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    if (err instanceof ForbiddenError) return forbidden();
    throw err;
  }

  const { id } = await ctx.params;
  if (!id || !UUID_RE.test(id)) return notFound();

  try {
    const row = await getDiscountCodeById(id);
    if (!row) return notFound();
    return NextResponse.json({ discountCode: row }, { status: 200 });
  } catch (err) {
    console.error(`[GET /api/admin/discount-codes/${id}] failed`, err);
    return errorResponse(500, {
      error: "Failed to load discount code",
      code: "internal_error",
    });
  }
}

/** PUT /api/admin/discount-codes/{id} */
export async function PUT(req: Request, ctx: RouteParams) {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    if (err instanceof ForbiddenError) return forbidden();
    throw err;
  }

  const { id } = await ctx.params;
  if (!id || !UUID_RE.test(id)) return notFound();

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return errorResponse(400, {
      error: "Request body must be valid JSON",
      code: "invalid_json",
    });
  }

  const parsed = updateSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(400, {
      error: "Invalid discount code payload",
      code: "validation_failed",
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    const result = await updateDiscountCode(id, {
      code: parsed.data.code,
      type: parsed.data.type,
      value: parsed.data.value,
      minOrderValue: parsed.data.minOrderValue,
      expiresAt: parsed.data.expiresAt,
      isActive: parsed.data.isActive,
      usageLimit: parsed.data.usageLimit,
      description: parsed.data.description,
    });
    if (!result.ok) return mutationErrorResponse(result.error);
    return NextResponse.json({ discountCode: result.data }, { status: 200 });
  } catch (err) {
    console.error(`[PUT /api/admin/discount-codes/${id}] failed`, err);
    return errorResponse(500, {
      error: "Failed to update discount code",
      code: "internal_error",
    });
  }
}

/** DELETE /api/admin/discount-codes/{id} */
export async function DELETE(_req: Request, ctx: RouteParams) {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    if (err instanceof ForbiddenError) return forbidden();
    throw err;
  }

  const { id } = await ctx.params;
  if (!id || !UUID_RE.test(id)) return notFound();

  try {
    const removed = await deleteDiscountCode(id);
    if (!removed) return notFound();
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error(`[DELETE /api/admin/discount-codes/${id}] failed`, err);
    return errorResponse(500, {
      error: "Failed to delete discount code",
      code: "internal_error",
    });
  }
}
