/**
 * Admin product detail routes.
 *
 *   GET    /api/admin/products/{id}
 *     Fetch a single product (with full image gallery and category
 *     join). Resolves either a UUID or a slug.
 *
 *   PUT    /api/admin/products/{id}
 *     Body: any subset of `{ slug, sku, name, description, categoryId,
 *           priceCents, compareAtPriceCents, currency, size, material,
 *           color, stock, isFeatured, isNew, images }`. When `images`
 *     is supplied it REPLACES the gallery wholesale; omit it to leave
 *     existing rows untouched.
 *
 *   DELETE /api/admin/products/{id}
 *     Hard-deletes the product. `product_images`, `wishlist_items`,
 *     `cart_items`, and `reviews` cascade. Order line items keep their
 *     snapshot so historical orders stay intact.
 *
 * Every endpoint requires the `admin` role:
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
  deleteProduct,
  getAdminProduct,
  updateProduct,
  type ProductMutationError,
} from "@/lib/server/admin-products";

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
    error: "Product not found",
    code: "not_found",
  });
}

function productMutationErrorResponse(
  err: ProductMutationError,
): NextResponse<ErrorBody> {
  switch (err.code) {
    case "slug_taken":
      return errorResponse(409, {
        error: "A product with that slug already exists",
        code: "slug_taken",
        details: { slug: err.slug },
      });
    case "sku_taken":
      return errorResponse(409, {
        error: "A product with that SKU already exists",
        code: "sku_taken",
        details: { sku: err.sku },
      });
    case "category_not_found":
      return errorResponse(400, {
        error: "Referenced category does not exist",
        code: "category_not_found",
        details: { categoryId: err.categoryId },
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
    const product = await getAdminProduct(id);
    if (!product) return notFound();
    return NextResponse.json({ product }, { status: 200 });
  } catch (err) {
    console.error(`[GET /api/admin/products/${id}] failed`, err);
    return errorResponse(500, {
      error: "Failed to load product",
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
    const result = await updateProduct(id, {
      slug: body.slug as string | undefined,
      sku: body.sku as string | undefined,
      name: body.name as string | undefined,
      description: body.description as string | undefined,
      categoryId: body.categoryId as string | null | undefined,
      priceCents: body.priceCents as number | undefined,
      compareAtPriceCents: body.compareAtPriceCents as number | null | undefined,
      currency: body.currency as string | undefined,
      size: body.size as string | null | undefined,
      material: body.material as string | null | undefined,
      color: body.color as string | null | undefined,
      stock: body.stock as number | undefined,
      isFeatured: body.isFeatured as boolean | undefined,
      isNew: body.isNew as boolean | undefined,
      images: body.images as never,
    });
    if (!result.ok) return productMutationErrorResponse(result.error);
    return NextResponse.json({ product: result.data }, { status: 200 });
  } catch (err) {
    console.error(`[PUT /api/admin/products/${id}] failed`, err);
    return errorResponse(500, {
      error: "Failed to update product",
      code: "internal_error",
    });
  }
}

export async function DELETE(_req: Request, ctx: RouteParams) {
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
    const removed = await deleteProduct(id);
    if (!removed) return notFound();
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error(`[DELETE /api/admin/products/${id}] failed`, err);
    return errorResponse(500, {
      error: "Failed to delete product",
      code: "internal_error",
    });
  }
}
