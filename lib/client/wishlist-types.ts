/**
 * Client-safe view types for the wishlist surfaces.
 *
 * The server-side helpers in `lib/server/wishlist` declare the canonical
 * shape, but importing from there into a client component would drag
 * Drizzle and the Neon driver into the browser bundle. The shapes
 * declared here are structurally compatible with the server types — the
 * route layer's JSON responses can be parsed straight into these.
 */

export type WishlistStockStatus = "in_stock" | "low_stock" | "out_of_stock";

/**
 * Slim product summary embedded in every wishlist row. Mirrors
 * `WishlistProductSummary` from `lib/server/wishlist`.
 */
export interface WishlistProductView {
  id: string;
  slug: string;
  sku: string;
  name: string;
  category: { id: string; slug: string; name: string } | null;
  priceCents: number;
  compareAtPriceCents: number | null;
  currency: string;
  size: string | null;
  material: string | null;
  color: string | null;
  stock: number;
  inStock: boolean;
  stockStatus: WishlistStockStatus;
  isFeatured: boolean;
  isNew: boolean;
  primaryImageUrl: string | null;
}

/**
 * One row in the user's wishlist as returned by GET /api/wishlist. The
 * embedded `product` is null only in the rare case where the FK was
 * cascaded away between read and render — the server-side helper filters
 * those out, but we keep the type honest.
 */
export interface WishlistEntryView {
  id: string;
  productId: string;
  addedAt: string;
  product: WishlistProductView | null;
}

/** Body shape returned by GET /api/wishlist. */
export interface WishlistListResponse {
  items: WishlistEntryView[];
  total: number;
}
