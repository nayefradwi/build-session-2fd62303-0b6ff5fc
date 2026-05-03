/**
 * Admin analytics aggregations.
 *
 * The admin dashboard surfaces five rollups derived from the live
 * `orders` / `order_items` tables:
 *
 *   1. `getOrdersSummary`       — total orders, revenue, average order
 *                                 value, item count, refunded total, and
 *                                 per-status counts (one query each, all
 *                                 scoped to the same date range).
 *   2. `getOrdersByStatus`      — count + revenue grouped by status.
 *                                 Returned as a stable list ordered by the
 *                                 canonical `ORDER_STATUSES` vocabulary so
 *                                 admin UIs can render a fixed set of bars
 *                                 without juggling missing buckets.
 *   3. `getTopProducts`         — top N line items by total quantity OR
 *                                 total revenue, joined back to the live
 *                                 `products` row when it still exists so
 *                                 the admin gets a slug + thumbnail.
 *   4. `getRecentOrders`        — most-recent N orders, optionally
 *                                 filtered by the same date range. Reuses
 *                                 the existing admin order list shape so
 *                                 the dashboard widget can deep-link to
 *                                 the order detail page.
 *
 * Every helper accepts an optional `dateFrom` / `dateTo` window that maps
 * to inclusive bounds on `orders.created_at`. Cancelled orders are
 * excluded from the revenue rollups by default — they don't represent
 * realised income — but ARE counted in the per-status breakdown and the
 * recent-orders list because admins still want to see them.
 *
 * Caching: range queries get a tiny in-process LRU keyed on the
 * normalised input. Each entry holds for `ANALYTICS_CACHE_TTL_MS` (60
 * seconds by default) which is short enough that a fresh paid order shows
 * up promptly but long enough to survive a dashboard refresh storm. The
 * cache lives on the per-instance module — Vercel may run many instances
 * and a request can bypass the cache by passing `bypassCache: true`. This
 * is intentionally a poor man's cache, NOT a redis-backed store; the
 * admin analytics surface tolerates eventual consistency.
 */
import { and, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  ORDER_STATUSES,
  orderItems,
  orders,
  productImages,
  products,
  users,
  type OrderStatus,
} from "@/lib/db/schema";

/* -------------------------------------------------------------------------- */
/*  Shared types                                                              */
/* -------------------------------------------------------------------------- */

export interface DateRangeInput {
  /** Inclusive lower bound on `orders.created_at`. */
  dateFrom?: string | Date;
  /** Inclusive upper bound on `orders.created_at`. */
  dateTo?: string | Date;
}

export interface AnalyticsCacheControl {
  /** Skip the in-process cache for this call. */
  bypassCache?: boolean;
}

