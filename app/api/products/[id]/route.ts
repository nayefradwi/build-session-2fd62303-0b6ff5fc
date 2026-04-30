/**
 * GET /api/products/{id}
 *
 * Returns a single product (with its full image gallery, category info,
 * and pricing/inventory state) by either UUID or slug. Slug-based lookup
 * lets the storefront wire `/products/{slug}` directly to this endpoint.
 *
 * Responses:
 *   200 — `{ product: PublicProductDetail }`
 *   404 — product does not exist
 */
import { NextResponse } from "next/server";

import { getProductByIdOrSlug } from "@/lib/server/products";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ErrorBody {
  error: string;
  code: string;
}

function errorResponse(status: number, body: ErrorBody) {
  return NextResponse.json(body, { status });
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!id || typeof id !== "string") {
    return errorResponse(400, {
      error: "Product id is required",
      code: "missing_id",
    });
  }

  try {
    const product = await getProductByIdOrSlug(id);
    if (!product) {
      return errorResponse(404, {
        error: "Product not found",
        code: "not_found",
      });
    }
    return NextResponse.json({ product }, { status: 200 });
  } catch (err) {
    console.error(`[GET /api/products/${id}] failed`, err);
    return errorResponse(500, {
      error: "Failed to load product",
      code: "internal_error",
    });
  }
}
