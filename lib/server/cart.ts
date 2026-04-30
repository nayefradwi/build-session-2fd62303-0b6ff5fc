/**
 * Server-side helpers for the shopping cart.
 *
 * The cart is modelled as one row per (user, product) pair plus a
 * positive `quantity`. The unique index on `(user_id, product_id)` is
 * enforced at the schema level; these helpers add the application-level
 * invariants the API contract calls for:
 *
 *   - quantity must be a positive integer
 *   - quantity must never exceed the live `products.stock`
 *   - adding a product whose stock is 0 is rejected up front (instead of
 *     letting the stock check return an opaque error)
 *
 * The helpers return ready-to-serialise shapes — the route layer simply
 * forwards the result. This keeps the route handlers thin and makes the
 * stock / quantity rules easy to unit test.
 */
import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  cartItems,
  categories,
  productImages,
  products,
  type CartItem,
  type Category,
  type Product,
} from "@/lib/db/schema";

/**
 * Hard cap on a single line's quantity, applied in addition to the
 * per-product stock cap. Stops a malicious or buggy client from sending
 * huge integers that would still pass the stock check on a deeply
 * stocked SKU.
 */
export const MAX_QUANTITY_PER_LINE = 99;

/**
 * Threshold below which we expose the "low_stock" status. Mirrors the
 * value in `lib/server/wishlist.ts` so the UI sees consistent badges
 * across cart and wishlist surfaces.
 */
export const LOW_STOCK_THRESHOLD = 5;

export type StockStatus = "in_stock" | "low_stock" | "out_of_stock";

export function deriveStockStatus(stock: number): StockStatus {
  if (stock <= 0) return "out_of_stock";
  if (stock <= LOW_STOCK_THRESHOLD) return "low_stock";
  return "in_stock";
}

/**
 * Compact product summary embedded in each cart line. Narrow on purpose
 * — the cart UI renders a thumbnail row, the price, and a stock callout;
 * everything else lives on the PDP.
 */
export interface CartProductSummary {
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
  stockStatus: StockStatus;
  primaryImageUrl: string | null;
}

/**
 * One serialised cart row. `unitPriceCents` snapshots the product price
 * at read time so the response is self-contained; `lineTotalCents` is
 * `unitPriceCents * quantity` (the schema doesn't store a snapshot
 * price — quantity adjustments always re-derive against the current
 * `products.priceCents`).
 */
export interface CartLine {
  id: string;
  productId: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  currency: string;
  addedAt: string;
  updatedAt: string;
  product: CartProductSummary | null;
}

/**
 * Aggregated cart numbers. Shipping and discount are placeholders for
 * now (always 0) so the UI can lay out the totals row even though the
 * checkout pricing engine is not yet wired up. The keys are stable so
 * future tasks can populate them without a response-shape change.
 */
export interface CartSummary {
  itemCount: number;
  /** Sum of `lineTotalCents` across every line. */
  subtotalCents: number;
  /** Placeholder — wired up by the checkout/shipping task. */
  shippingCents: number;
  /** Placeholder — wired up by the promo/coupon task. */
  discountCents: number;
  /** subtotal + shipping - discount (clamped to >= 0). */
  totalCents: number;
  /** Currency of every line. Cart is single-currency by construction. */
  currency: string;
}

export interface CartView {
  items: CartLine[];
  summary: CartSummary;
}

interface ProductRow {
  product: Product;
  category: Category | null;
}

/**
 * Bulk-load the lowest-position image url for each product id. Mirrors
 * the helper used by the wishlist and product list APIs so cart reads
 * stay N-free on thumbnails.
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

function toProductSummary(
  row: ProductRow,
  primaryImageUrl: string | null,
): CartProductSummary {
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
    primaryImageUrl,
  };
}

interface CartLineRow {
  item: CartItem;
  product: Product | null;
  category: Category | null;
}

function toCartLine(
  row: CartLineRow,
  primaryImageUrl: string | null,
): CartLine {
  const product = row.product;
  const unitPriceCents = product?.priceCents ?? 0;
  const currency = product?.currency ?? "USD";
  return {
    id: row.item.id,
    productId: row.item.productId,
    quantity: row.item.quantity,
    unitPriceCents,
    lineTotalCents: unitPriceCents * row.item.quantity,
    currency,
    addedAt: row.item.createdAt.toISOString(),
    updatedAt: row.item.updatedAt.toISOString(),
    product:
      product
        ? toProductSummary(
            { product, category: row.category },
            primaryImageUrl,
          )
        : null,
  };
}

/**
 * Build the totals block from a list of (already-priced) cart lines.
 * Lines whose product has been deleted contribute zero to the subtotal.
 * Currency is taken from the first line that has a product attached and
 * defaults to USD when the cart is empty — the response surfaces the
 * value either way so the client never has to special-case the empty cart.
 */
