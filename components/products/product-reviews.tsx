"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2, MessageSquare, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ReviewForm } from "@/components/products/review-form";
import { ReviewStars } from "@/components/products/review-stars";
import { formatRating } from "@/lib/client/format";
import { cn } from "@/lib/client/utils";

/**
 * Public review shape mirrored from `lib/server/reviews.PublicReview`.
 * Duplicated here because that module is server-only — the client
 * bundle just needs the JSON shape, not the helpers.
 */
export interface PublicReviewItem {
  id: string;
  productId: string;
  rating: number;
  comment: string | null;
  verifiedPurchase: boolean;
  authorName: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewsListPayload {
  items: PublicReviewItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
  summary: { average: number; count: number };
}

/**
 * Server-resolved eligibility for the inline review form.
 *
 *   - eligible           authenticated, verified purchaser, no existing
 *                        review → form is rendered.
 *   - already_reviewed   user has already posted a review for this
 *                        product → callout shown instead of the form.
 *   - not_purchased      authenticated but has not purchased this
 *                        product → "Buy it first" callout.
 *   - unauthenticated    no session cookie → sign-in CTA.
 */
export type ReviewEligibility =
  | "eligible"
  | "already_reviewed"
  | "not_purchased"
  | "unauthenticated";

interface ProductReviewsProps {
  productId: string;
  productSlug: string;
  initialReviews: ReviewsListPayload;
  initialEligibility: ReviewEligibility;
  className?: string;
}

const PAGE_SIZE = 10;

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

/**
 * Fetch the next page of reviews from the public API.
 *
 * Returns the parsed JSON body on 2xx, throws on anything else so the
 * caller can surface a generic error message.
 */
async function fetchReviewsPage(
  productId: string,
  page: number,
): Promise<ReviewsListPayload> {
  const res = await fetch(
    `/api/products/${encodeURIComponent(productId)}/reviews?page=${page}&pageSize=${PAGE_SIZE}`,
    {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      cache: "no-store",
    },
  );
  if (!res.ok) {
    throw new Error(`Failed to load reviews (status ${res.status})`);
  }
  return (await res.json()) as ReviewsListPayload;
}

/**
 * The full PDP reviews section: summary banner, eligibility-aware form,
 * and paginated list. The page renders this with server-fetched
 * `initialReviews` so the first paint is fast; subsequent refreshes /
 * pagination go through the public API.
 */
export function ProductReviews({
  productId,
  productSlug,
  initialReviews,
  initialEligibility,
  className,
}: ProductReviewsProps) {
  const [data, setData] = React.useState<ReviewsListPayload>(initialReviews);
  const [eligibility, setEligibility] =
    React.useState<ReviewEligibility>(initialEligibility);
  const [refreshing, setRefreshing] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [pageError, setPageError] = React.useState<string | null>(null);

  /** Re-fetch the first page; called after a successful POST. */
  const refreshFirstPage = React.useCallback(async () => {
    setRefreshing(true);
    setPageError(null);
    try {
      const next = await fetchReviewsPage(productId, 1);
      setData(next);
      // After a successful submission the user has, by definition,
      // posted a review — flip the eligibility flag locally so the form
      // disappears without a page reload.
      setEligibility("already_reviewed");
    } catch (err) {
      setPageError(
        err instanceof Error ? err.message : "Could not reload reviews.",
      );
    } finally {
      setRefreshing(false);
    }
  }, [productId]);

  /** Append the next page onto the visible list. */
  const loadMore = React.useCallback(async () => {
    if (!data.hasMore || loadingMore) return;
    setLoadingMore(true);
    setPageError(null);
    try {
      const nextPage = data.page + 1;
      const next = await fetchReviewsPage(productId, nextPage);
      setData((prev) => ({
        ...next,
        items: [...prev.items, ...next.items],
      }));
    } catch (err) {
      setPageError(
        err instanceof Error ? err.message : "Could not load more reviews.",
      );
    } finally {
      setLoadingMore(false);
    }
  }, [data.hasMore, data.page, loadingMore, productId]);

  const summary = data.summary;
  const nextPath = `/products/${productSlug}`;
  const encoded = encodeURIComponent(nextPath);

  return (
    <section
      id="reviews"
      aria-labelledby="reviews-heading"
      className={cn("mt-12 space-y-6", className)}
      data-testid="product-reviews"
    >
      <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-3">
        <div className="space-y-1">
          <h2 id="reviews-heading" className="text-xl font-semibold tracking-tight">
            Customer reviews
          </h2>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ReviewStars value={summary.average} />
            <span className="font-medium text-foreground">
              {formatRating(summary.average)}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {summary.count.toLocaleString()}{" "}
              {summary.count === 1 ? "review" : "reviews"}
            </span>
          </div>
        </div>
        {refreshing && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            Refreshing…
          </span>
        )}
      </div>

      {/* Eligibility-aware action area. */}
      {eligibility === "eligible" && (
        <ReviewForm productId={productId} onSubmitted={refreshFirstPage} />
      )}

      {eligibility === "already_reviewed" && (
        <div
          className="flex items-start gap-2 rounded-md border bg-muted/40 p-4 text-sm"
          data-testid="review-eligibility-already-reviewed"
        >
          <ShieldCheck
            className="mt-0.5 h-4 w-4 text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          />
          <div>
            <p className="font-medium">Thanks for your review!</p>
            <p className="text-muted-foreground">
              You can only review a product once. Your review is included in
              the list below.
            </p>
          </div>
        </div>
      )}

      {eligibility === "not_purchased" && (
        <div
          className="flex items-start gap-2 rounded-md border bg-muted/40 p-4 text-sm"
          data-testid="review-eligibility-not-purchased"
        >
          <MessageSquare
            className="mt-0.5 h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          <div>
            <p className="font-medium">
              Reviews are open to verified buyers.
            </p>
            <p className="text-muted-foreground">
              Order this item to share your thoughts with other shoppers.
            </p>
          </div>
        </div>
      )}

      {eligibility === "unauthenticated" && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/40 p-4 text-sm"
          data-testid="review-eligibility-unauthenticated"
        >
          <div className="flex items-start gap-2">
            <MessageSquare
              className="mt-0.5 h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
            <div>
              <p className="font-medium">Sign in to write a review.</p>
              <p className="text-muted-foreground">
                Verified buyers can rate and review this product.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/register?next=${encoded}%23reviews`}>
                Create account
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href={`/login?next=${encoded}%23reviews`}>Sign in</Link>
            </Button>
          </div>
        </div>
      )}

      {/* Reviews list. */}
      <div className="space-y-4" data-testid="reviews-list">
        {data.items.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No reviews yet. Be the first to share your thoughts.
          </div>
        ) : (
          <ul className="space-y-4">
            {data.items.map((review) => (
              <li
                key={review.id}
                className="space-y-2 rounded-md border bg-card p-4"
                data-testid="review-item"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ReviewStars value={review.rating} />
                    <span className="font-medium text-foreground">
                      {review.authorName}
                    </span>
                    {review.verifiedPurchase && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                        title="Verified purchase"
                      >
                        <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                        Verified buyer
                      </span>
                    )}
                  </div>
                  <time
                    dateTime={review.createdAt}
                    className="text-xs text-muted-foreground"
                  >
                    {formatDate(review.createdAt)}
                  </time>
                </div>
                {review.comment && review.comment.trim().length > 0 && (
                  <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">
                    {review.comment}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        {pageError && (
          <p
            role="alert"
            className="text-sm font-medium text-destructive"
            data-testid="reviews-error"
          >
            {pageError}
          </p>
        )}

        {data.hasMore && (
          <div className="flex justify-center pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={loadMore}
              disabled={loadingMore}
              data-testid="reviews-load-more"
            >
              {loadingMore ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              {loadingMore ? "Loading…" : "Load more reviews"}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
