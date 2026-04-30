"use client";

import * as React from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { StarRatingInput } from "@/components/products/review-stars";
import { cn } from "@/lib/client/utils";

/** Mirrors `REVIEW_COMMENT_MAX_LENGTH` from `lib/server/reviews`. */
export const REVIEW_COMMENT_MAX_LENGTH = 4000;

interface ReviewSubmitErrorBody {
  error?: string;
  code?: string;
  fieldErrors?: Record<string, string[]>;
}

interface ReviewFormProps {
  /** UUID or slug — matches what the page is keyed by. */
  productId: string;
  /** Called after a successful POST so the parent can refresh the list. */
  onSubmitted: () => void | Promise<void>;
  className?: string;
}

/**
 * Star + textarea form posted to `POST /api/products/{id}/reviews`.
 *
 * Behaviour:
 *   - Star input is required (1-5). The submit button stays disabled
 *     until the shopper picks a rating.
 *   - Comment is optional and capped at REVIEW_COMMENT_MAX_LENGTH.
 *   - On success: toast, clear the form, and call `onSubmitted` so the
 *     parent can refetch the reviews list and toggle off the form.
 *   - On 401: toast with a link cue (parent normally renders this only
 *     for verified purchasers, so a 401 here means the cookie expired).
 *   - On 403 / 409: surface the specific server message.
 */
export function ReviewForm({
  productId,
  onSubmitted,
  className,
}: ReviewFormProps) {
  const [rating, setRating] = React.useState(0);
  const [comment, setComment] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const remaining = REVIEW_COMMENT_MAX_LENGTH - comment.length;
  const tooLong = remaining < 0;
  const ratingMissing = rating < 1;
  const canSubmit = !pending && !ratingMissing && !tooLong;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      if (ratingMissing) setError("Please pick a rating from 1 to 5.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      const trimmed = comment.trim();
      const res = await fetch(
        `/api/products/${encodeURIComponent(productId)}/reviews`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rating,
            comment: trimmed.length > 0 ? trimmed : null,
          }),
        },
      );
      if (!res.ok) {
        let body: ReviewSubmitErrorBody = {};
        try {
          body = (await res.json()) as ReviewSubmitErrorBody;
        } catch {
          // Non-JSON body — fall through to a generic toast.
        }
        if (res.status === 401) {
          setError("You need to sign in before posting a review.");
          toast.error("Sign in required", {
            description: "Please sign in and try again.",
          });
          return;
        }
        if (res.status === 403 && body.code === "not_verified_purchaser") {
          setError(
            "Only verified buyers can review this product. Order it first to leave a review.",
          );
          toast.error("Verified purchase required", {
            description:
              "You can review this product after your order is placed.",
          });
          return;
        }
        if (res.status === 409 && body.code === "already_reviewed") {
          setError("You have already reviewed this product.");
          toast.error("Already reviewed", {
            description: "Your earlier review is shown in the list below.",
          });
          // Treat duplicate as a "soft success" so the parent flips out
          // of the form state and refreshes the list.
          await onSubmitted();
          return;
        }
        if (res.status === 400) {
          const message =
            body.fieldErrors?.rating?.[0] ??
            body.fieldErrors?.comment?.[0] ??
            body.error ??
            "Please double-check your review and try again.";
          setError(message);
          toast.error("Couldn't submit review", { description: message });
          return;
        }
        const fallback = body.error ?? "Please try again in a moment.";
        setError(fallback);
        toast.error("Couldn't submit review", { description: fallback });
        return;
      }

      // Success.
      toast.success("Thanks for the review!", {
        description: "Your feedback has been posted.",
      });
      setRating(0);
      setComment("");
      await onSubmitted();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Could not reach the server. Please try again.";
      setError(message);
      toast.error("Network error", { description: message });
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={cn("space-y-4 rounded-lg border bg-card p-4 sm:p-5", className)}
      data-testid="review-form"
      noValidate
    >
      <div className="space-y-1.5">
        <h3 className="text-base font-semibold tracking-tight">
          Write a review
        </h3>
        <p className="text-xs text-muted-foreground">
          Share your experience with this product. Your name will be shown next
          to your review.
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium">
          Rating <span className="text-destructive">*</span>
        </Label>
        <StarRatingInput
          value={rating}
          onChange={(v) => {
            setRating(v);
            if (error) setError(null);
          }}
          disabled={pending}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor="review-comment" className="text-sm font-medium">
            Your review <span className="text-muted-foreground">(optional)</span>
          </Label>
          <span
            className={cn(
              "text-xs tabular-nums",
              tooLong ? "text-destructive" : "text-muted-foreground",
            )}
            aria-live="polite"
          >
            {comment.length}/{REVIEW_COMMENT_MAX_LENGTH}
          </span>
        </div>
        <textarea
          id="review-comment"
          name="comment"
          rows={4}
          maxLength={REVIEW_COMMENT_MAX_LENGTH}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          disabled={pending}
          placeholder="What did you love? What would you improve?"
          className="flex min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      {error && (
        <p
          role="alert"
          className="text-sm font-medium text-destructive"
          data-testid="review-form-error"
        >
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={!canSubmit}
          data-testid="review-form-submit"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-4 w-4" aria-hidden="true" />
          )}
          {pending ? "Posting…" : "Post review"}
        </Button>
      </div>
    </form>
  );
}
