/**
 * Server-side helpers for order creation.
 *
 * The checkout commit (`POST /api/orders`) is the most consequential
 * write in the app: it inserts an order, snapshots line items,
 * decrements inventory, bumps a redeemed promo's usage count, and clears
 * the user's cart — all of which must happen atomically. A partial
 * commit would leak items, double-charge stock, or worse.
 *
 * The Neon HTTP driver does not expose interactive transactions (the
 * drizzle wrapper throws), but the underlying `neon()` SQL tag exposes a
 * non-interactive batched transaction with first-class isolation level
 * support. We pre-compute every value the transaction needs (cart load,
 * address resolve, discount re-validation, price/total recomputation)
 * and then submit the writes as a single SERIALIZABLE batch.
 *
 * Race-free inventory enforcement is achieved by:
 *   1. A `CHECK ("stock" >= 0)` constraint on `products` (added in
 *      migration `0007_orders.sql`). A serializable transaction that
 *      tries to drive any line below zero aborts with a constraint
 *      violation, which we surface as a 409 to the client.
 *   2. The same approach for `discount_codes.usage_count <= usage_limit`
 *      (when `usage_limit` is set) prevents over-redemption races.
 *
 * The route layer should treat any thrown error returned from
 * `createOrderFromCart` as a 500; typed mutation errors (cart empty,
 * stock conflict, address not owned, …) are returned as `{ ok: false }`.
 */
import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { db, neonSql } from "@/lib/db";
import {
  ORDER_STATUSES,
  addresses,
  discountCodes,
  orderItems,
  orders,
  productImages,
  products,
  type Address,
  type Order,
  type OrderItem,
  type OrderStatus,
  type Product,
} from "@/lib/db/schema";
import {
  computeDiscountAmountCents,
  normalizeCode,
  type DiscountType,
} from "@/lib/server/discount-codes";
import { getCartView, type CartView } from "@/lib/server/cart";

/**
 * Flat shipping fee (in cents). Applied unconditionally for now; future
 * tasks can layer free-shipping thresholds or address-based rates on top
 * without changing the response shape.
 */
export const FLAT_SHIPPING_CENTS = 599;

/**
 * Free-shipping threshold (subtotal in cents AFTER discount). Setting
 * this to a non-zero value waives the flat fee for high-value carts; we
 * default to a generous threshold so most carts still pay shipping.
 */
export const FREE_SHIPPING_THRESHOLD_CENTS = 10_000; // $100.00

/**
 * Describes a brand new address payload sent inline with the order. The
 * shape is the subset of `addresses` columns the checkout flow needs;
 * `addresses` schema validation lives in `lib/server/addresses.ts` (which
 * the route uses to parse the request body) — this interface is the
 * pre-validated input the helper expects.
 */
export interface NewAddressInput {
  label?: string | null;
  recipient?: string | null;
  phone?: string | null;
  line1: string;
  line2?: string | null;
  city: string;
  state?: string | null;
  postalCode: string;
  country: string;
  /** When true, persist the address with `is_default = true`. */
  isDefault?: boolean;
}

export interface CreateOrderInput {
  userId: string;
  /** Existing `addresses.id` belonging to the user. Mutually exclusive with `address`. */
  addressId?: string;
  /** New address payload. The helper persists the row before the order tx runs. */
  address?: NewAddressInput;
  /** Optional discount code typed by the shopper. Re-validated server-side. */
  discountCode?: string | null;
  /** Optional free-form notes the shopper attached at checkout. */
  notes?: string | null;
}

export type CreateOrderError =
  | { code: "cart_empty" }
  | { code: "address_required" }
  | { code: "address_conflict" }
  | { code: "address_not_found" }
  | { code: "address_invalid" }
  | {
      code: "stock_conflict";
      productId: string;
      sku: string;
      requested: number;
      available: number;
    }
  | { code: "product_unavailable"; productId: string }
  | { code: "discount_invalid"; reason: string }
  | { code: "internal_error"; message: string };

