"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/client/utils";
import { useCart } from "@/lib/client/cart-store";
import { formatPrice } from "@/lib/client/format";
import type { WishlistEntryView } from "@/lib/client/wishlist-types";
import { useWishlist } from "@/lib/client/wishlist-store";

interface WishlistListProps {
  items: ReadonlyArray<WishlistEntryView>;
}

/**
 * Per-line cart cap mirrored from `lib/server/cart`. Kept inline so this
 * client component does not pull a server-only module.
 */
const MAX_QUANTITY_PER_LINE = 99;

interface CartErrorBody {
  error?: string;
  code?: string;
  details?: { available?: number; requested?: number; max?: number };
}

/**
 * Client-side renderer for the /wishlist page.
 *
 * Receives the SSR-loaded items and renders one row per entry with two
 * primary actions:
 *
 *   1. **Add to cart** — POST /api/cart with `quantity: 1`. On success
 *      we also call `wishlist.remove()` so the item moves from the
 *      wishlist into the cart in a single click; on cart failure we
 *      leave the wishlist row untouched and surface the API's reason
 *      via a toast (out-of-stock, exceeds-stock, auth, network).
 *      Out-of-stock items render the button disabled with an explicit
 *      "Out of stock" label and a sibling hint message.
 *
 *   2. **Remove** — flows through the shared `WishlistProvider` so:
 *      - The optimistic update is instant (the row fades out before the
 *        network round-trip completes).
 *      - Heart buttons elsewhere on the same session stay in sync.
 *      - Toast feedback is consistent with the rest of the app.
 *
 * After a successful mutation we call `router.refresh()` so the
 * server-rendered totals / empty state catch up — relying on the
 * optimistic state alone would briefly disagree with the SSR snapshot
 * if the user navigates back from another page.
 */
