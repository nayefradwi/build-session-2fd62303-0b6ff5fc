/**
 * Admin products collection routes.
 *
 *   GET  /api/admin/products
 *     Paginated catalog list including unpublished SKUs and full image
 *     galleries. Supports `q` (matches name/sku/slug, case-insensitive),
 *     `featured=true`, `new=true`, `categoryId`, `page`, `pageSize`.
 *
 *   POST /api/admin/products
 *     Body: `{ slug, sku, name, priceCents, ... }`. Creates a product
 *     row plus optional `images: [...]`. Returns 201 on success, 400
 *     on validation, 409 on slug/sku conflict.
 *
 * Both endpoints require the `admin` role.
 *   - 401 when no user is logged in
 *   - 403 when the logged-in user is not an admin
 */
import { NextResponse } from "next/server";

import {
  AuthRequiredError,
  ForbiddenError,
  requireAdmin,
} from "@/lib/server/auth";
import {
  ADMIN_PRODUCTS_DEFAULT_PAGE_SIZE,
  ADMIN_PRODUCTS_MAX_PAGE_SIZE,
  createProduct,
  listAdminProducts,
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
      return errorResponse(404, {
        error: "Product not found",
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
  const params = url.searchParams;

  const pageParsed = parseInteger(params.get("page"), "page", 1, 1_000_000);
  if (!pageParsed.ok) return errorResponse(400, pageParsed.error);

  const pageSizeParsed = parseInteger(
    params.get("pageSize"),
    "pageSize",
    1,
    ADMIN_PRODUCTS_MAX_PAGE_SIZE,
  );
  if (!pageSizeParsed.ok) return errorResponse(400, pageSizeParsed.error);

  const q = params.get("q") ?? undefined;
  const featured = params.get("featured");
  const isNew = params.get("new");
  const categoryId = params.get("categoryId") ?? undefined;

  try {
    const result = await listAdminProducts({
      q: q && q.trim().length > 0 ? q.trim() : undefined,
      page: pageParsed.value ?? 1,
      pageSize: pageSizeParsed.value ?? ADMIN_PRODUCTS_DEFAULT_PAGE_SIZE,
      isFeatured: featured === "true" ? true : undefined,
      isNew: isNew === "true" ? true : undefined,
      categoryId,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[GET /api/admin/products] failed", err);
    return errorResponse(500, {
      error: "Failed to list products",
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
    const result = await createProduct({
      slug: body.slug as string,
      sku: body.sku as string,
      name: body.name as string,
      description: body.description as string | undefined,
      categoryId: body.categoryId as string | null | undefined,
      priceCents: body.priceCents as number,
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
    return NextResponse.json({ product: result.data }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/admin/products] failed", err);
    return errorResponse(500, {
      error: "Failed to create product",
      code: "internal_error",
    });
  }
}
