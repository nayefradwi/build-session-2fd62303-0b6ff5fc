import { cn } from "@/lib/client/utils";
import { ProductCard } from "@/components/products/product-card";
import type { ProductCardData } from "@/lib/client/product-types";

interface ProductGridProps {
  products: ReadonlyArray<ProductCardData>;
  /**
   * When the grid is empty we render this message instead of a blank
   * slot so listings (especially with active filters) still feel
   * responsive.
   */
  emptyMessage?: string;
  showMerchBadges?: boolean;
  className?: string;
}

/**
 * Mobile-first responsive grid of product cards.
 *
 * Breakpoints (Tailwind defaults):
 *   - default: 2 columns (works on phones from ~360px upward)
 *   - sm    (≥640px): 2 columns, more breathing room
 *   - md    (≥768px): 3 columns
 *   - lg    (≥1024px): 4 columns
 */
export function ProductGrid({
  products,
  emptyMessage = "No products found.",
  showMerchBadges = true,
  className,
}: ProductGridProps) {
  if (products.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-4 sm:gap-5 md:grid-cols-3 lg:grid-cols-4",
        className,
      )}
    >
      {products.map((product) => (
        <ProductCard
          key={product.id}
          product={product}
          showMerchBadges={showMerchBadges}
        />
      ))}
    </div>
  );
}
