/**
 * Server-side helpers for product reviews.
 *
 * The product reviews surface lives behind two endpoints:
 *
 *   - GET  /api/products/{id}/reviews   paginated list (newest first),
 *                                       used by the PDP.
 *   - POST /api/products/{id}/reviews   creates a review, gated by:
 *       1. Authenticated user.
 *       2. Verified-purchase rule — the user must have at least one
 *          `order_items` row referencing this product on an order they
 *          own. The check is done at the SQL layer with a single EXISTS
 *          subquery so we don't pull order rows back to the app server.
 *       3. Rating in the inclusive [1, 5] range.
 *       4. One review per (user, product) — enforced by the unique
 *          index `reviews_user_product_idx`. The route layer pre-checks
 *          for an existing row so callers see a clean 409 instead of a
 *          generic constraint-violation 500.
 *
 * The helper also recomputes the parent product's `rating_average` and
 * `rating_count` aggregates after every successful insert so the PDP /
 * browse cards stay in sync without a periodic batch job. The aggregate
 * is derived directly from `reviews` (AVG, COUNT) inside the same write
 * path, then UPSERTed onto `products` — there is no opportunity for the
 * rolled-up value to drift from the live review set.
 */
import { and, count, desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  orderItems,
  orders,
  products,
  reviews,
  users,
  type Review,
} from "@/lib/db/schema";

/** Default + max page sizes for the public review list. */
export const REVIEWS_DEFAULT_PAGE_SIZE = 10;
export const REVIEWS_MAX_PAGE_SIZE = 50;

export const REVIEW_RATING_MIN = 1;
export const REVIEW_RATING_MAX = 5;

/**
 * Public projection of a review surfaced on the PDP. We expose the
 * reviewer's display name (first name only when available, falling back
 * to "Anonymous") so the UI can render a friendly attribution without
 * leaking the email address.
 */
export interface PublicReview {
  id: string;
  productId: string;
  rating: number;
  comment: string | null;
  verifiedPurchase: boolean;
  authorName: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListReviewsForProductInput {
  productId: string;
  page?: number;
  pageSize?: number;
}

export interface ListReviewsForProductResult {
  items: PublicReview[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
  /**
   * Aggregate snapshot mirrored from the parent `products` row. Kept in
   * the response so the UI can render the summary banner without a
   * second round-trip.
   */
  summary: {
    average: number;
    count: number;
  };
}

export type CreateReviewError =
  | { code: "product_not_found" }
  | { code: "rating_invalid" }
  | { code: "comment_too_long" }
  | { code: "not_verified_purchaser" }
  | { code: "already_reviewed" }
  | { code: "internal_error"; message: string };

export interface CreateReviewInput {
  userId: string;
  productId: string;
  rating: number;
  comment?: string | null;
}

export type CreateReviewResult =
  | { ok: true; data: PublicReview; summary: { average: number; count: number } }
  | { ok: false; error: CreateReviewError };

/** Cap on the optional comment, mirrored at the route layer. */
export const REVIEW_COMMENT_MAX_LENGTH = 4000;

function clampPage(input: number | undefined): number {
  if (!input || !Number.isFinite(input) || input <= 0) return 1;
  return Math.floor(input);
}

function clampPageSize(input: number | undefined): number {
  if (!input || !Number.isFinite(input) || input <= 0) {
    return REVIEWS_DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.floor(input), REVIEWS_MAX_PAGE_SIZE);
}

/** UUID v4-ish detector — used to disambiguate id vs slug in the route. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Look up a product id from either a UUID or slug. Returns null when no
 * matching product exists. The route accepts both forms in `{id}` so
 * the UI can deep-link by slug without knowing the canonical UUID.
 */
export async function resolveProductId(
  idOrSlug: string,
): Promise<string | null> {
  const predicate = isUuid(idOrSlug)
    ? eq(products.id, idOrSlug)
    : eq(products.slug, idOrSlug);
  const rows = await db
    .select({ id: products.id })
    .from(products)
    .where(predicate)
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Best-effort display name for a review author.
 *
 *   - Prefer the user's `name` (first token only, trimmed).
 *   - Fall back to the local-part of the email with the first letter
 *     uppercased (so `jane.doe@example.com` becomes `Jane`).
 *   - Final fallback: "Anonymous".
 */
function deriveAuthorName(
  name: string | null | undefined,
  email: string | null | undefined,
): string {
  if (name && name.trim().length > 0) {
    const first = name.trim().split(/\s+/)[0];
    if (first) return first;
  }
  if (email && email.includes("@")) {
    const local = email.split("@")[0] ?? "";
    if (local.length > 0) {
      return local.charAt(0).toUpperCase() + local.slice(1);
    }
  }
  return "Anonymous";
}

interface ReviewWithAuthor {
  review: Review;
  authorName: string | null;
  authorEmail: string;
}

function toPublicReview(row: ReviewWithAuthor): PublicReview {
  return {
    id: row.review.id,
    productId: row.review.productId,
    rating: row.review.rating,
    comment: row.review.comment ?? null,
    verifiedPurchase: row.review.verifiedPurchase,
    authorName: deriveAuthorName(row.authorName, row.authorEmail),
    createdAt: row.review.createdAt.toISOString(),
    updatedAt: row.review.updatedAt.toISOString(),
  };
}

/**
 * Paginated newest-first listing of reviews for a product. The query
 * joins users so the response can carry a friendly author attribution
 * without a second round-trip.
 *
 * Returns `total = 0` and an empty `items` array when the product has
 * no reviews; the route layer must already have verified the product
 * exists.
 */
export async function listReviewsForProduct(
  input: ListReviewsForProductInput,
): Promise<ListReviewsForProductResult> {
  const page = clampPage(input.page);
  const pageSize = clampPageSize(input.pageSize);

  const where = eq(reviews.productId, input.productId);

  // Count + product-side aggregate snapshot in parallel.
  const [countRows, productRows] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(reviews)
      .where(where),
    db
      .select({
        ratingAverage: products.ratingAverage,
        ratingCount: products.ratingCount,
      })
      .from(products)
      .where(eq(products.id, input.productId))
      .limit(1),
  ]);

