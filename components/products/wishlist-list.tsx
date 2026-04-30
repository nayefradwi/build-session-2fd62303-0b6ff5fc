"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/client/utils";
import { formatPrice } from "@/lib/client/format";
import type { WishlistEntryView } from "@/lib/client/wishlist-types";
import { useWishlist } from "@/lib/client/wishlist-store";

interface WishlistListProps {
  items: ReadonlyArray<WishlistEntryView>;
}

/**
 * Client-side renderer for the /wishlist page.
 *
 * Receives the SSR-loaded items and renders one row per entry. Removal
 * goes through the shared `WishlistProvider` so:
 *   - The optimistic update is instant (the row fades out before the
 *     network round-trip completes).
 *   - Heart buttons elsewhere on the same session stay in sync.
 *   - Toast feedback is consistent with the rest of the app.
 *
 * After a successful removal we also call `router.refresh()` so the
 * server-rendered totals / empty state catch up — relying on the
 * optimistic state alone would briefly disagree with the SSR snapshot
 * if the user navigates back from another page.
 */
export function WishlistList({ items }: WishlistListProps) {
  const router = useRouter();
  const wishlist = useWishlist();
  const [busyId, setBusyId] = React.useState<string | null>(null);
  // Track items the user has just removed so the SSR snapshot can fade
  // them out instantly while we wait for the server to catch up.
  const [removedIds, setRemovedIds] = React.useState<Set<string>>(
    () => new Set(),
  );

  const visible = items.filter((entry) => !removedIds.has(entry.productId));

  const handleRemove = async (entry: WishlistEntryView) => {
    if (busyId) return;
    setBusyId(entry.productId);
    setRemovedIds((prev) => {
      const next = new Set(prev);
      next.add(entry.productId);
      return next;
    });
    const result = await wishlist.remove(
      entry.productId,
      entry.product?.name,
    );
    if (!result.ok) {
      // Roll back the optimistic hide. The provider already toasted.
      setRemovedIds((prev) => {
        if (!prev.has(entry.productId)) return prev;
        const next = new Set(prev);
        next.delete(entry.productId);
        return next;
      });
    } else {
      // Re-run the server fetch so totals + empty state catch up.
      router.refresh();
    }
    setBusyId(null);
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
                  {busyId === entry.productId ? (
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

        const stockBadge =
          product.stockStatus === "out_of_stock" ? (
            <Badge variant="destructive">Out of stock</Badge>
          ) : product.stockStatus === "low_stock" ? (
            <Badge variant="warning">
              Low stock{product.stock > 0 ? ` · only ${product.stock} left` : ""}
            </Badge>
          ) : (
            <Badge variant="success">In stock</Badge>
          );

        const pdpHref = `/products/${product.slug}`;

        return (
          <li key={entry.id}>
            <Card
              className={cn(
                "transition-opacity",
                busyId === entry.productId && "opacity-60",
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
                </div>

                <div className="flex shrink-0 flex-row gap-2 sm:flex-col sm:items-end sm:justify-between">
                  <Button asChild size="sm" variant="outline">
                    <Link href={pdpHref}>View product</Link>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRemove(entry)}
                    disabled={busyId === entry.productId}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${product.name} from wishlist`}
                    data-testid={`wishlist-remove-${product.id}`}
                  >
                    {busyId === entry.productId ? (
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