function buildSummary(items: CartLine[]): CartSummary {
  let subtotalCents = 0;
  let itemCount = 0;
  let currency = "USD";
  for (const line of items) {
    subtotalCents += line.lineTotalCents;
    itemCount += line.quantity;
    if (line.product) currency = line.currency;
  }
  const shippingCents = 0;
  const discountCents = 0;
  const totalCents = Math.max(0, subtotalCents + shippingCents - discountCents);
  return {
    itemCount,
    subtotalCents,
    shippingCents,
    discountCents,
    totalCents,
    currency,
  };
}

/**
 * Load every cart row for a user, joined to the live product + category
 * + thumbnail. Items are returned newest-first (matching the wishlist
 * API's convention) so the UI can render them in a stable order.
 */
export async function getCartView(userId: string): Promise<CartView> {
  const rows = await db
    .select({
      item: cartItems,
      product: products,
      category: categories,
    })
    .from(cartItems)
    .leftJoin(products, eq(products.id, cartItems.productId))
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(eq(cartItems.userId, userId))
    .orderBy(desc(cartItems.updatedAt), desc(cartItems.id));

  if (rows.length === 0) {
    return { items: [], summary: buildSummary([]) };
  }

  const productIds = rows
    .map((r) => r.product?.id)
    .filter((id): id is string => Boolean(id));
  const primaryImages = await fetchPrimaryImages(productIds);

  const items: CartLine[] = rows.map((r) =>
    toCartLine(
      r as CartLineRow,
      r.product ? primaryImages.get(r.product.id) ?? null : null,
    ),
  );

  return { items, summary: buildSummary(items) };
}

/**
 * Look up a single product by id, returning the bare row (not wrapped).
 * Used by the add/update flows to validate stock before mutating.
 */
export async function getProductForCart(
  productId: string,
): Promise<Product | null> {
  const rows = await db
    .select()
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  return rows[0] ?? null;
}

