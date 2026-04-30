/**
 * Client-safe view types for the cart surfaces.
 *
 * The server-side helpers in `lib/server/cart` declare the canonical
 * shape, but importing from there into a client component would drag
 * Drizzle and the Neon driver into the browser bundle. The shapes
 * declared here are structurally compatible with the server types — JSON
 * responses from /api/cart can be parsed straight into these.
 */

export type CartStockStatus = "in_stock" | "low_stock" | "out_of_stock";

/**
 * Slim product summary embedded in every cart row. Mirrors
 * `CartProductSummary` from `lib/server/cart`.
 */
export interface CartProductView {
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
  stockStatus: CartStockStatus;
  primaryImageUrl: string | null;
}

/** One serialised cart line. Mirrors `CartLine` from `lib/server/cart`. */
export interface CartLineView {
  id: string;
  productId: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  currency: string;
  addedAt: string;
  updatedAt: string;
  product: CartProductView | null;
}

/** Aggregated cart numbers. Mirrors `CartSummary` from `lib/server/cart`. */
export interface CartSummaryView {
  itemCount: number;
  subtotalCents: number;
  shippingCents: number;
  discountCents: number;
  totalCents: number;
  currency: string;
}

/** Body shape returned by GET /api/cart. */
export interface CartViewResponse {
  items: CartLineView[];
  summary: CartSummaryView;
}

/**
 * Normalised discount payload returned by
 * POST /api/discount-codes/validate. Mirrors `NormalizedDiscount` from
 * `lib/server/discount-codes`.
 */
export interface NormalizedDiscountView {
  id: string;
  code: string;
  type: "percentage" | "fixed";
  value: number;
  minOrderValue: number | null;
  expiresAt: string | null;
  description: string | null;
  amountCents: number;
  subtotalCents: number;
  subtotalAfterDiscountCents: number;
  currency: string;
}