  const total = countRows[0]?.count ?? 0;
  const productAggregate = productRows[0];
  const summary = {
    average: productAggregate ? Number(productAggregate.ratingAverage ?? 0) : 0,
    count: productAggregate?.ratingCount ?? 0,
  };

  if (total === 0) {
    return {
      items: [],
      page,
      pageSize,
      total: 0,
      totalPages: 0,
      hasMore: false,
      summary,
    };
  }

  const rows = await db
    .select({
      review: reviews,
      authorName: users.name,
      authorEmail: users.email,
    })
    .from(reviews)
    .innerJoin(users, eq(users.id, reviews.userId))
    .where(where)
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const items = rows.map((r) => toPublicReview(r));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return {
    items,
    page,
    pageSize,
    total,
    totalPages,
    hasMore: page < totalPages,
    summary,
  };
}

/**
 * Has the user purchased this product at least once? "Purchased" here
 * means there is at least one `order_items` row referencing this
 * product on any order owned by the user, regardless of order status —
 * the cart-side guarantees prevent an order from existing for a
 * never-paid attempt, and even cancelled orders count as a verified
 * encounter for the purpose of the review-eligibility rule. Tightening
 * to a specific status set is a one-line change here.
 */
export async function userHasPurchasedProduct(
  userId: string,
  productId: string,
): Promise<boolean> {
  const rows = await db
    .select({ count: count() })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      and(eq(orders.userId, userId), eq(orderItems.productId, productId)),
    );
  return (rows[0]?.count ?? 0) > 0;
}