/** Find an existing cart row for a (user, product) pair. */
export async function findCartItemByProduct(
  userId: string,
  productId: string,
): Promise<CartItem | null> {
  const rows = await db
    .select()
    .from(cartItems)
    .where(
      and(eq(cartItems.userId, userId), eq(cartItems.productId, productId)),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Look up a cart row by id, scoped to the supplied user. */
export async function findCartItemById(
  userId: string,
  itemId: string,
): Promise<CartItem | null> {
  const rows = await db
    .select()
    .from(cartItems)
    .where(and(eq(cartItems.userId, userId), eq(cartItems.id, itemId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Sentinel returned by the mutation helpers when they cannot proceed.
 * Routes translate the `code` into an HTTP status. Keeping the
 * vocabulary small and explicit makes the error contract easy to mirror
 * on the client.
 */
export type CartMutationError =
  | { code: "product_not_found" }
  | { code: "out_of_stock"; available: number }
  | {
      code: "exceeds_stock";
      available: number;
      requested: number;
    }
  | {
      code: "exceeds_max_quantity";
      max: number;
      requested: number;
    }
  | { code: "invalid_quantity" };

export type CartMutationResult =
  | { ok: true; itemId: string; created: boolean }
  | { ok: false; error: CartMutationError };

export interface AddToCartInput {
  userId: string;
  productId: string;
  quantity: number;
  /**
   * "increment" (default) → if a row already exists, add the supplied
   * quantity to the existing quantity. This matches the typical "add to
   * cart" UX where pressing the button twice piles up two units.
   *
   * "set" → overwrite the existing quantity (or create a row at the
   * supplied quantity). Useful when the client wants explicit control
   * (e.g. a quantity stepper that posts the absolute value).
   */
  mode?: "increment" | "set";
}

/**
 * Validate and apply the quantity ceiling against the live product
 * stock + the global per-line cap. Returns the clamped/checked quantity
 * or a typed error.
 */
function checkQuantityAgainstStock(
  product: Product,
  desiredQuantity: number,
): { ok: true; quantity: number } | { ok: false; error: CartMutationError } {
  if (
    !Number.isFinite(desiredQuantity) ||
    !Number.isInteger(desiredQuantity) ||
    desiredQuantity <= 0
  ) {
    return { ok: false, error: { code: "invalid_quantity" } };
  }
  if (product.stock <= 0) {
    return {
      ok: false,
      error: { code: "out_of_stock", available: product.stock },
    };
  }
  if (desiredQuantity > product.stock) {
    return {
      ok: false,
      error: {
        code: "exceeds_stock",
        available: product.stock,
        requested: desiredQuantity,
      },
    };
  }
  if (desiredQuantity > MAX_QUANTITY_PER_LINE) {
    return {
      ok: false,
      error: {
        code: "exceeds_max_quantity",
        max: MAX_QUANTITY_PER_LINE,
        requested: desiredQuantity,
      },
    };
  }
  return { ok: true, quantity: desiredQuantity };
}

/**
 * Add or update the cart line for a (user, product) pair. Honours the
 * stock and per-line ceilings, and either increments an existing line
 * or sets it outright depending on `mode`.
 *
 * Returns the cart item id of the affected row plus a `created` flag
 * indicating whether the row was inserted vs updated. Routes use the
 * flag to map the response to 201 vs 200.
 */
export async function addOrUpdateCartItem(
  input: AddToCartInput,
): Promise<CartMutationResult> {
  const { userId, productId, quantity } = input;
  const mode = input.mode ?? "increment";

  if (
    !Number.isFinite(quantity) ||
    !Number.isInteger(quantity) ||
    quantity <= 0
  ) {
    return { ok: false, error: { code: "invalid_quantity" } };
  }

  const product = await getProductForCart(productId);
  if (!product) {
    return { ok: false, error: { code: "product_not_found" } };
  }

  const existing = await findCartItemByProduct(userId, productId);
  const desired =
    mode === "set" || !existing ? quantity : existing.quantity + quantity;

  const checked = checkQuantityAgainstStock(product, desired);
  if (!checked.ok) return checked;

  if (existing) {
    const updated = await db
      .update(cartItems)
      .set({ quantity: checked.quantity, updatedAt: new Date() })
      .where(eq(cartItems.id, existing.id))
      .returning({ id: cartItems.id });
    const row = updated[0];
    if (!row) {
      return { ok: false, error: { code: "product_not_found" } };
    }
    return { ok: true, itemId: row.id, created: false };
  }

  // No existing row — insert. The unique index will catch a concurrent
  // duplicate insert; we surface that to the route as a benign retry.
  try {
    const inserted = await db
      .insert(cartItems)
      .values({
        userId,
        productId,
        quantity: checked.quantity,
      })
      .returning({ id: cartItems.id });
    const row = inserted[0];
    if (!row) {
      return { ok: false, error: { code: "product_not_found" } };
    }
    return { ok: true, itemId: row.id, created: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/duplicate|unique/i.test(message)) {
      // A concurrent insert beat us to it. Retry by updating the row that
      // now exists, treating the original call as either an increment or
      // a set as the caller intended.
      const concurrent = await findCartItemByProduct(userId, productId);
      if (!concurrent) {
        return { ok: false, error: { code: "product_not_found" } };
      }
      const retryDesired =
        mode === "set" ? quantity : concurrent.quantity + quantity;
      const retryChecked = checkQuantityAgainstStock(product, retryDesired);
      if (!retryChecked.ok) return retryChecked;
      const updated = await db
        .update(cartItems)
        .set({ quantity: retryChecked.quantity, updatedAt: new Date() })
        .where(eq(cartItems.id, concurrent.id))
        .returning({ id: cartItems.id });
      const row = updated[0];
      if (!row) {
        return { ok: false, error: { code: "product_not_found" } };
      }
      return { ok: true, itemId: row.id, created: false };
    }
    throw err;
  }
}

/**
 * Set an existing cart line's quantity to `quantity`. Used by
 * `PUT /api/cart/{itemId}`. Enforces the stock and per-line ceilings.
 *
 * If the row doesn't belong to the supplied user (or doesn't exist),
 * returns `product_not_found` so the route layer can map it to a 404
 * without leaking whether the id exists for a different user.
 */
export async function setCartItemQuantity(
  userId: string,
  itemId: string,
  quantity: number,
): Promise<CartMutationResult> {
  if (
    !Number.isFinite(quantity) ||
    !Number.isInteger(quantity) ||
    quantity <= 0
  ) {
    return { ok: false, error: { code: "invalid_quantity" } };
  }

  const existing = await findCartItemById(userId, itemId);
  if (!existing) {
    return { ok: false, error: { code: "product_not_found" } };
  }

  const product = await getProductForCart(existing.productId);
  if (!product) {
    return { ok: false, error: { code: "product_not_found" } };
  }

  const checked = checkQuantityAgainstStock(product, quantity);
  if (!checked.ok) return checked;

  const updated = await db
    .update(cartItems)
    .set({ quantity: checked.quantity, updatedAt: new Date() })
    .where(and(eq(cartItems.id, itemId), eq(cartItems.userId, userId)))
    .returning({ id: cartItems.id });
  const row = updated[0];
  if (!row) {
    return { ok: false, error: { code: "product_not_found" } };
  }
  return { ok: true, itemId: row.id, created: false };
}

/**
 * Remove a cart line by id, scoped to the owning user. Returns true if
 * a row was deleted, false otherwise.
 */
export async function removeCartItem(
  userId: string,
  itemId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(cartItems)
    .where(and(eq(cartItems.id, itemId), eq(cartItems.userId, userId)))
    .returning({ id: cartItems.id });
  return deleted.length > 0;
}