export type CreateOrderResult =
  | { ok: true; data: PublicOrderSummary }
  | { ok: false; error: CreateOrderError };

/**
 * Order line item as returned to clients. Snapshotted from `order_items`
 * — never re-derived from the live `products` table so deletions/edits
 * after the fact do not rewrite history.
 */
export interface PublicOrderItem {
  id: string;
  productId: string | null;
  sku: string;
  name: string;
  size: string | null;
  material: string | null;
  color: string | null;
  imageUrl: string | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  currency: string;
}

export interface PublicOrderShippingAddress {
  addressId: string | null;
  recipient: string | null;
  phone: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postalCode: string;
  country: string;
}

export interface PublicOrderSummary {
  id: string;
  status: string;
  itemCount: number;
  subtotalCents: number;
  shippingCents: number;
  discountCents: number;
  totalCents: number;
  currency: string;
  discountCode: string | null;
  shippingAddress: PublicOrderShippingAddress;
  items: PublicOrderItem[];
  createdAt: string;
  updatedAt: string;
}

/** Snapshot a Postgres CHECK violation message into the typed error vocab. */
function classifyConstraintError(message: string): {
  kind: "stock" | "discount_usage" | "other";
} {
  const m = message.toLowerCase();
  if (m.includes("products_stock_nonneg")) return { kind: "stock" };
  if (m.includes("discount_codes_usage_within_limit")) {
    return { kind: "discount_usage" };
  }
  return { kind: "other" };
}

/** Resolve (or insert) the shipping address row for this order. */
async function resolveShippingAddress(
  input: CreateOrderInput,
): Promise<
  | { ok: true; address: Address; created: boolean }
  | { ok: false; error: CreateOrderError }
