import Link from "next/link";
import { Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/client/utils";
import { formatPrice, formatRatingWithCount } from "@/lib/client/format";
import type { ProductCardData } from "@/lib/client/product-types";

interface ProductCardProps {
  product: ProductCardData;
  /** Show "Featured" / "New" merchandising badges in the corner. */
  showMerchBadges?: boolean;
  className?: string;
}

/**
 * Renders a single product tile for grids on the homepage and the
 * /products listing.
 *
 * The whole card is one big anchor so the entire surface is a click
 * target — important on touch where small "view" buttons are awkward.
 *
 * Layout:
 *   - Square-ish image with stock + merchandising overlays
 *   - Category eyebrow (only when present)
 *   - Product name (truncated to two lines)
 *   - Rating row: filled star + "4.7 (128)"
 *   - Price (with optional strikethrough compare-at price)
 */
export function ProductCard({
  product,
  showMerchBadges = true,
  className,
}: ProductCardProps) {
  const price = formatPrice(product.priceCents, product.currency);
  const compareAt =
    product.compareAtPriceCents != null &&
    product.compareAtPriceCents > product.priceCents
      ? formatPrice(product.compareAtPriceCents, product.currency)
      : null;

  const lowStock = product.inStock && product.stock <= 5;

  return (
    <Link
      href={`/products/${product.slug}`}
      className={cn(
        "group block h-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
      aria-label={`${product.name}, ${price}`}
    >
      <Card className="flex h-full flex-col overflow-hidden transition-shadow group-hover:shadow-md">
        <div className="relative aspect-[4/5] w-full overflow-hidden bg-muted">
          {product.primaryImageUrl ? (
            // Plain <img> on purpose: avoids configuring `next/image`
            // remote patterns for the picsum-seeded catalog and keeps
            // us in the frontend territory.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.primaryImageUrl}
              alt={product.name}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
              No image
            </div>
          )}

          {/* Merchandising badges (top-left). */}
          {showMerchBadges && (product.isNew || product.isFeatured) && (
            <div className="absolute left-2 top-2 flex flex-wrap gap-1">
              {product.isNew && (
                <Badge variant="default" className="shadow-sm">
                  New
                </Badge>
              )}
              {product.isFeatured && !product.isNew && (
                <Badge variant="secondary" className="shadow-sm">
                  Featured
                </Badge>
              )}
            </div>
          )}

          {/* Stock badge (top-right). Always present so users see status
              before they click into the PDP. */}
          <div className="absolute right-2 top-2">
            {!product.inStock ? (
              <Badge variant="destructive" className="shadow-sm">
                Out of stock
              </Badge>
            ) : lowStock ? (
              <Badge variant="warning" className="shadow-sm">
                Low stock
              </Badge>
            ) : (
              <Badge variant="success" className="shadow-sm">
                In stock
              </Badge>
            )}
          </div>
        </div>

        <CardContent className="flex flex-1 flex-col gap-2 p-4">
          {product.category && (
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {product.category.name}
            </p>
          )}
          <h3 className="line-clamp-2 text-sm font-medium leading-snug text-foreground sm:text-base">
            {product.name}
          </h3>

          <div className="mt-auto flex items-end justify-between gap-2 pt-1">
            <div className="flex items-baseline gap-2">
              <span className="text-base font-semibold text-foreground sm:text-lg">
                {price}
              </span>
              {compareAt && (
                <span className="text-xs text-muted-foreground line-through">
                  {compareAt}
                </span>
              )}
            </div>
            <div
              className="flex items-center gap-1 text-xs text-muted-foreground"
              aria-label={`Rated ${product.rating.average.toFixed(1)} out of 5 from ${product.rating.count} review${product.rating.count === 1 ? "" : "s"}`}
            >
              <Star
                className="h-3.5 w-3.5 fill-amber-400 text-amber-400"
                aria-hidden="true"
              />
              <span>
                {formatRatingWithCount(
                  product.rating.average,
                  product.rating.count,
                )}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
