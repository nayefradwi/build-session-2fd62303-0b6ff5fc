"use client";

import * as React from "react";
import { Star } from "lucide-react";

import { cn } from "@/lib/client/utils";

/**
 * Read-only star strip used in the reviews list. Renders 5 stars and
 * fills the first `value` of them. The wrapper exposes the rating to
 * assistive tech via `aria-label` so the visual cue is also announced.
 */
export function ReviewStars({
  value,
  size = 16,
  className,
}: {
  value: number;
  size?: number;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <span
      className={cn("inline-flex items-center gap-0.5", className)}
      role="img"
      aria-label={`Rated ${clamped} out of 5`}
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          width={size}
          height={size}
          className={cn(
            i < clamped
              ? "fill-amber-400 text-amber-400"
              : "fill-transparent text-muted-foreground/40",
          )}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

/**
 * Interactive 1–5 star input used by the review form. Mirrors the
 * keyboard semantics of a radio group (←/→ to move, space/enter to
 * select, Home/End for endpoints) and surfaces a hover preview on
 * pointer devices.
 *
 * The hidden radios are the source of truth so screen readers and
 * non-JS form posts behave correctly. The visible buttons are an
 * enhancement layer that drives the same state.
 */
export function StarRatingInput({
  value,
  onChange,
  disabled,
  name = "rating",
  ariaLabel = "Rating",
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  name?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const [hover, setHover] = React.useState<number | null>(null);
  const display = hover ?? value;

  const handleKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      const next = Math.max(1, value - 1);
      onChange(next);
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = Math.min(5, value === 0 ? 1 : value + 1);
      onChange(next);
    } else if (event.key === "Home") {
      event.preventDefault();
      onChange(1);
    } else if (event.key === "End") {
      event.preventDefault();
      onChange(5);
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={handleKey}
      onMouseLeave={() => setHover(null)}
      className={cn("inline-flex items-center gap-1", className)}
      data-testid="review-star-input"
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = display >= n;
        const checked = value === n;
        return (
          <label
            key={n}
            className={cn(
              "cursor-pointer select-none rounded-sm p-0.5 transition",
              disabled && "cursor-not-allowed opacity-60",
              !disabled && "hover:scale-110 focus-within:ring-2 focus-within:ring-ring",
            )}
            onMouseEnter={() => !disabled && setHover(n)}
          >
            <input
              type="radio"
              className="sr-only"
              name={name}
              value={n}
              checked={checked}
              onChange={() => onChange(n)}
              disabled={disabled}
              aria-label={`${n} ${n === 1 ? "star" : "stars"}`}
            />
            <Star
              className={cn(
                "h-7 w-7 transition-colors",
                filled
                  ? "fill-amber-400 text-amber-400"
                  : "fill-transparent text-muted-foreground/50",
              )}
              aria-hidden="true"
            />
          </label>
        );
      })}
      <span
        className="ml-2 text-sm tabular-nums text-muted-foreground"
        aria-live="polite"
      >
        {value > 0 ? `${value} / 5` : "Pick a rating"}
      </span>
    </div>
  );
}