/** Look up an existing review for the (user, product) pair. */
export async function findReview(
  userId: string,
  productId: string,
): Promise<Review | null> {
  const rows = await db
    .select()
    .from(reviews)
    .where(and(eq(reviews.userId, userId), eq(reviews.productId, productId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Recompute and persist the parent product's `rating_average` /
 * `rating_count` from the live `reviews` rows. Run inside the same
 * code path that mutates `reviews` so the rolled-up aggregate is
 * always in step with the underlying review set.
 *
 * Returns the freshly computed summary so callers can include it in
 * the response without a second round-trip.
 */
export async function recomputeProductRating(
  productId: string,
): Promise<{ average: number; count: number }> {
  const [row] = await db
    .select({
      avg: sql<string | null>`AVG(${reviews.rating})::numeric(10,4)`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(reviews)
    .where(eq(reviews.productId, productId));

  const ratingCount = row?.count ?? 0;
  // Postgres AVG returns NULL on an empty set; coerce to 0 so the
  // numeric column never holds NULL.
  const ratingAverage = row?.avg ? Number(row.avg) : 0;

  // `rating_average` is `numeric(3, 2)` — clamp to two decimals before
  // writing so the comparison reads cleanly in the UI.
  const rounded = Math.round(ratingAverage * 100) / 100;

  await db
    .update(products)
    .set({
      ratingAverage: rounded.toFixed(2),
      ratingCount,
      updatedAt: new Date(),
    })
    .where(eq(products.id, productId));

  return { average: rounded, count: ratingCount };
}

/**
 * Insert a review.
 *
 * The flow is:
 *   1. Validate the rating + optional comment.
 *   2. Verify the user has actually purchased the product.
 *   3. Pre-check for an existing review (returns `already_reviewed`
 *      cleanly; the unique index is a backstop for concurrent inserts).
 *   4. Insert the row with `verified_purchase = true`.
 *   5. Recompute the parent product's rating aggregate.
 *
 * Returns the newly inserted review (with the author display name
 * resolved) plus the fresh summary so the route layer can pass both
 * back to the client.
 */
export async function createReview(
  input: CreateReviewInput,
): Promise<CreateReviewResult> {
  const rating = Number(input.rating);
  if (
    !Number.isInteger(rating) ||
    rating < REVIEW_RATING_MIN ||
    rating > REVIEW_RATING_MAX
  ) {
    return { ok: false, error: { code: "rating_invalid" } };
  }

  const comment = input.comment?.trim() ?? null;
  if (comment !== null && comment.length > REVIEW_COMMENT_MAX_LENGTH) {
    return { ok: false, error: { code: "comment_too_long" } };
  }

  // Confirm the product exists. The route already does this when
  // resolving `id`, but this helper is safe to call standalone so we
  // re-check defensively — a deleted product between resolve and
  // insert would otherwise surface as an opaque FK violation.
  const productRows = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, input.productId))
    .limit(1);
  if (productRows.length === 0) {
    return { ok: false, error: { code: "product_not_found" } };
  }

  // Verified-purchase gate.
  const purchased = await userHasPurchasedProduct(
    input.userId,
    input.productId,
  );
  if (!purchased) {
    return { ok: false, error: { code: "not_verified_purchaser" } };
  }

  // Pre-check duplicate so callers receive a clean 409.
  const existing = await findReview(input.userId, input.productId);
  if (existing) {
    return { ok: false, error: { code: "already_reviewed" } };
  }

  let inserted: Review;
  try {
    const rows = await db
      .insert(reviews)
      .values({
        userId: input.userId,
        productId: input.productId,
        rating,
        comment: comment === "" ? null : comment,
        verifiedPurchase: true,
      })
      .returning();
    const row = rows[0];
    if (!row) {
      return {
        ok: false,
        error: { code: "internal_error", message: "Insert returned no row" },
      };
    }
    inserted = row;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Concurrent insert collided with the unique index.
    if (/duplicate|unique/i.test(message)) {
      return { ok: false, error: { code: "already_reviewed" } };
    }
    // The CHECK constraint on `rating` is a backstop — if someone
    // bypasses the route validator we want a typed 400 error rather
    // than a 500.
    if (/reviews_rating_range|check constraint/i.test(message)) {
      return { ok: false, error: { code: "rating_invalid" } };
    }
    return { ok: false, error: { code: "internal_error", message } };
  }

  // Recompute parent aggregate so the PDP rating banner is fresh.
  const summary = await recomputeProductRating(input.productId);

  // Resolve author display fields for the response.
  const userRows = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  const author = userRows[0];

  const data = toPublicReview({
    review: inserted,
    authorName: author?.name ?? null,
    authorEmail: author?.email ?? "",
  });

  return { ok: true, data, summary };
}
