/**
 * Product reviews routes.
 *
 *   GET /api/products/{id}/reviews
 *     Paginated, newest-first list of reviews for the given product.
 *     `{id}` accepts either a UUID or a slug (mirroring the PDP route).
 *
 *     Query parameters (all optional):
 *       - page      1-indexed page number (default 1)
 *       - pageSize  items per page (default 10, max 50)
 *
 *     Responses:
 *       200 — `{ items, page, pageSize, total, totalPages, hasMore,
 *                summary: { average, count } }`
 *       400 — invalid query parameters
 *       404 — product does not exist
 *
 *   POST /api/products/{id}/reviews
 *     Body: `{ rating: number, comment?: string | null }`
 *
 *     Creates a review for the authenticated user against the given
 *     product, enforcing:
 *       1. Authentication.
 *       2. Verified-purchase rule — the user must have an `order_items`
 *          row referencing this product on an order they own.
 *       3. Rating in [1, 5] (integer).
 *       4. Optional comment, capped at REVIEW_COMMENT_MAX_LENGTH chars.
 *       5. One review per user per product (unique index + pre-check).
 *
 *     On success the parent product's `rating_average` / `rating_count`
 *     aggregates are recomputed from the live `reviews` rows so the PDP
 *     rating banner stays in step.
 *
 *     Responses:
 *       201 — `{ review: PublicReview, summary: { average, count } }`
 *       400 — validation_failed / invalid_json / rating_invalid /
 *             comment_too_long
 *       401 — `{ code: "unauthenticated" }`
 *       403 — `{ code: "not_verified_purchaser" }`
 *       404 — product does not exist
 *       409 — `{ code: "already_reviewed" }`
 *       500 — internal error
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { AuthRequiredError, requireUser } from "@/lib/server/auth";
import {
  REVIEWS_DEFAULT_PAGE_SIZE,
  REVIEWS_MAX_PAGE_SIZE,
  REVIEW_COMMENT_MAX_LENGTH,
  REVIEW_RATING_MAX,
  REVIEW_RATING_MIN,
  createReview,
  listReviewsForProduct,
  resolveProductId,
  type CreateReviewError,
} from "@/lib/server/reviews";

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

function notFound(): NextResponse<ErrorBody> {
  return errorResponse(404, {
    error: "Product not found",
    code: "product_not_found",
  });
}

const createReviewSchema = z.object({
  rating: z
    .number({ invalid_type_error: "Rating must be a number" })
    .int("Rating must be an integer")
    .min(REVIEW_RATING_MIN, `Rating must be at least ${REVIEW_RATING_MIN}`)
    .max(REVIEW_RATING_MAX, `Rating cannot exceed ${REVIEW_RATING_MAX}`),
  comment: z
    .string()
    .trim()
    .max(
      REVIEW_COMMENT_MAX_LENGTH,
      `Comment cannot exceed ${REVIEW_COMMENT_MAX_LENGTH} characters`,
    )
    .nullable()
    .optional(),
});

function parseInteger(
  raw: string | null,
  field: string,
  min: number,
  max: number,
):
  | { ok: true; value: number | undefined }
  | { ok: false; error: ErrorBody } {
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

/** Map the typed mutation error to an HTTP response. */
function mutationErrorResponse(
  err: CreateReviewError,
): NextResponse<ErrorBody> {
  switch (err.code) {
    case "product_not_found":
      return notFound();
    case "rating_invalid":
      return errorResponse(400, {
        error: `Rating must be an integer between ${REVIEW_RATING_MIN} and ${REVIEW_RATING_MAX}`,
        code: "rating_invalid",
        fieldErrors: { rating: ["Out of range"] },
      });
    case "comment_too_long":
      return errorResponse(400, {
        error: `Comment cannot exceed ${REVIEW_COMMENT_MAX_LENGTH} characters`,
        code: "comment_too_long",
        fieldErrors: { comment: ["Too long"] },
      });
    case "not_verified_purchaser":
      return errorResponse(403, {
        error:
          "You can only review products you have purchased. Order this item first to leave a review.",
        code: "not_verified_purchaser",
      });
    case "already_reviewed":
      return errorResponse(409, {
        error: "You have already reviewed this product",
        code: "already_reviewed",
      });
    case "internal_error":
      return errorResponse(500, {
        error: err.message || "Failed to create review",
        code: "internal_error",
      });
  }
}

/**
 * GET /api/products/{id}/reviews
 */
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
    REVIEWS_MAX_PAGE_SIZE,
  );
  if (!pageSizeParsed.ok) return errorResponse(400, pageSizeParsed.error);

  try {
    const productId = await resolveProductId(id);
    if (!productId) return notFound();

    const result = await listReviewsForProduct({
      productId,
      page: pageParsed.value ?? 1,
      pageSize: pageSizeParsed.value ?? REVIEWS_DEFAULT_PAGE_SIZE,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error(`[GET /api/products/${id}/reviews] failed`, err);
    return errorResponse(500, {
      error: "Failed to load reviews",
      code: "internal_error",
    });
  }
}

/**
 * POST /api/products/{id}/reviews
 */
export async function POST(
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

  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
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

  const parsed = createReviewSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(400, {
      error: "Invalid review payload",
      code: "validation_failed",
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  const productId = await resolveProductId(id);
  if (!productId) return notFound();

  try {
    const result = await createReview({
      userId: user.id,
      productId,
      rating: parsed.data.rating,
      comment: parsed.data.comment ?? null,
    });

    if (!result.ok) {
      return mutationErrorResponse(result.error);
    }

    return NextResponse.json(
      { review: result.data, summary: result.summary },
      { status: 201 },
    );
  } catch (err) {
    console.error(`[POST /api/products/${id}/reviews] failed`, err);
    return errorResponse(500, {
      error: "Failed to create review",
      code: "internal_error",
    });
  }
}
