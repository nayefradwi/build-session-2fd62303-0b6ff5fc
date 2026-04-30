"use client";

import Link from "next/link";
import { ShoppingCart } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useCart } from "@/lib/client/cart-store";
import { cn } from "@/lib/client/utils";

interface CartLinkProps {
  /**
   * Optional override for the destination. Defaults to `/cart`, which is
   * where the upcoming cart page will live.
   */
  href?: string;
  className?: string;
}

/**
 * Header "Cart" affordance: a ghost button with a shopping-cart icon and
 * a small badge showing the total item count.
 *
 * The component is always rendered as a client component because it
 * subscribes to the shared cart store (`lib/client/cart-store`) — that
 * way the badge updates instantly when the user adds an item from the
 * PDP without waiting for a server-component re-render.
 *
 * The badge is hidden when:
 *   - the cart hasn't loaded yet (avoids an initial flash of "0"), or
 *   - the visitor is unauthenticated (no cart to count), or
 *   - the count is zero.
 *
 * Counts above 99 collapse to "99+" so the badge stays a stable size.
 */
export function CartLink({ href = "/cart", className }: CartLinkProps) {
  const cart = useCart();
  const showBadge = cart.loaded && cart.authenticated && cart.itemCount > 0;
  const display = cart.itemCount > 99 ? "99+" : String(cart.itemCount);
  const aria = showBadge
    ? `View cart, ${cart.itemCount} ${cart.itemCount === 1 ? "item" : "items"}`
    : "View cart";

  return (
    <Button
      asChild
      variant="ghost"
      size="sm"
      aria-label={aria}
      title="Cart"
      className={cn("relative", className)}
    >
      <Link href={href} data-testid="header-cart-link">
        <ShoppingCart className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only sm:not-sr-only">Cart</span>
        {showBadge && (
          <span
            data-testid="header-cart-badge"
            data-count={cart.itemCount}
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute -right-1 -top-1 inline-flex h-5 min-w-[1.25rem]",
              "items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground",
              "ring-2 ring-background",
            )}
          >
            {display}
          </span>
        )}
      </Link>
    </Button>
  );
}
