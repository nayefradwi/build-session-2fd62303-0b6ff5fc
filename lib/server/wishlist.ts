/**
 * Server-side helpers for the wishlist.
 *
 * The wishlist UI surfaces a "saved for later" list per user. The core
 * data model is a single join row `(user_id, product_id)` with a unique
 * constraint on the pair (defined in `lib/db/schema.ts`). These helpers
 * centralise the queries that load wishlist rows together with the
 * product summary the route layer returns over the wire.
 */
import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  categories,
  productImages,
  products,
  wishlistItems,
  type Category,
  type Product,
  type WishlistItem,
} from "@/lib/db/schema";

/**
 * Public-facing summary of a wishlisted product.
 *
 * Intentionally narrower than the full product detail payload — the
 * wishlist UI only needs enough to render a card, deep-link to the PDP,
 * and surface stock status / price / sale status.
 */
export interface WishlistProductSummary {
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
  /**
   * Coarse-grained stock label so the UI can render a badge without
   * re-deriving a threshold. Mirrors how the product detail API talks
   * about stock.
   */
  stockStatus: "in_stock" | "low_stock" | "out_of_stock";
  isFeatured: boolean;
  isNew: boolean;
  primaryImageUrl: string | null;
}

/**
 * A wishlist row plus the embedded product summary the UI renders.
 */
export interface WishlistEntry {
  id: string;
  productId: string;
  addedAt: string;
  product: WishlistProductSummary | null;
}

/**
 * Threshold below which we expose the "low_stock" status. Kept in step
 * with the merchandising UI's "Only N left" call-out.
 */
export const LOW_STOCK_THRESHOLD = 5;

function deriveStockStatus(stock: number): WishlistProductSummary["stockStatus"] {
  if (stock <= 0) return "out_of_stock";
  if (stock <= LOW_STOCK_THRESHOLD) return "low_stock";
  return "in_stock";
}

interface ProductRow {
  product: Product;
  category: Category | null;
}

/**
 * Bulk-load the lowest-position image url for each product id.
 * Mirrors the helper in `lib/server/products.ts` so the wishlist API
 * has the same N-free path for thumbnails.
 */
async function fetchPrimaryImages(
  productIds: string[],
): Promise<Map<string, string>> {
  if (productIds.length === 0) return new Map();
  const rows = await db
    .select({
      productId: productImages.productId,
      url: productImages.url,
      position: productImages.position,
    })
    .from(productImages)
    .where(inArray(productImages.productId, productIds));

  const best = new Map<string, { url: string; position: number }>();
  for (const row of rows) {
    const current = best.get(row.productId);
    if (!current || row.position < current.position) {
      best.set(row.productId, { url: row.url, position: row.position });
    }
  }
  const out = new Map<string, string>();
  for (const [pid, info] of best) out.set(pid, info.url);
  return out;
}

function toSummary(
  row: ProductRow,
  primaryImageUrl: string | null,
): WishlistProductSummary {
  const { product: p, category } = row;
  return {
    id: p.id,
    slug: p.slug,
    sku: p.sku,
    name: p.name,
    category: category
      ? { id: category.id, slug: category.slug, name: category.name }
      : null,
    priceCents: p.priceCents,
    compareAtPriceCents: p.compareAtPriceCents ?? null,
    currency: p.currency,
    size: p.size ?? null,
    material: p.material ?? null,
    color: p.color ?? null,
    stock: p.stock,
    inStock: p.stock > 0,
    stockStatus: deriveStockStatus(p.stock),
    isFeatured: p.isFeatured,
    isNew: p.isNew,
    primaryImageUrl,
  };
}

/**
 * Return every wishlist entry for a user, newest first, with the
 * embedded product summary. If a wishlist row references a product
 * that no longer exists (the product foreign key is `ON DELETE
 * CASCADE`, so this is a defensive fallback only), the row is
 * filtered out instead of returned with a null product.
 */
export async function listWishlistForUser(
  userId: string,
): Promise<WishlistEntry[]> {
  const rows = await db
    .select({
      item: wishlistItems,
      product: products,
      category: categories,
    })
    .from(wishlistItems)
    .innerJoin(products, eq(products.id, wishlistItems.productId))
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(eq(wishlistItems.userId, userId))
    .orderBy(desc(wishlistItems.createdAt), desc(wishlistItems.id));

  if (rows.length === 0) return [];

  const productIds = rows.map((r) => r.product.id);
  const primaryImages = await fetchPrimaryImages(productIds);

  return rows.map((r) => ({
    id: r.item.id,
    productId: r.product.id,
    addedAt: r.item.createdAt.toISOString(),
    product: toSummary(
      { product: r.product, category: r.category },
      primaryImages.get(r.product.id) ?? null,
    ),
  }));
}

/** Look up a single wishlist row for a (user, product) pair. */
export async function findWishlistEntry(
  userId: string,
  productId: string,
): Promise<WishlistItem | null> {
  const rows = await db
    .select()
    .from(wishlistItems)
    .where(
      and(
        eq(wishlistItems.userId, userId),
        eq(wishlistItems.productId, productId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Verify a product exists. Used by the POST handler before insert. */
export async function productExists(productId: string): Promise<boolean> {
  const rows = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  return rows.length > 0;
}

/**
 * Insert a wishlist row, returning the new entry shape (with embedded
 * product summary) so callers don't need a follow-up GET.
 */
export async function addWishlistItem(
  userId: string,
  productId: string,
): Promise<WishlistEntry | null> {
  const inserted = await db
    .insert(wishlistItems)
    .values({ userId, productId })
    .returning();

  const row = inserted[0];
  if (!row) return null;

  const productRows = await db
    .select({ product: products, category: categories })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(eq(products.id, productId))
    .limit(1);
  const productRow = productRows[0];

  if (!productRow) {
    return {
      id: row.id,
      productId,
      addedAt: row.createdAt.toISOString(),
      product: null,
    };
  }

  const primaryImages = await fetchPrimaryImages([productId]);

  return {
    id: row.id,
    productId,
    addedAt: row.createdAt.toISOString(),
    product: toSummary(
      { product: productRow.product, category: productRow.category },
      primaryImages.get(productId) ?? null,
    ),
  };
}

/**
 * Remove a wishlist row for a (user, product) pair. Returns true if a
 * row was actually deleted; false if no matching row existed.
 */
export async function removeWishlistItem(
  userId: string,
  productId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(wishlistItems)
    .where(
      and(
        eq(wishlistItems.userId, userId),
        eq(wishlistItems.productId, productId),
      ),
    )
    .returning({ id: wishlistItems.id });
  return deleted.length > 0;
}
