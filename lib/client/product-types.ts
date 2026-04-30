/**
 * Client-safe view types for catalog data.
 *
 * The backend's `lib/server/products` module exports the canonical
 * `PublicProduct` shape, but importing it from a client component
 * would drag server-only imports (Drizzle, Neon driver) into the
 * browser bundle. The shape declared here is structurally compatible
 * — server pages can pass `PublicProduct` rows straight through and
 * client components stay free of server-only deps.
 */

export interface ProductCategoryView {
  id: string;
  slug: string;
  name: string;
}

export interface ProductRatingView {
  average: number;
  count: number;
}

export interface ProductCardData {
  id: string;
  slug: string;
  name: string;
  description?: string;
  category: ProductCategoryView | null;
  priceCents: number;
  compareAtPriceCents: number | null;
  currency: string;
  stock: number;
  inStock: boolean;
  isFeatured: boolean;
  isNew: boolean;
  rating: ProductRatingView;
  primaryImageUrl: string | null;
}