interface NormalisedRange {
  from: Date | null;
  to: Date | null;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function coerceDate(value: string | Date | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normaliseRange(input: DateRangeInput): NormalisedRange {
  return {
    from: coerceDate(input.dateFrom),
    to: coerceDate(input.dateTo),
  };
}

/** Build the WHERE clause used by every analytics query. */
function rangeClause(range: NormalisedRange) {
  const where: ReturnType<typeof eq>[] = [];
  if (range.from) where.push(gte(orders.createdAt, range.from));
  if (range.to) where.push(lte(orders.createdAt, range.to));
  return where;
}

/**
 * Statuses considered "successful" for revenue rollups. We deliberately
 * exclude `cancelled` (refunded — not realised) and treat `pending` as
 * realised on the assumption the storefront's `POST /api/orders` path
 * captures payment alongside order creation. If a future release splits
 * payment capture from order creation, narrow this list to
 * `["paid", "processing", "shipped", "delivered"]`.
 */
export const REVENUE_STATUSES: readonly OrderStatus[] = [
  "pending",
  "paid",
  "processing",
  "shipped",
  "delivered",
] as const;

/* -------------------------------------------------------------------------- */
/*  In-process cache                                                          */
/* -------------------------------------------------------------------------- */

/** Cache TTL for range-scoped queries. */
export const ANALYTICS_CACHE_TTL_MS = 60_000;
/** Hard cap on cache entries to keep memory bounded. */
const ANALYTICS_CACHE_MAX_ENTRIES = 64;

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

const analyticsCache = new Map<string, CacheEntry<unknown>>();

/**
 * Normalise a range + scope into a stable cache key. `null` bounds are
 * encoded explicitly so "no upper bound" and "epoch upper bound" don't
 * collide.
 */
function cacheKey(scope: string, range: NormalisedRange, extra = ""): string {
  const from = range.from ? range.from.toISOString() : "-";
  const to = range.to ? range.to.toISOString() : "-";
  return `${scope}|${from}|${to}|${extra}`;
}

function cacheGet<T>(key: string): T | undefined {
  const hit = analyticsCache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    analyticsCache.delete(key);
    return undefined;
  }
  return hit.value as T;
}

function cacheSet<T>(key: string, value: T): void {
  // Naive LRU: drop the oldest entry when over capacity.
  if (analyticsCache.size >= ANALYTICS_CACHE_MAX_ENTRIES) {
    const firstKey = analyticsCache.keys().next().value;
    if (firstKey !== undefined) analyticsCache.delete(firstKey);
  }
  analyticsCache.set(key, {
    expiresAt: Date.now() + ANALYTICS_CACHE_TTL_MS,
    value,
  });
}

/** Clear the analytics cache — exposed for tests / dev tooling. */
export function clearAnalyticsCache(): void {
  analyticsCache.clear();
}

/* -------------------------------------------------------------------------- */
/*  Summary                                                                   */
/* -------------------------------------------------------------------------- */

export interface OrdersSummary {
  /** All orders in the window — including cancelled. */
  totalOrders: number;
  /** Orders that count toward revenue (REVENUE_STATUSES, excluding cancelled). */
  paidOrders: number;
  /** Orders cancelled in the window. */
  cancelledOrders: number;
  /** Sum of `subtotal_cents` across REVENUE_STATUSES. */
  subtotalCents: number;
  /** Sum of `discount_cents` across REVENUE_STATUSES. */
  discountCents: number;
  /** Sum of `shipping_cents` across REVENUE_STATUSES. */
  shippingCents: number;
  /** Sum of `total_cents` across REVENUE_STATUSES. The headline figure. */
  revenueCents: number;
  /** Sum of `total_cents` across cancelled orders. Refund proxy. */
  cancelledRevenueCents: number;
  /** Sum of `item_count` across REVENUE_STATUSES. */
  itemsSold: number;
  /** Average revenueCents / paidOrders, integer cents. 0 when paidOrders=0. */
  averageOrderValueCents: number;
  currency: string;
  range: {
    from: string | null;
    to: string | null;
  };
  generatedAt: string;
}

export async function getOrdersSummary(
  input: DateRangeInput & AnalyticsCacheControl = {},
): Promise<OrdersSummary> {
  const range = normaliseRange(input);
  const key = cacheKey("summary", range);
  if (!input.bypassCache) {
    const hit = cacheGet<OrdersSummary>(key);
    if (hit) return hit;
  }

  const where = rangeClause(range);
  const baseWhere = where.length === 0 ? undefined : and(...where);

  // One query, statuses split out via FILTER (...) so the round-trip is
  // a single Postgres scan instead of N. Drizzle doesn't model FILTER
  // first-class, so we drop into a `sql` template.
  const cancelledList = `'cancelled'`;
  const revenueList = REVENUE_STATUSES.map((s) => `'${s}'`).join(",");

  const baseQuery = db
    .select({
      totalOrders: sql<number>`count(*)::int`,
      paidOrders: sql<number>`count(*) filter (where ${orders.status} in (${sql.raw(revenueList)}))::int`,
      cancelledOrders: sql<number>`count(*) filter (where ${orders.status} = ${sql.raw(cancelledList)})::int`,
      subtotalCents: sql<number>`coalesce(sum(${orders.subtotalCents}) filter (where ${orders.status} in (${sql.raw(revenueList)})), 0)::bigint`,
      discountCents: sql<number>`coalesce(sum(${orders.discountCents}) filter (where ${orders.status} in (${sql.raw(revenueList)})), 0)::bigint`,
      shippingCents: sql<number>`coalesce(sum(${orders.shippingCents}) filter (where ${orders.status} in (${sql.raw(revenueList)})), 0)::bigint`,
      revenueCents: sql<number>`coalesce(sum(${orders.totalCents}) filter (where ${orders.status} in (${sql.raw(revenueList)})), 0)::bigint`,
      cancelledRevenueCents: sql<number>`coalesce(sum(${orders.totalCents}) filter (where ${orders.status} = ${sql.raw(cancelledList)}), 0)::bigint`,
      itemsSold: sql<number>`coalesce(sum(${orders.itemCount}) filter (where ${orders.status} in (${sql.raw(revenueList)})), 0)::bigint`,
      currency: sql<string | null>`min(${orders.currency})`,
    })
    .from(orders);

  const rows = await (baseWhere ? baseQuery.where(baseWhere) : baseQuery);
  const row = rows[0];

  // The Neon HTTP driver returns `bigint`-typed sums as strings (or
  // numbers depending on the underlying value). Normalise to number — the
  // app deals in integer cents and stays well under JS safe-integer range
  // for any realistic store.
  const num = (v: number | string | null | undefined): number => {
    if (v === null || v === undefined) return 0;
    if (typeof v === "number") return v;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const totalOrders = num(row?.totalOrders);
  const paidOrders = num(row?.paidOrders);
  const cancelledOrders = num(row?.cancelledOrders);
  const revenueCents = num(row?.revenueCents);
  const aov = paidOrders === 0 ? 0 : Math.round(revenueCents / paidOrders);

  const result: OrdersSummary = {
    totalOrders,
    paidOrders,
    cancelledOrders,
    subtotalCents: num(row?.subtotalCents),
    discountCents: num(row?.discountCents),
    shippingCents: num(row?.shippingCents),
    revenueCents,
    cancelledRevenueCents: num(row?.cancelledRevenueCents),
    itemsSold: num(row?.itemsSold),
    averageOrderValueCents: aov,
    currency: row?.currency ?? "USD",
    range: {
      from: range.from ? range.from.toISOString() : null,
      to: range.to ? range.to.toISOString() : null,
    },
    generatedAt: new Date().toISOString(),
  };

  cacheSet(key, result);
  return result;
}

/* -------------------------------------------------------------------------- */
/*  Orders by status                                                          */
/* -------------------------------------------------------------------------- */

export interface OrdersByStatusEntry {
  status: OrderStatus;
  count: number;
  revenueCents: number;
}

export interface OrdersByStatusResult {
  items: OrdersByStatusEntry[];
  totalOrders: number;
  range: {
    from: string | null;
    to: string | null;
  };
  generatedAt: string;
}

export async function getOrdersByStatus(
  input: DateRangeInput & AnalyticsCacheControl = {},
): Promise<OrdersByStatusResult> {
  const range = normaliseRange(input);
  const key = cacheKey("by-status", range);
  if (!input.bypassCache) {
    const hit = cacheGet<OrdersByStatusResult>(key);
    if (hit) return hit;
  }

  const where = rangeClause(range);
  const baseWhere = where.length === 0 ? undefined : and(...where);

  const baseQuery = db
    .select({
      status: orders.status,
      count: sql<number>`count(*)::int`,
      revenueCents: sql<number>`coalesce(sum(${orders.totalCents}), 0)::bigint`,
    })
    .from(orders);

  const rows = await (baseWhere ? baseQuery.where(baseWhere) : baseQuery)
    .groupBy(orders.status);

  // Normalise: always emit a row per canonical status (zero-filled if
  // nothing matched). Statuses that don't appear in `ORDER_STATUSES`
  // (defensive — should never happen with the CHECK in place) get
  // appended at the end alphabetically.
  const byStatus = new Map<string, { count: number; revenueCents: number }>();
  for (const r of rows) {
    const cents =
      typeof r.revenueCents === "number"
        ? r.revenueCents
        : Number(r.revenueCents) || 0;
    byStatus.set(r.status, { count: r.count, revenueCents: cents });
  }

  const items: OrdersByStatusEntry[] = ORDER_STATUSES.map((status) => {
    const hit = byStatus.get(status);
    return {
      status,
      count: hit?.count ?? 0,
      revenueCents: hit?.revenueCents ?? 0,
    };
  });

  // Surface any unknown statuses (forward-compat) without breaking the
  // canonical ordering.
  for (const [status, info] of byStatus) {
    if (!(ORDER_STATUSES as readonly string[]).includes(status)) {
      items.push({
        status: status as OrderStatus,
        count: info.count,
        revenueCents: info.revenueCents,
      });
    }
  }

  const totalOrders = items.reduce((acc, e) => acc + e.count, 0);

  const result: OrdersByStatusResult = {
    items,
    totalOrders,
    range: {
      from: range.from ? range.from.toISOString() : null,
      to: range.to ? range.to.toISOString() : null,
    },
    generatedAt: new Date().toISOString(),
  };

  cacheSet(key, result);
  return result;
}

/* -------------------------------------------------------------------------- */
/*  Top products                                                              */
/* -------------------------------------------------------------------------- */

export const TOP_PRODUCTS_DEFAULT_LIMIT = 10;
export const TOP_PRODUCTS_MAX_LIMIT = 100;

export type TopProductsSortBy = "quantity" | "revenue";

export interface TopProductsInput
  extends DateRangeInput,
    AnalyticsCacheControl {
  /** What to rank by. Default "revenue". */
  sortBy?: TopProductsSortBy;
  /** Limit on rows returned. Defaults to 10, max 100. */
  limit?: number;
  /** When true, exclude cancelled orders. Default true. */
  excludeCancelled?: boolean;
}

export interface TopProductRow {
  productId: string | null;
  /** Snapshot SKU from `order_items.sku`. Stable even when product is gone. */
  sku: string;
  /** Snapshot name. */
  name: string;
  /** When the live product still exists, its slug + primary image — handy
   *  for the dashboard to deep-link. */
  slug: string | null;
  primaryImageUrl: string | null;
  /** Sum of `order_items.quantity`. */
  quantitySold: number;
  /** Sum of `order_items.line_total_cents`. */
  revenueCents: number;
  /** Number of distinct orders that contained the product. */
  ordersCount: number;
  currency: string;
}

export interface TopProductsResult {
  items: TopProductRow[];
  sortBy: TopProductsSortBy;
  limit: number;
  range: {
    from: string | null;
    to: string | null;
  };
  generatedAt: string;
}

export async function getTopProducts(
  input: TopProductsInput = {},
): Promise<TopProductsResult> {
  const range = normaliseRange(input);
  const sortBy: TopProductsSortBy = input.sortBy ?? "revenue";
  const limit = Math.max(
    1,
    Math.min(
      TOP_PRODUCTS_MAX_LIMIT,
      Math.floor(input.limit ?? TOP_PRODUCTS_DEFAULT_LIMIT),
    ),
  );
  const excludeCancelled = input.excludeCancelled ?? true;

  const key = cacheKey(
    "top-products",
    range,
    `${sortBy}|${limit}|${excludeCancelled ? "x" : ""}`,
  );
  if (!input.bypassCache) {
    const hit = cacheGet<TopProductsResult>(key);
    if (hit) return hit;
  }

  // Build the WHERE bag against `orders` since the date column lives there.
  const where: ReturnType<typeof eq>[] = [];
  if (range.from) where.push(gte(orders.createdAt, range.from));
  if (range.to) where.push(lte(orders.createdAt, range.to));
  if (excludeCancelled) where.push(ne(orders.status, "cancelled"));
  const whereClause = where.length === 0 ? undefined : and(...where);

  // Group by the snapshotted (sku, name) so deleted products still appear
  // (their `productId` will be null). When the product still exists we
  // also bring its slug along so the UI can link.
  const baseQuery = db
    .select({
      productId: orderItems.productId,
      sku: orderItems.sku,
      name: orderItems.name,
      quantitySold: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::bigint`,
      revenueCents: sql<number>`coalesce(sum(${orderItems.lineTotalCents}), 0)::bigint`,
      ordersCount: sql<number>`count(distinct ${orderItems.orderId})::int`,
      currency: sql<string | null>`min(${orderItems.currency})`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId));

  const sortExpr =
    sortBy === "quantity"
      ? sql`coalesce(sum(${orderItems.quantity}), 0)`
      : sql`coalesce(sum(${orderItems.lineTotalCents}), 0)`;

  const aggregated = await (whereClause
    ? baseQuery.where(whereClause)
    : baseQuery)
    .groupBy(orderItems.productId, orderItems.sku, orderItems.name)
    .orderBy(desc(sortExpr))
    .limit(limit);

  // Hydrate live product info (slug + primary image) for rows whose
  // `productId` is non-null. One join keeps the round-trip count low.
  const productIds = aggregated
    .map((r) => r.productId)
    .filter((id): id is string => typeof id === "string");

  const productMeta = new Map<
    string,
    { slug: string; primaryImageUrl: string | null }
  >();
  if (productIds.length > 0) {
    const productRows = await db
      .select({
        id: products.id,
        slug: products.slug,
        imageUrl: productImages.url,
        imagePosition: productImages.position,
      })
      .from(products)
      .leftJoin(productImages, eq(productImages.productId, products.id))
      .where(inArray(products.id, productIds));

    // Pick the lowest-position image per product.
    const best = new Map<
      string,
      { slug: string; url: string | null; position: number }
    >();
    for (const row of productRows) {
      const cur = best.get(row.id);
      const pos = row.imagePosition ?? Number.MAX_SAFE_INTEGER;
      if (!cur || pos < cur.position) {
        best.set(row.id, {
          slug: row.slug,
          url: row.imageUrl ?? null,
          position: pos,
        });
      }
    }
    for (const [id, info] of best) {
      productMeta.set(id, { slug: info.slug, primaryImageUrl: info.url });
    }
  }

  const num = (v: number | string | null | undefined): number => {
    if (v === null || v === undefined) return 0;
    if (typeof v === "number") return v;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const items: TopProductRow[] = aggregated.map((r) => {
    const meta = r.productId ? productMeta.get(r.productId) ?? null : null;
    return {
      productId: r.productId ?? null,
      sku: r.sku,
      name: r.name,
      slug: meta?.slug ?? null,
      primaryImageUrl: meta?.primaryImageUrl ?? null,
      quantitySold: num(r.quantitySold),
      revenueCents: num(r.revenueCents),
      ordersCount: num(r.ordersCount),
      currency: r.currency ?? "USD",
    };
  });

  const result: TopProductsResult = {
    items,
    sortBy,
    limit,
    range: {
      from: range.from ? range.from.toISOString() : null,
      to: range.to ? range.to.toISOString() : null,
    },
    generatedAt: new Date().toISOString(),
  };

  cacheSet(key, result);
  return result;
}

/* -------------------------------------------------------------------------- */
/*  Recent orders                                                             */
/* -------------------------------------------------------------------------- */

export const RECENT_ORDERS_DEFAULT_LIMIT = 10;
export const RECENT_ORDERS_MAX_LIMIT = 50;

export interface RecentOrdersInput
  extends DateRangeInput,
    AnalyticsCacheControl {
  limit?: number;
}

export interface RecentOrderEntry {
  id: string;
  orderNumber: string;
  status: OrderStatus | string;
  totalCents: number;
  currency: string;
  itemCount: number;
  customer: {
    id: string;
    email: string;
    name: string | null;
  };
  createdAt: string;
}

export interface RecentOrdersResult {
  items: RecentOrderEntry[];
  range: {
    from: string | null;
    to: string | null;
  };
  generatedAt: string;
}

function shortOrderNumber(id: string): string {
  return `ORD-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

export async function getRecentOrders(
  input: RecentOrdersInput = {},
): Promise<RecentOrdersResult> {
  const range = normaliseRange(input);
  const limit = Math.max(
    1,
    Math.min(
      RECENT_ORDERS_MAX_LIMIT,
      Math.floor(input.limit ?? RECENT_ORDERS_DEFAULT_LIMIT),
    ),
  );

  const key = cacheKey("recent-orders", range, String(limit));
  if (!input.bypassCache) {
    const hit = cacheGet<RecentOrdersResult>(key);
    if (hit) return hit;
  }

  const where = rangeClause(range);
  const whereClause = where.length === 0 ? undefined : and(...where);

  const baseQuery = db
    .select({
      id: orders.id,
      status: orders.status,
      totalCents: orders.totalCents,
      currency: orders.currency,
      itemCount: orders.itemCount,
      createdAt: orders.createdAt,
      customerId: users.id,
      customerEmail: users.email,
      customerName: users.name,
    })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.userId));

  const rows = await (whereClause ? baseQuery.where(whereClause) : baseQuery)
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(limit);

  const items: RecentOrderEntry[] = rows.map((r) => ({
    id: r.id,
    orderNumber: shortOrderNumber(r.id),
    status: r.status,
    totalCents: r.totalCents,
    currency: r.currency,
    itemCount: r.itemCount,
    customer: {
      id: r.customerId,
      email: r.customerEmail,
      name: r.customerName ?? null,
    },
    createdAt: r.createdAt.toISOString(),
  }));

  const result: RecentOrdersResult = {
    items,
    range: {
      from: range.from ? range.from.toISOString() : null,
      to: range.to ? range.to.toISOString() : null,
    },
    generatedAt: new Date().toISOString(),
  };

  cacheSet(key, result);
  return result;
}