export function WishlistList({ items }: WishlistListProps) {
  const router = useRouter();
  const wishlist = useWishlist();
  const cart = useCart();
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [busyAction, setBusyAction] = React.useState<
    "remove" | "cart" | null
  >(null);
  // Track items the user has just removed (or moved to cart) so the SSR
  // snapshot can fade them out instantly while we wait for the server to
  // catch up.
  const [removedIds, setRemovedIds] = React.useState<Set<string>>(
    () => new Set(),
  );

  const visible = items.filter((entry) => !removedIds.has(entry.productId));

  const markRemoved = (productId: string) => {
    setRemovedIds((prev) => {
      if (prev.has(productId)) return prev;
      const next = new Set(prev);
      next.add(productId);
      return next;
    });
  };

  const unmarkRemoved = (productId: string) => {
    setRemovedIds((prev) => {
      if (!prev.has(productId)) return prev;
      const next = new Set(prev);
      next.delete(productId);
      return next;
    });
  };

  const handleRemove = async (entry: WishlistEntryView) => {
    if (busyId) return;
    setBusyId(entry.productId);
    setBusyAction("remove");
    markRemoved(entry.productId);
    const result = await wishlist.remove(
      entry.productId,
      entry.product?.name,
    );
    if (!result.ok) {
      // Roll back the optimistic hide. The provider already toasted.
      unmarkRemoved(entry.productId);
    } else {
      // Re-run the server fetch so totals + empty state catch up.
      router.refresh();
    }
    setBusyId(null);
    setBusyAction(null);
  };

  const handleAddToCart = async (entry: WishlistEntryView) => {
    if (busyId) return;
    const product = entry.product;
    if (!product) return;
    if (product.stockStatus === "out_of_stock" || product.stock <= 0) return;

    setBusyId(entry.productId);
    setBusyAction("cart");

    try {
      const res = await fetch("/api/cart", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: entry.productId,
          quantity: 1,
          mode: "increment",
        }),
      });

      if (!res.ok) {
        let body: CartErrorBody = {};
        try {
          body = (await res.json()) as CartErrorBody;
        } catch {
          // ignore — fall through to a generic toast
        }
        if (res.status === 401) {
          toast.error("Sign in to add to your cart", {
            description:
              "Your session has expired. Sign in again to keep shopping.",
          });
          return;
        }
        if (res.status === 409 && body.code === "out_of_stock") {
          toast.error("Out of stock", {
            description: `${product.name} is currently unavailable.`,
          });
          // The wishlist row will refresh from the SSR snapshot on next
          // render so the disabled state syncs up with reality.
          router.refresh();
          return;
        }
        if (res.status === 409 && body.code === "exceeds_stock") {
          toast.error("Not enough stock", {
            description:
              typeof body.details?.available === "number"
                ? `Only ${body.details.available} left in stock — already in your cart.`
                : "We don't have enough left to add another to your cart.",
          });
          return;
        }
        if (res.status === 400 && body.code === "exceeds_max_quantity") {
          toast.error("Cart limit reached", {
            description: `You already have the maximum of ${
              body.details?.max ?? MAX_QUANTITY_PER_LINE
            } in your cart.`,
          });
          return;
        }
        if (res.status === 404 && body.code === "product_not_found") {
          toast.error("Product unavailable", {
            description: `${product.name} is no longer available.`,
          });
          return;
        }
        toast.error("Couldn't add to cart", {
          description: body.error ?? "Please try again in a moment.",
        });
        return;
      }

      // Cart add succeeded — bump the header badge optimistically, then
      // optimistically hide the row and quietly remove it from the
      // wishlist on the server. We surface a single success toast that
      // reflects the move so the user isn't double-notified by the
      // wishlist provider (`silent: true` suppresses the provider's own
      // "Removed from wishlist" toast).
      cart.incrementCount(1);
      markRemoved(entry.productId);
      const removeResult = await wishlist.remove(
        entry.productId,
        product.name,
        { silent: true },
      );
      if (!removeResult.ok) {
        // Cart add was real — keep the success toast but unhide the row
        // so the user can manually retry the wishlist removal. The
        // provider has already shown a removal-failure toast in that
        // path; we still confirm the cart add itself.
        unmarkRemoved(entry.productId);
        toast.success("Added to cart", {
          description: `${product.name} is now in your cart.`,
        });
      } else {
        toast.success("Moved to cart", {
          description: `${product.name} is in your cart and removed from your wishlist.`,
        });
      }
      // Reconcile the badge against the server's authoritative count
      // (in case the increment over-counted relative to a stock cap).
      void cart.refresh();
      router.refresh();
    } catch (err) {
      toast.error("Network error", {
        description:
          err instanceof Error
            ? err.message
            : "Could not reach the server. Please try again.",
      });
    } finally {
      setBusyId(null);
      setBusyAction(null);
    }
  };

  if (visible.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center">
        <h2 className="text-lg font-semibold">Your wishlist is empty</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Save items you love by tapping the heart on any product. They&apos;ll
          show up here so you can come back to them later.
        </p>
        <div className="mt-4">
          <Button asChild>
            <Link href="/products">Browse products</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <ul className="space-y-3" data-testid="wishlist-items">
      {visible.map((entry) => {
        const product = entry.product;
        // Defensive fallback: server filters orphan rows already, but if
        // one slips through render it as a plain "unavailable" stub.
        if (!product) {
          return (
            <Card key={entry.id}>
              <CardContent className="flex items-center justify-between gap-4 p-4">
                <div className="text-sm text-muted-foreground">
                  This product is no longer available.
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemove(entry)}
                  disabled={busyId === entry.productId}
                >
                  {busyId === entry.productId && busyAction === "remove" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  Remove
                </Button>
              </CardContent>
            </Card>
          );
        }

        const price = formatPrice(product.priceCents, product.currency);
        const compareAt =
          product.compareAtPriceCents != null &&
          product.compareAtPriceCents > product.priceCents
            ? formatPrice(product.compareAtPriceCents, product.currency)
            : null;

        const outOfStock =
          product.stockStatus === "out_of_stock" || product.stock <= 0;

        const stockBadge = outOfStock ? (
          <Badge variant="destructive">Out of stock</Badge>
        ) : product.stockStatus === "low_stock" ? (
          <Badge variant="warning">
            Low stock{product.stock > 0 ? ` · only ${product.stock} left` : ""}
          </Badge>
        ) : (
          <Badge variant="success">In stock</Badge>
        );

        const pdpHref = `/products/${product.slug}`;
        const isBusy = busyId === entry.productId;
        const cartLoading = isBusy && busyAction === "cart";
        const removeLoading = isBusy && busyAction === "remove";

        return (
          <li key={entry.id}>
            <Card
              className={cn(
                "transition-opacity",
                isBusy && "opacity-60",
              )}
            >
              <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-stretch">
                <Link
                  href={pdpHref}
                  className="block w-full shrink-0 overflow-hidden rounded-md bg-muted sm:h-32 sm:w-32"
                  aria-label={product.name}
                >
                  <div className="aspect-[4/5] sm:h-full sm:w-full">
                    {product.primaryImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={product.primaryImageUrl}
                        alt={product.name}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                        No image
                      </div>
                    )}
                  </div>
                </Link>

                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  {product.category && (
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {product.category.name}
                    </p>
                  )}
                  <h3 className="text-base font-semibold leading-tight">
                    <Link
                      href={pdpHref}
                      className="hover:underline focus-visible:underline focus-visible:outline-none"
                    >
                      {product.name}
                    </Link>
                  </h3>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-base font-semibold">{price}</span>
                    {compareAt && (
                      <span className="text-xs text-muted-foreground line-through">
                        {compareAt}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {stockBadge}
                    <span>
                      Saved on {new Date(entry.addedAt).toLocaleDateString()}
                    </span>
                  </div>
                  {outOfStock && (
                    <p
                      className="text-xs text-destructive"
                      data-testid={`wishlist-oos-${product.id}`}
                    >
                      Out of stock — we&apos;ll let you keep this saved for
                      when it&apos;s back.
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 flex-col gap-2 sm:items-stretch sm:justify-between">
                  <div className="flex flex-row gap-2 sm:flex-col">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleAddToCart(entry)}
                      disabled={outOfStock || isBusy}
                      className="sm:w-40"
                      aria-label={
                        outOfStock
                          ? `${product.name} is out of stock`
                          : `Add ${product.name} to cart`
                      }
                      data-testid={`wishlist-add-to-cart-${product.id}`}
                    >
                      {cartLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ShoppingCart className="h-4 w-4" />
                      )}
                      {outOfStock ? "Out of stock" : "Add to cart"}
                    </Button>
                    <Button
                      asChild
                      size="sm"
                      variant="outline"
                      className="sm:w-40"
                    >
                      <Link href={pdpHref}>View product</Link>
                    </Button>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRemove(entry)}
                    disabled={isBusy}
                    className="text-muted-foreground hover:text-destructive sm:w-40"
                    aria-label={`Remove ${product.name} from wishlist`}
                    data-testid={`wishlist-remove-${product.id}`}
                  >
                    {removeLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    Remove
                  </Button>
                </div>
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
