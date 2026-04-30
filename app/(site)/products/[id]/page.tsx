import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, ShieldCheck, Star, Truck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ProductActions } from "@/components/products/product-actions";
import { ProductGallery } from "@/components/products/product-gallery";
import { RelatedProducts } from "@/components/products/related-products";
import { formatPrice, formatRating } from "@/lib/client/format";
import { getCurrentUser } from "@/lib/server/auth";
import { getProductByIdOrSlug } from "@/lib/server/products";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Generate <head> metadata using the product's name and description so
 * social previews and the browser tab show real content. Fall back to a
 * generic label if the product can't be loaded — the page itself will
 * 404 in that case.
 */
export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  try {
    const product = await getProductByIdOrSlug(id);
    if (!product) {
      return { title: "Product not found" };
    }
    return {
      title: product.name,
      description:
        product.description?.slice(0, 200) ??
        `Shop ${product.name} from our curated catalog.`,
    };
  } catch {
    return { title: "Product" };
  }
}

/**
 * /products/[id] — Product Detail Page.
 *
 * The route accepts either the product UUID or the slug; the shared
 * `getProductByIdOrSlug` helper figures out which it is. The same helper
 * also returns the related-products roster so we get one DB round trip
 * and the listing API stays consistent.
 *
 * Sections (top → bottom):
 *   - Breadcrumb (Home / All products / Category / Product)
 *   - Image gallery with merchandising badges
 *   - Title block: category eyebrow, name, rating + review count, price,
 *     compare-at price (when discounted), stock status
 *   - Action row: quantity stepper, Add to Cart, Add to Wishlist
 *     (auth-gated for guests via SignInPromptDialog inside the actions)
 *   - Attribute list: SKU, size, material, color, category
 *   - Description body
 *   - Related products carousel
 */
export default async function ProductDetailPage({ params }: PageProps) {
  const { id } = await params;

  const [product, user] = await Promise.all([
    getProductByIdOrSlug(id).catch((err) => {
      console.error(`[pdp] failed to load product ${id}`, err);
      return null;
    }),
    getCurrentUser().catch(() => null),
  ]);

  if (!product) {
    notFound();
  }

  const price = formatPrice(product.priceCents, product.currency);
  const compareAt =
    product.compareAtPriceCents != null &&
    product.compareAtPriceCents > product.priceCents
      ? formatPrice(product.compareAtPriceCents, product.currency)
      : null;
  const discountPct =
    product.compareAtPriceCents != null &&
    product.compareAtPriceCents > product.priceCents
      ? Math.round(
          ((product.compareAtPriceCents - product.priceCents) /
            product.compareAtPriceCents) *
            100,
        )
      : null;

  const stockBadge = !product.inStock ? (
    <Badge variant="destructive" className="shadow-sm">
      Out of stock
    </Badge>
  ) : product.stock <= 5 ? (
    <Badge variant="warning" className="shadow-sm">
      Low stock
    </Badge>
  ) : (
    <Badge variant="success" className="shadow-sm">
      In stock
    </Badge>
  );

  const merchBadges = (
    <>
      {product.isNew && (
        <Badge variant="default" className="shadow-sm">
          New
        </Badge>
      )}
      {product.isFeatured && (
        <Badge variant="secondary" className="shadow-sm">
          Featured
        </Badge>
      )}
      {discountPct && discountPct > 0 ? (
        <Badge variant="destructive" className="shadow-sm">
          -{discountPct}%
        </Badge>
      ) : null}
    </>
  );

  const attributes: Array<{ label: string; value: string }> = [
    { label: "SKU", value: product.sku },
  ];
  if (product.size) attributes.push({ label: "Size", value: product.size });
  if (product.material)
    attributes.push({ label: "Material", value: product.material });
  if (product.color) attributes.push({ label: "Color", value: product.color });
  if (product.category)
    attributes.push({ label: "Category", value: product.category.name });

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:py-10">
      {/* Breadcrumb. */}
      <nav
        aria-label="Breadcrumb"
        className="mb-6 flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
      >
        <Link href="/" className="hover:text-foreground">
          Home
        </Link>
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
        <Link href="/products" className="hover:text-foreground">
          Products
        </Link>
        {product.category && (
          <>
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
            <Link
              href={`/products?category=${encodeURIComponent(product.category.slug)}`}
              className="hover:text-foreground"
            >
              {product.category.name}
            </Link>
          </>
        )}
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
        <span className="line-clamp-1 text-foreground">{product.name}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
        <ProductGallery
          images={product.images}
          productName={product.name}
          topLeftBadges={merchBadges}
          topRightBadges={stockBadge}
        />

        <div className="space-y-6">
          <div className="space-y-3">
            {product.category && (
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {product.category.name}
              </p>
            )}
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {product.name}
            </h1>

            <div
              className="flex items-center gap-2 text-sm text-muted-foreground"
              aria-label={`Rated ${formatRating(product.rating.average)} out of 5 from ${product.rating.count} review${product.rating.count === 1 ? "" : "s"}`}
            >
              <span className="inline-flex items-center gap-1">
                <Star
                  className="h-4 w-4 fill-amber-400 text-amber-400"
                  aria-hidden="true"
                />
                <span className="font-semibold text-foreground">
                  {formatRating(product.rating.average)}
                </span>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {product.rating.count.toLocaleString()}{" "}
                {product.rating.count === 1 ? "review" : "reviews"}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-baseline gap-3">
            <span className="text-3xl font-semibold tracking-tight">
              {price}
            </span>
            {compareAt && (
              <span className="text-base text-muted-foreground line-through">
                {compareAt}
              </span>
            )}
            {discountPct ? (
              <Badge variant="destructive">Save {discountPct}%</Badge>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {stockBadge}
            {product.inStock && (
              <span className="text-xs text-muted-foreground">
                {product.stock} available
              </span>
            )}
          </div>

          <ProductActions
            productId={product.id}
            productName={product.name}
            productSlug={product.slug}
            stock={product.stock}
            isAuthenticated={Boolean(user)}
          />

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border bg-muted/40 p-4 text-sm">
            {attributes.map((attr) => (
              <div
                key={attr.label}
                className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
              >
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  {attr.label}
                </dt>
                <dd className="font-medium text-foreground">{attr.value}</dd>
              </div>
            ))}
          </dl>

          <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div className="flex items-start gap-2 rounded-md border p-3">
              <Truck className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div>
                <p className="font-medium">Free shipping</p>
                <p className="text-xs text-muted-foreground">
                  On orders over $75. Calculated at checkout.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-md border p-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div>
                <p className="font-medium">30-day returns</p>
                <p className="text-xs text-muted-foreground">
                  Hassle-free returns within 30 days of delivery.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {product.description && product.description.trim().length > 0 && (
        <section className="mt-12 max-w-3xl space-y-3">
          <h2 className="text-xl font-semibold tracking-tight">
            About this product
          </h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
            {product.description}
          </p>
        </section>
      )}

      {product.related.length > 0 && (
        <div className="mt-16">
          <RelatedProducts products={product.related} />
        </div>
      )}
    </main>
  );
}
