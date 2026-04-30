/**
 * Admin category detail routes.
 *
 *   GET    /api/admin/categories/{id}
 *     Fetch a single category by id or slug, including its
 *     `productCount`.
 *
 *   PUT    /api/admin/categories/{id}
 *     Body: any subset of `{ slug, name, description, parentId }`.
 *     Empty bodies are rejected. Setting `parentId` to an ancestor of
 *     this category returns a `parent_cycle` 400.
 *
 *   DELETE /api/admin/categories/{id}
 *     Hard-deletes the category. If any products still reference it,
 *     responds 409 (`in_use`) unless `?force=true` is passed; force
 *     mode lets the FK rule (`ON DELETE SET NULL`) promote the
 *     orphans to "uncategorised".
 *
 * Every endpoint requires the `admin` role.
 */
import { NextResponse } from "next/server";

import {
  AuthRequiredError,
  ForbiddenError,
  requireAdmin,
} from "@/lib/server/auth";
import {
  deleteCategory,
  getCategory,
  updateCategory,
  type CategoryMutationError,
  type DeleteCategoryError,
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

function notFound() {
  return errorResponse(404, {
    error: "Category not found",
    code: "not_found",
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
      return notFound();
    case "validation_failed":
      return errorResponse(400, {
        error: err.message,
        code: "validation_failed",
        fieldErrors: err.fields,
      });
  }
}

function deleteErrorResponse(err: DeleteCategoryError): NextResponse<ErrorBody> {
  switch (err.code) {
    case "in_use":
      return errorResponse(409, {
        error: "Cannot delete a category that still has products",
        code: "in_use",
        details: { productCount: err.productCount },
      });
    case "not_found":
      return notFound();
  }
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: RouteParams) {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    if (err instanceof ForbiddenError) return forbidden();
    throw err;
  }

  const { id } = await ctx.params;
  if (!id) return notFound();

  try {
    const category = await getCategory(id);
    if (!category) return notFound();
    return NextResponse.json({ category }, { status: 200 });
  } catch (err) {
    console.error(`[GET /api/admin/categories/${id}] failed`, err);
    return errorResponse(500, {
      error: "Failed to load category",
      code: "internal_error",
    });
  }
}

export async function PUT(req: Request, ctx: RouteParams) {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    if (err instanceof ForbiddenError) return forbidden();
    throw err;
  }

  const { id } = await ctx.params;
  if (!id) return notFound();

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
  if (Object.keys(json as Record<string, unknown>).length === 0) {
    return errorResponse(400, {
      error: "Update payload must include at least one field",
      code: "validation_failed",
    });
  }

  const body = json as Record<string, unknown>;

  try {
    const result = await updateCategory(id, {
      slug: body.slug as string | undefined,
      name: body.name as string | undefined,
      description: body.description as string | null | undefined,
      parentId: body.parentId as string | null | undefined,
    });
    if (!result.ok) return categoryMutationErrorResponse(result.error);
    return NextResponse.json({ category: result.data }, { status: 200 });
  } catch (err) {
    console.error(`[PUT /api/admin/categories/${id}] failed`, err);
    return errorResponse(500, {
      error: "Failed to update category",
      code: "internal_error",
    });
  }
}

export async function DELETE(req: Request, ctx: RouteParams) {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    if (err instanceof ForbiddenError) return forbidden();
    throw err;
  }

  const { id } = await ctx.params;
  if (!id) return notFound();

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "true";

  try {
    const result = await deleteCategory(id, { force });
    if (!result.ok) return deleteErrorResponse(result.error);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error(`[DELETE /api/admin/categories/${id}] failed`, err);
    return errorResponse(500, {
      error: "Failed to delete category",
      code: "internal_error",
    });
  }
}
