/**
 * GET /api/products/{id}
 *
 * Returns a single product (PDP payload) by either UUID or slug.
 *
 * Response shape (`product` field):
 *   - Full product attributes: id, slug, sku, name, description, category,
 *     priceCents, compareAtPriceCents, currency, size, material, color,
 *     stock, inStock, isFeatured, isNew, salesCount, createdAt, updatedAt
 *   - `images`            full image gallery, ordered by position asc
 *   - `primaryImageUrl`   shortcut to the lowest-position image url
 *   - `rating`            { average, count } pulled from the denormalised
 *                         aggregates updated by the (forthcoming) review
 *                         write paths
 *   - `related`           recommended products in the same category (same
 *                         "brand bucket"; the schema has no first-class
 *                         brand field) excluding the current product,
 *                         ordered by popularity. Limit configurable via
 *                         the `related` query param (default 8, max 24).
 *
 * Query parameters:
 *   - related   integer; number of related products to return (default 8,
 *               max 24). Pass `0` and the route still returns the default
 *               since `0` is treated as "unset".
 *
 * Responses:
 *   200 — `{ product: PublicProductDetail }`
 *   400 — invalid `related` query parameter
 *   404 — product does not exist
 */
import { NextResponse } from "next/server";

import {
  RELATED_PRODUCTS_MAX_LIMIT,
  getProductByIdOrSlug,
} from "@/lib/server/products";

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

function parseRelatedLimit(raw: string | null): {
  ok: true;
  value: number | undefined;
} | { ok: false; error: ErrorBody } {
  if (raw === null || raw === "") return { ok: true, value: undefined };
  if (!/^\d+$/.test(raw)) {
    return {
      ok: false,
      error: {
        error: "`related` must be a non-negative integer",
        code: "validation_failed",
        fieldErrors: { related: ["Expected a non-negative integer"] },
      },
    };
  }
  const parsed = parseInt(raw, 10);
  if (parsed > RELATED_PRODUCTS_MAX_LIMIT) {
    return {
      ok: false,
      error: {
        error: `\`related\` cannot exceed ${RELATED_PRODUCTS_MAX_LIMIT}`,
        code: "validation_failed",
        fieldErrors: {
          related: [`Maximum is ${RELATED_PRODUCTS_MAX_LIMIT}`],
        },
      },
    };
  }
  return { ok: true, value: parsed };
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!id || typeof id !== "string") {
    return errorResponse(400, {
      error: "Product id is required",
      code: "missing_id",
    });
  }

  const url = new URL(req.url);
  const relatedRaw = url.searchParams.get("related");
  const relatedParsed = parseRelatedLimit(relatedRaw);
  if (!relatedParsed.ok) {
    return errorResponse(400, relatedParsed.error);
  }

  try {
    const product = await getProductByIdOrSlug(id, {
      relatedLimit: relatedParsed.value,
    });
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
