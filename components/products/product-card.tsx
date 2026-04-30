import Link from "next/link";
import { Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { WishlistButton } from "@/components/products/wishlist-button";
import { cn } from "@/lib/client/utils";
import { formatPrice, formatRatingWithCount } from "@/lib/client/format";
import type { ProductCardData } from "@/lib/client/product-types";

interface ProductCardProps {
  product: ProductCardData;
  /** Show "Featured" / "New" merchandising badges in the corner. */
  showMerchBadges?: boolean;
  /**
   * Render a wishlist heart toggle in the corner of the image. Defaults
   * to true so every grid surfaces save-for-later, but the homepage hero
   * carousel can opt out if the design needs a cleaner tile.
   */
  showWishlistButton?: boolean;
  className?: string;
}

/**
 * Renders a single product tile for grids on the homepage and the
 * /products listing.
 *
 * Layout:
 *   - Square-ish image with stock + merchandising overlays
 *   - Wishlist heart toggle in the bottom-right of the image
 *   - Category eyebrow (only when present)
 *   - Product name (truncated to two lines)
 *   - Rating row: filled star + "4.7 (128)"
 *   - Price (with optional strikethrough compare-at price)
 *
 * The whole card is one big click target into the PDP. To keep the
 * wishlist button keyboard- and a11y-clean we use the "stretched link"
 * pattern: an absolutely-positioned, full-card `<Link>` provides the
 * navigation target, and the wishlist `<button>` lives at a higher
 * stacking context so its click doesn't bubble to the link. (Nesting a
 * `<button>` inside an `<a>` is invalid HTML — the stretched-link split
 * lets the heart and the card link coexist legally.)
 */
export function ProductCard({
  product,
  showMerchBadges = true,
  showWishlistButton = true,
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
    <Card
      className={cn(
        "group relative flex h-full flex-col overflow-hidden transition-shadow hover:shadow-md focus-within:shadow-md",
        className,
      )}
    >
      {/* Stretched link sits above the card surface but below the
          wishlist button. The heart's higher stacking context (and its
          stopPropagation handler) keeps card-wide clicks routed through
          the link without intercepting the toggle. */}
      <Link
        href={`/products/${product.slug}`}
        className="absolute inset-0 z-10 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={`${product.name}, ${price}`}
      >
        <span className="sr-only">{product.name}</span>
      </Link>

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
          <div className="pointer-events-none absolute left-2 top-2 z-20 flex flex-wrap gap-1">
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
        <div className="pointer-events-none absolute right-2 top-2 z-20">
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

        {showWishlistButton && (
          <div className="absolute bottom-2 right-2 z-20">
            <WishlistButton
              variant="card"
              productId={product.id}
              productName={product.name}
              productSlug={product.slug}
            />
          </div>
        )}
      </div>

      <CardContent className="relative flex flex-1 flex-col gap-2 p-4">
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
  );
}
