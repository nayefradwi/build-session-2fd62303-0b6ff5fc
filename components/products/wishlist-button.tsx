"use client";

import * as React from "react";

import { Heart, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SignInPromptDialog } from "@/components/products/sign-in-prompt-dialog";
import { cn } from "@/lib/client/utils";
import { useWishlist } from "@/lib/client/wishlist-store";

/**
 * Visual variants of the wishlist toggle.
 *
 * - `card`: small circular icon button overlaid on a product card. The
 *   surrounding card is itself a clickable Link to the PDP, so this
 *   variant is responsible for stopping click propagation.
 * - `pdp`: full-size button with a label, used in the PDP action row.
 * - `icon`: same shape as `card` but without the elevated background —
 *   useful for inline placements (e.g. a wishlist row).
 */
export type WishlistButtonVariant = "card" | "pdp" | "icon";

interface WishlistButtonProps {
  productId: string;
  productName: string;
  productSlug: string;
  variant?: WishlistButtonVariant;
  className?: string;
  /**
   * Override the auth-prompt redirect target. Defaults to the PDP for
   * the supplied slug, which is almost always what we want.
   */
  nextPath?: string;
}

/**
 * Heart toggle that adds / removes a product from the signed-in user's
 * wishlist via the WishlistProvider.
 *
 * Behaviour:
 *   - Optimistic: the heart fills the moment the user clicks. If the
 *     POST/DELETE fails, the provider rolls the state back and surfaces
 *     a toast.
 *   - Toast feedback ("Added to wishlist" / "Removed from wishlist" /
 *     "Already in your wishlist") is owned by the provider so every
 *     surface speaks the same copy.
 *   - Guests see the SignInPromptDialog (same one used by ProductActions)
 *     instead of hitting the API.
 */
export function WishlistButton({
  productId,
  productName,
  productSlug,
  variant = "card",
  className,
  nextPath,
}: WishlistButtonProps) {
  const wishlist = useWishlist();
  const [pending, setPending] = React.useState(false);
  const [promptOpen, setPromptOpen] = React.useState(false);

  const inWishlist = wishlist.isInWishlist(productId);
  const next = nextPath ?? `/products/${productSlug}`;

  const handleClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    // Stop the parent Link / card click from also firing — important on
    // product cards where the whole tile is a navigation target.
    event.preventDefault();
    event.stopPropagation();
    if (pending) return;

    // We know the user is unauthenticated only after the initial GET
    // resolves. If we already know it, short-circuit to the prompt.
    if (wishlist.loaded && !wishlist.authenticated) {
      setPromptOpen(true);
      return;
    }

    setPending(true);
    try {
      const result = await wishlist.toggle(productId, productName);
      if (!result.ok && result.reason === "unauthenticated") {
        setPromptOpen(true);
      }
    } finally {
      setPending(false);
    }
  };

  const label = inWishlist ? "Remove from wishlist" : "Save to wishlist";

  if (variant === "pdp") {
    return (
      <>
        <Button
          type="button"
          size="lg"
          variant={inWishlist ? "secondary" : "outline"}
          onClick={handleClick}
          disabled={pending}
          aria-pressed={inWishlist}
          aria-label={label}
          className={cn("flex-1 sm:flex-none", className)}
          data-testid="pdp-wishlist-toggle"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Heart
              className={cn(
                "h-4 w-4 transition-colors",
                inWishlist && "fill-rose-500 text-rose-500",
              )}
              aria-hidden="true"
            />
          )}
          {inWishlist ? "In wishlist" : "Wishlist"}
        </Button>
        <SignInPromptDialog
          open={promptOpen}
          onOpenChange={setPromptOpen}
          next={next}
          title="Sign in to save to your wishlist"
          description="Create an account or sign in to save items for later — they'll be waiting on every device."
        />
      </>
    );
  }

  // `card` and `icon` share the same compact circular shape; only the
  // surface treatment differs (card sits on top of an image, so it gets
  // a subtle background to stay legible).
  const compactClasses =
    variant === "card"
      ? "bg-background/90 text-foreground shadow-md backdrop-blur hover:bg-background"
      : "text-muted-foreground hover:bg-accent hover:text-foreground";

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        aria-pressed={inWishlist}
        aria-label={label}
        title={label}
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-full border border-transparent",
          "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-60",
          compactClasses,
          className,
        )}
        data-testid="wishlist-toggle"
        data-in-wishlist={inWishlist ? "true" : "false"}
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Heart
            className={cn(
              "h-4 w-4 transition-colors",
              inWishlist
                ? "fill-rose-500 text-rose-500"
                : "text-muted-foreground",
            )}
            aria-hidden="true"
          />
        )}
        <span className="sr-only">{label}</span>
      </button>
      <SignInPromptDialog
        open={promptOpen}
        onOpenChange={setPromptOpen}
        next={next}
        title="Sign in to save to your wishlist"
        description="Create an account or sign in to save items for later — they'll be waiting on every device."
      />
    </>
  );
}