> {
  if (input.addressId && input.address) {
    return { ok: false, error: { code: "address_conflict" } };
  }

  if (input.addressId) {
    const rows = await db
      .select()
      .from(addresses)
      .where(
        and(
          eq(addresses.id, input.addressId),
          eq(addresses.userId, input.userId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return { ok: false, error: { code: "address_not_found" } };
    return { ok: true, address: row, created: false };
  }

  if (input.address) {
    const a = input.address;
    if (!a.line1?.trim() || !a.city?.trim() || !a.postalCode?.trim()) {
      return { ok: false, error: { code: "address_invalid" } };
    }
    const country = a.country?.trim().toUpperCase();
    if (!country || !/^[A-Z]{2}$/.test(country)) {
      return { ok: false, error: { code: "address_invalid" } };
    }
    // If the caller asked to make this the default, demote any prior
    // default first so the partial unique index is never violated.
    if (a.isDefault) {
      await db
        .update(addresses)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(
            eq(addresses.userId, input.userId),
            eq(addresses.isDefault, true),
          ),
        );
    }
    const inserted = await db
      .insert(addresses)
      .values({
        userId: input.userId,
        label: a.label?.trim() || null,
        recipient: a.recipient?.trim() || null,
        phone: a.phone?.trim() || null,
        line1: a.line1.trim(),
        line2: a.line2?.trim() || null,
        city: a.city.trim(),
        state: a.state?.trim() || null,
        postalCode: a.postalCode.trim(),
        country,
        isDefault: a.isDefault ?? false,
      })
      .returning();
    const row = inserted[0];
    if (!row) {
      return {
        ok: false,
        error: { code: "internal_error", message: "Address insert returned no row" },
      };
    }
    return { ok: true, address: row, created: true };
  }

  return { ok: false, error: { code: "address_required" } };
}

/**
 * Cheap convenience: bulk-load primary thumbnail urls for a set of
 * product ids. Mirrors the cart helper, duplicated here to avoid a
 * cross-module import cycle.
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
    const cur = best.get(row.productId);
    if (!cur || row.position < cur.position) {
      best.set(row.productId, { url: row.url, position: row.position });
    }
  }
  const out = new Map<string, string>();
  for (const [pid, info] of best) out.set(pid, info.url);
  return out;
}

interface PreparedLine {
  productId: string;
  /**
   * Cart-side product summary kept only for fallback fields surfaced in
   * error responses (sku for the `stock_conflict` payload). Real
   * snapshotting reads the canonical row from `loadFullProductRows()`
   * before issuing the transaction.
   */
  productSku: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  imageUrl: string | null;
}

interface PreparedOrder {
  userId: string;
  cart: CartView;
  lines: PreparedLine[];
  subtotalCents: number;
  shippingCents: number;
  discountCents: number;
  totalCents: number;
  currency: string;
  discount: { id: string; code: string } | null;
  itemCount: number;
}

/**
 * Re-read the cart, validate every line is fulfillable from the live
 * product row (the cart helper already enforces this on add/update, but
 * a stale tab can still submit an out-of-stock cart), and recompute
 * pricing from the current `products.priceCents`. Returns either the
 * prepared totals + lines or a typed error.
 */
async function prepareOrder(
  userId: string,
  discountCodeRaw: string | null | undefined,
): Promise<
  { ok: true; data: PreparedOrder } | { ok: false; error: CreateOrderError }
> {
  const cart = await getCartView(userId);
  if (cart.items.length === 0) {
    return { ok: false, error: { code: "cart_empty" } };
  }

  const lines: PreparedLine[] = [];
  let subtotalCents = 0;
  let itemCount = 0;
  let currency = "USD";

  for (const line of cart.items) {
    if (!line.product) {
      // Product was deleted between cart-add and checkout.
      return {
        ok: false,
        error: { code: "product_unavailable", productId: line.productId },
      };
    }
    if (line.product.stock < line.quantity) {
      return {
        ok: false,
        error: {
          code: "stock_conflict",
          productId: line.product.id,
          sku: line.product.sku,
          requested: line.quantity,
          available: line.product.stock,
        },
      };
    }
    // Re-derive against the live product price so a stale cart UI can't
    // freeze the price between add-to-cart and checkout commit.
    const unit = line.product.priceCents;
    const lineTotal = unit * line.quantity;
    subtotalCents += lineTotal;
    itemCount += line.quantity;
    currency = line.product.currency;
    lines.push({
      productId: line.product.id,
      productSku: line.product.sku,
      quantity: line.quantity,
      unitPriceCents: unit,
      lineTotalCents: lineTotal,
      imageUrl: line.product.primaryImageUrl ?? null,
    });
  }

  // Re-validate the discount, if any. We re-load the row inside this
  // function (rather than calling validateDiscountCode) so we have the
  // raw row id + usage_limit to feed into the SERIALIZABLE bump.
  let discount: PreparedOrder["discount"] = null;
  let discountCents = 0;
  if (discountCodeRaw && discountCodeRaw.trim().length > 0) {
    const normalized = normalizeCode(discountCodeRaw);
    const dRows = await db
      .select()
      .from(discountCodes)
      .where(eq(discountCodes.code, normalized))
      .limit(1);
    const d = dRows[0];
    if (!d) {
      return {
        ok: false,
        error: { code: "discount_invalid", reason: "not_found" },
      };
    }
    if (!d.isActive) {
      return {
        ok: false,
        error: { code: "discount_invalid", reason: "inactive" },
      };
    }
    if (d.expiresAt && d.expiresAt.getTime() <= Date.now()) {
      return {
        ok: false,
        error: { code: "discount_invalid", reason: "expired" },
      };
    }
    if (d.usageLimit !== null && d.usageCount >= d.usageLimit) {
      return {
        ok: false,
        error: { code: "discount_invalid", reason: "exhausted" },
      };
    }
    if (
      d.minOrderValue !== null &&
      d.minOrderValue > 0 &&
      subtotalCents < d.minOrderValue
    ) {
      return {
        ok: false,
        error: { code: "discount_invalid", reason: "min_order_not_met" },
      };
    }
    discountCents = computeDiscountAmountCents(
      d.type as DiscountType,
      d.value,
      subtotalCents,
    );
    discount = { id: d.id, code: d.code };
  }

  const subtotalAfterDiscount = Math.max(0, subtotalCents - discountCents);
  const shippingCents =
    subtotalAfterDiscount >= FREE_SHIPPING_THRESHOLD_CENTS
      ? 0
      : FLAT_SHIPPING_CENTS;
  const totalCents = Math.max(0, subtotalAfterDiscount + shippingCents);

  return {
    ok: true,
    data: {
      userId,
      cart,
      lines,
      subtotalCents,
      shippingCents,
      discountCents,
      totalCents,
      currency,
      discount,
      itemCount,
    },
  };
}

/** Re-load the full product row for each line so we can snapshot every column. */
async function loadFullProductRows(
  productIds: string[],
): Promise<Map<string, Product>> {
  if (productIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(products)
    .where(inArray(products.id, productIds));
  const out = new Map<string, Product>();
  for (const row of rows) out.set(row.id, row);
  return out;
}

function toPublicSummary(
  order: Order,
  items: OrderItem[],
): PublicOrderSummary {
  return {
    id: order.id,
    status: order.status,
    itemCount: order.itemCount,
    subtotalCents: order.subtotalCents,
    shippingCents: order.shippingCents,
    discountCents: order.discountCents,
    totalCents: order.totalCents,
    currency: order.currency,
    discountCode: order.discountCode ?? null,
    shippingAddress: {
      addressId: order.shippingAddressId ?? null,
      recipient: order.shippingRecipient ?? null,
      phone: order.shippingPhone ?? null,
      line1: order.shippingLine1,
      line2: order.shippingLine2 ?? null,
      city: order.shippingCity,
      state: order.shippingState ?? null,
      postalCode: order.shippingPostalCode,
      country: order.shippingCountry,
    },
    items: items.map((it) => ({
      id: it.id,
      productId: it.productId ?? null,
      sku: it.sku,
      name: it.name,
      size: it.size ?? null,
      material: it.material ?? null,
      color: it.color ?? null,
      imageUrl: it.imageUrl ?? null,
      quantity: it.quantity,
      unitPriceCents: it.unitPriceCents,
      lineTotalCents: it.lineTotalCents,
      currency: it.currency,
    })),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

/**
 * The main entry point. Validates inputs, prepares totals, then issues
 * a single SERIALIZABLE batched transaction that:
 *
 *   1. Inserts the `orders` row (id pre-generated in JS so the order_items
 *      INSERTs in the same batch can reference it).
 *   2. Inserts every `order_items` row.
 *   3. Decrements `products.stock` for each line. The `products_stock_nonneg`
 *      CHECK constraint causes the entire transaction to abort with a
 *      `stock_conflict` if a concurrent order drained inventory beneath
 *      our requested quantity.
 *   4. Bumps `salesCount` for each line so popularity sort stays current.
 *   5. Increments `discount_codes.usage_count` (when a code applied);
 *      the `discount_codes_usage_within_limit` CHECK aborts if a
 *      concurrent redemption already exhausted the code.
 *   6. Clears the user's cart.
 *
 * On constraint-violation errors we map back to the typed
 * `CreateOrderError` vocabulary so the route layer returns a 409 with
 * actionable details.
 */
export async function createOrderFromCart(
  input: CreateOrderInput,
): Promise<CreateOrderResult> {
  // 1) Resolve / persist the shipping address.
  const addr = await resolveShippingAddress(input);
  if (!addr.ok) return addr;

  // 2) Prepare totals + line-level data.
  const prep = await prepareOrder(input.userId, input.discountCode ?? null);
  if (!prep.ok) return prep;
  const data = prep.data;

  // 3) Load full product rows (we need every column the order_items
  //    snapshot captures, including those the cart summary trims out).
  const fullProducts = await loadFullProductRows(
    data.lines.map((l) => l.productId),
  );

  // 4) Build deterministic ids so the batched transaction can reference
  //    them across multiple statements without a SELECT round-trip.
  const orderId = randomUUID();
  const itemRows = data.lines.map((line) => {
    const full = fullProducts.get(line.productId);
    if (!full) {
      // A product was deleted between prepareOrder() and now. The cart
      // helper already runs a stock check up-front, but the deleted-row
      // race window is fundamentally unbounded — bail out cleanly.
      throw new Error(
        `Product ${line.productId} disappeared between prepare and commit`,
      );
    }
    return {
      id: randomUUID(),
      productId: line.productId,
      sku: full.sku,
      name: full.name,
      size: full.size ?? null,
      material: full.material ?? null,
      color: full.color ?? null,
      imageUrl: line.imageUrl,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      lineTotalCents: line.lineTotalCents,
      currency: full.currency,
    };
  });

  const a = addr.address;

  // 5) Issue the batched, serializable transaction. Every write below
  //    runs inside the same Postgres transaction; a CHECK violation on
  //    any line rolls the whole thing back.
  try {
    await neonSql.transaction(
      (tx) => {
        const queries = [];

        // Insert the order header.
        queries.push(
          tx`INSERT INTO orders (
            id, user_id, status,
            shipping_address_id, shipping_recipient, shipping_phone,
            shipping_line1, shipping_line2, shipping_city, shipping_state,
            shipping_postal_code, shipping_country,
            subtotal_cents, shipping_cents, discount_cents, total_cents, currency,
            discount_code_id, discount_code,
            item_count, notes,
            created_at, updated_at
          ) VALUES (
            ${orderId}, ${input.userId}, ${"pending"},
            ${a.id}, ${a.recipient}, ${a.phone},
            ${a.line1}, ${a.line2}, ${a.city}, ${a.state},
            ${a.postalCode}, ${a.country},
            ${data.subtotalCents}, ${data.shippingCents}, ${data.discountCents}, ${data.totalCents}, ${data.currency},
            ${data.discount ? data.discount.id : null}, ${data.discount ? data.discount.code : null},
            ${data.itemCount}, ${input.notes ?? null},
            NOW(), NOW()
          )`,
        );

        // Insert each line item.
        for (const it of itemRows) {
          queries.push(
            tx`INSERT INTO order_items (
              id, order_id, product_id, sku, name, size, material, color,
              image_url, quantity, unit_price_cents, line_total_cents, currency,
              created_at
            ) VALUES (
              ${it.id}, ${orderId}, ${it.productId}, ${it.sku}, ${it.name},
              ${it.size}, ${it.material}, ${it.color}, ${it.imageUrl},
              ${it.quantity}, ${it.unitPriceCents}, ${it.lineTotalCents}, ${it.currency},
              NOW()
            )`,
          );
        }

        // Decrement inventory and bump sales for each line. The CHECK
        // constraint `products_stock_nonneg` prevents stock going below
        // zero — a concurrent decrement that races us aborts the tx.
        for (const it of itemRows) {
          queries.push(
            tx`UPDATE products
                SET stock = stock - ${it.quantity},
                    sales_count = sales_count + ${it.quantity},
                    updated_at = NOW()
              WHERE id = ${it.productId}`,
          );
        }

        // Bump the discount code's usage counter, if applicable. The
        // CHECK constraint `discount_codes_usage_within_limit` aborts
        // the tx if the increment would exceed `usage_limit`.
        if (data.discount) {
          queries.push(
            tx`UPDATE discount_codes
                SET usage_count = usage_count + 1,
                    updated_at = NOW()
              WHERE id = ${data.discount.id}`,
          );
        }

        // Clear the user's cart.
        queries.push(
          tx`DELETE FROM cart_items WHERE user_id = ${input.userId}`,
        );

        return queries;
      },
      { isolationLevel: "Serializable" },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const cls = classifyConstraintError(message);
    if (cls.kind === "stock") {
      // Surface the most-likely culprit. We don't know which line lost
      // the race, so we re-read all of them and report the first that
      // is now insufficient.
      const fresh = await loadFullProductRows(
        data.lines.map((l) => l.productId),
      );
      for (const line of data.lines) {
        const f = fresh.get(line.productId);
        if (!f || f.stock < line.quantity) {
          return {
            ok: false,
            error: {
              code: "stock_conflict",
              productId: line.productId,
              sku: f?.sku ?? line.productSku,
              requested: line.quantity,
              available: f?.stock ?? 0,
            },
          };
        }
      }
      // Fall through if no line is obviously short — surface a generic
      // stock conflict against the first line so the client can refresh.
      const first = data.lines[0];
      return {
        ok: false,
        error: {
          code: "stock_conflict",
          productId: first.productId,
          sku: first.productSku,
          requested: first.quantity,
          available: 0,
        },
      };
    }
    if (cls.kind === "discount_usage") {
      return {
        ok: false,
        error: { code: "discount_invalid", reason: "exhausted" },
      };
    }
    // SSI serialization failures (sqlstate 40001) bubble up as a generic
    // error here; clients are expected to retry the checkout.
    if (/serialization failure|40001/i.test(message)) {
      return {
        ok: false,
        error: {
          code: "internal_error",
          message: "Could not commit order — please retry",
        },
      };
    }
    return {
      ok: false,
      error: { code: "internal_error", message },
    };
  }

  // 6) Re-load the persisted order + items for the response payload.
  const orderRows = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  const orderRow = orderRows[0];
  if (!orderRow) {
    return {
      ok: false,
      error: {
        code: "internal_error",
        message: "Order row missing after commit",
      },
    };
  }
  const itemRowsBack = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  return { ok: true, data: toPublicSummary(orderRow, itemRowsBack) };
}

/* -------------------------------------------------------------------------- */
/*  Read-side helpers: user order list & detail                               */
/* -------------------------------------------------------------------------- */

/** Default + max page sizes for `GET /api/orders`. */
export const ORDERS_DEFAULT_PAGE_SIZE = 20;
export const ORDERS_MAX_PAGE_SIZE = 100;

/**
 * Listing entry — a compact projection of `PublicOrderSummary` that the
 * order-history page renders in a table. The full line items live behind
 * the detail endpoint so the list payload stays small even when a user
 * has hundreds of orders.
 *
 * We keep the rolled-up totals + a small `previewItems` slice so the UI
 * can render thumbnails ("3 items") without a second round-trip per row.
 */
export interface PublicOrderListItemPreview {
  /** Snapshotted product name. */
  name: string;
  /** Thumbnail captured at order time (may be null). */
  imageUrl: string | null;
  quantity: number;
}

export interface PublicOrderListEntry {
  id: string;
  status: string;
  itemCount: number;
  /** Sum of `quantity` across every line — same as `itemCount`. */
  totalQuantity: number;
  subtotalCents: number;
  shippingCents: number;
  discountCents: number;
  totalCents: number;
  currency: string;
  discountCode: string | null;
  shippingCity: string;
  shippingCountry: string;
  /**
   * Up to `previewItemLimit` snapshotted lines, ordered by insertion
   * (i.e. their `createdAt`). Useful for rendering a tiny avatar stack
   * next to each row in the order history table.
   */
  previewItems: PublicOrderListItemPreview[];
  createdAt: string;
  updatedAt: string;
}

export interface ListOrdersForUserInput {
  userId: string;
  page?: number;
  pageSize?: number;
  /** Optional status filter; "all" (default) returns every order. */
  status?: OrderStatus | "all";
  /** How many `previewItems` to include per row. Defaults to 3. */
  previewItemLimit?: number;
}

export interface ListOrdersForUserResult {
  items: PublicOrderListEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

/**
 * Map a raw `orders` row + (optional) preview items to the list-view
 * payload. The `previewItems` are kept as a small, stable subset of the
 * snapshotted line items.
 */
function toPublicListEntry(
  order: Order,
  previewItems: OrderItem[],
): PublicOrderListEntry {
  return {
    id: order.id,
    status: order.status,
    itemCount: order.itemCount,
    totalQuantity: order.itemCount,
    subtotalCents: order.subtotalCents,
    shippingCents: order.shippingCents,
    discountCents: order.discountCents,
    totalCents: order.totalCents,
    currency: order.currency,
    discountCode: order.discountCode ?? null,
    shippingCity: order.shippingCity,
    shippingCountry: order.shippingCountry,
    previewItems: previewItems.map((it) => ({
      name: it.name,
      imageUrl: it.imageUrl ?? null,
      quantity: it.quantity,
    })),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

/**
 * Paginated listing of every order belonging to `userId`, ordered newest
 * first. The query is ownership-scoped at the SQL layer (`user_id = $1`)
 * so a malicious caller cannot ask for someone else's history even with
 * a crafted query string.
 */
export async function listOrdersForUser(
  input: ListOrdersForUserInput,
): Promise<ListOrdersForUserResult> {
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.max(
    1,
    Math.min(
      ORDERS_MAX_PAGE_SIZE,
      Math.floor(input.pageSize ?? ORDERS_DEFAULT_PAGE_SIZE),
    ),
  );
  const previewItemLimit = Math.max(
    0,
    Math.min(10, Math.floor(input.previewItemLimit ?? 3)),
  );
  const status = input.status ?? "all";

  const whereParts = [eq(orders.userId, input.userId)];
  if (status !== "all") {
    whereParts.push(eq(orders.status, status));
  }
  const whereClause = and(...whereParts);

  // Total count (after filters) for pagination metadata.
  const totalRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(whereClause);
  const total = totalRows[0]?.count ?? 0;

  if (total === 0) {
    return {
      items: [],
      page,
      pageSize,
      total: 0,
      totalPages: 0,
      hasMore: false,
    };
  }

  // Fetch the page.
  const rows = await db
    .select()
    .from(orders)
    .where(whereClause)
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  // Bulk-load preview items for every order on the page in a single
  // round-trip, then trim to `previewItemLimit` per order in memory.
  // This is cheap because the query is bounded by `pageSize` orders and
  // every order has at most a handful of lines.
  let previewByOrder = new Map<string, OrderItem[]>();
  if (previewItemLimit > 0 && rows.length > 0) {
    const orderIds = rows.map((r) => r.id);
    const itemRows = await db
      .select()
      .from(orderItems)
      .where(inArray(orderItems.orderId, orderIds))
      .orderBy(asc(orderItems.createdAt), asc(orderItems.id));
    previewByOrder = new Map();
    for (const it of itemRows) {
      const list = previewByOrder.get(it.orderId);
      if (list) {
        if (list.length < previewItemLimit) list.push(it);
      } else {
        previewByOrder.set(it.orderId, [it]);
      }
    }
  }

  const items = rows.map((row) =>
    toPublicListEntry(row, previewByOrder.get(row.id) ?? []),
  );
  const totalPages = Math.ceil(total / pageSize);

  return {
    items,
    page,
    pageSize,
    total,
    totalPages,
    hasMore: page * pageSize < total,
  };
}

/**
 * Look up a single order by id, but only when it belongs to `userId`.
 * Returns the full `PublicOrderSummary` (header + line items) on a hit,
 * or `null` on miss. The ownership check is part of the SQL `WHERE`
 * clause so an attacker who guesses a UUID still gets a 404.
 */
export async function getOrderForUser(
  userId: string,
  orderId: string,
): Promise<PublicOrderSummary | null> {
  const orderRows = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
    .limit(1);
  const orderRow = orderRows[0];
  if (!orderRow) return null;

  const itemRows = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, orderRow.id))
    .orderBy(asc(orderItems.createdAt), asc(orderItems.id));

  return toPublicSummary(orderRow, itemRows);
}

/**
 * Set of statuses the API surface accepts as a `status=` filter on the
 * list endpoint. The route layer uses this to validate the query string
 * before calling `listOrdersForUser`.
 */
export const ORDER_LIST_STATUS_FILTERS = [
  "all",
  ...ORDER_STATUSES,
] as const;
export type OrderListStatusFilter =
  (typeof ORDER_LIST_STATUS_FILTERS)[number];

export function parseOrderStatusFilter(
  raw: string | null,
): OrderListStatusFilter | null {
  if (raw === null || raw === "") return "all";
  if (raw === "all") return "all";
  if (isOrderStatus(raw)) return raw;
  return null;
}
