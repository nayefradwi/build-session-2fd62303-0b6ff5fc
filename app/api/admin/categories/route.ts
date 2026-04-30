/**
 * Admin categories collection routes.
 *
 *   GET  /api/admin/categories
 *     Lists every category with a derived `productCount`. Supports a
 *     `q` search (matches name OR slug, case-insensitive) and a
 *     `topLevelOnly=true` filter that restricts to roots of the tree.
 *
 *   POST /api/admin/categories
 *     Body: `{ slug, name, description?, parentId? }`. Creates a new
 *     category. Returns 201 on success, 400 on validation, 409 on slug
 *     conflict.
 *
 * Both endpoints require the `admin` role.
 */
import { NextResponse } from "next/server";

import {
  AuthRequiredError,
  ForbiddenError,
  requireAdmin,
} from "@/lib/server/auth";
import {
  createCategory,
  listCategories,
  type CategoryMutationError,
} from "@/lib/server/admin-categories";

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

function categoryMutationErrorResponse(
  err: CategoryMutationError,
): NextResponse<ErrorBody> {
  switch (err.code) {
    case "slug_taken":
      return errorResponse(409, {
        error: "A category with that slug already exists",
        code: "slug_taken",
        details: { slug: err.slug },
      });
    case "parent_not_found":
      return errorResponse(400, {
        error: "Parent category does not exist",
        code: "parent_not_found",
        details: { parentId: err.parentId },
      });
    case "parent_cycle":
      return errorResponse(400, {
        error: "Setting that parent would create a cycle",
        code: "parent_cycle",
        details: { parentId: err.parentId },
      });
    case "in_use":
      return errorResponse(409, {
        error: "Cannot delete a category that still has products",
        code: "in_use",
        details: { productCount: err.productCount },
      });
    case "not_found":
      return errorResponse(404, {
        error: "Category not found",
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
  const topLevelOnly = url.searchParams.get("topLevelOnly") === "true";

  try {
    const result = await listCategories({
      q: q && q.trim().length > 0 ? q.trim() : undefined,
      topLevelOnly,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[GET /api/admin/categories] failed", err);
    return errorResponse(500, {
      error: "Failed to list categories",
      code: "internal_error",
    });
  }
}

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

  if (!json || typeof json !== "object") {
    return errorResponse(400, {
      error: "Request body must be a JSON object",
      code: "validation_failed",
    });
  }

  const body = json as Record<string, unknown>;

  try {
    const result = await createCategory({
      slug: body.slug as string,
      name: body.name as string,
      description: body.description as string | null | undefined,
      parentId: body.parentId as string | null | undefined,
    });
    if (!result.ok) return categoryMutationErrorResponse(result.error);
    return NextResponse.json({ category: result.data }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/admin/categories] failed", err);
    return errorResponse(500, {
      error: "Failed to create category",
      code: "internal_error",
    });
  }
}
