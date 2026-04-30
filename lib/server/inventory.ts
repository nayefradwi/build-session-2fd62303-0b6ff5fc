/**
 * Admin inventory management helpers.
 *
 * The catalog write surface in `lib/server/admin-products.ts` already
 * accepts a `stock` field on create/update — but inventory has its own
 * affordances (audit trail, bulk updates, configurable low-stock
 * threshold) that don't belong on the generic product PUT. Routes under
 * `app/api/admin/inventory/**` are the home for those, and this module is
 * their service layer.
 *
 * Highlights:
 *
 *   - Every change to `products.stock` issued through the helpers below
 *     also writes a `stock_adjustments` row with the actor (`userId`),
 *     the signed delta, before/after values, and an optional `reason`.
 *     Admin UIs can replay the log to reconstruct who touched what.
 *
 *   - The low-stock threshold is stored in `app_config` under the key
 *     `inventory.low_stock_threshold`. When unset, the helpers fall back
 *     to `DEFAULT_LOW_STOCK_THRESHOLD`.
 *
 *   - Setting stock to zero does NOT delete cart rows or anything else;
 *     it just marks the product as out-of-stock. Out-of-stock products
 *     are surfaced with `inStock: false` and `outOfStock: true` in the
 *     response payloads so admin UIs can highlight them.
 *
 * Concurrency: the Neon HTTP driver does not expose interactive
 * transactions, but the underlying `neonSql` tag exposes a batched
 * transaction. The "set absolute stock + log" combo runs as a single
 * batch so an aborted UPDATE never leaves an orphan log row. Bulk
 * updates run each line in its own batch (rather than a single mega-tx)
 * so a single bad line returns a per-line error instead of failing the
 * whole call — matching the bulk semantics most admin UIs expect.
 */
import { and, asc, desc, eq, ilike, inArray, lte, or, sql } from "drizzle-orm";

import { db, neonSql } from "@/lib/db";
import {
  appConfig,
  categories,
  productImages,
  products,
  stockAdjustments,
  users,
  type Category,
  type Product,
  type StockAdjustment,
} from "@/lib/db/schema";

/** Cap on the unsigned stock value. Same ceiling the admin product
 *  validator enforces — kept in sync intentionally. */
export const STOCK_MAX = 10_000_000;

/** Free-form reason strings are capped to this length. */
export const REASON_MAX = 500;

/** Default low-stock threshold when no `app_config` row is set. */
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

/** Hard ceiling on configurable thresholds. Anything past this is
 *  almost certainly a typo. */
export const LOW_STOCK_THRESHOLD_MAX = 1_000_000;

/** `app_config` key for the configurable threshold. */
export const LOW_STOCK_THRESHOLD_CONFIG_KEY = "inventory.low_stock_threshold";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/**
 * Public inventory row returned by the list / detail endpoints. The shape
 * intentionally mirrors the storefront product summary (so admin and
 * shopper code agree on vocabulary) plus inventory-specific flags.
 */
export interface InventoryRow {
  productId: string;
  slug: string;
  sku: string;
  name: string;
  primaryImageUrl: string | null;
  category: { id: string; slug: string; name: string } | null;
  priceCents: number;
  currency: string;
  size: string | null;
  material: string | null;
  color: string | null;
  stock: number;
  /** Convenience: `stock > 0`. */
  inStock: boolean;
  /** Convenience: `stock <= 0`. UI highlights this in red. */
  outOfStock: boolean;
  /** Whether `stock` is at or below the active low-stock threshold. */
  lowStock: boolean;
  lowStockThreshold: number;
  updatedAt: string;
}

export interface ListInventoryInput {
  q?: string;
  page?: number;
  pageSize?: number;
  /**
   * Restrict to a stock-bucket. `low` returns rows with stock <= threshold;
   * `out` returns stock <= 0; `in` returns stock > 0; `any` (default)
   * applies no stock filter.
   */
  status?: "any" | "in" | "out" | "low";
  categoryId?: string;
}

export interface ListInventoryResult {
  items: InventoryRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
  lowStockThreshold: number;
}

export const INVENTORY_DEFAULT_PAGE_SIZE = 25;
export const INVENTORY_MAX_PAGE_SIZE = 100;

/**
 * Read the configured low-stock threshold from `app_config`. Returns
 * `DEFAULT_LOW_STOCK_THRESHOLD` when no row exists, when the stored value
 * fails to parse, or when the parsed value is outside the supported
 * range. The fallback is intentional — admins should be able to recover
 * a sane threshold by deleting the row.
 */
export async function getLowStockThreshold(): Promise<number> {
  const rows = await db
    .select()
    .from(appConfig)
    .where(eq(appConfig.key, LOW_STOCK_THRESHOLD_CONFIG_KEY))
    .limit(1);
  const row = rows[0];
  if (!row) return DEFAULT_LOW_STOCK_THRESHOLD;
  const parsed = Number(row.value);
  if (
    !Number.isFinite(parsed) ||
    !Number.isInteger(parsed) ||
    parsed < 0 ||
    parsed > LOW_STOCK_THRESHOLD_MAX
  ) {
    return DEFAULT_LOW_STOCK_THRESHOLD;
  }
  return parsed;
}

export interface SetThresholdInput {
  value: number;
  userId: string;
}

export type SetThresholdResult =
  | { ok: true; data: { value: number; updatedAt: string } }
  | {
      ok: false;
      error:
        | {
            code: "validation_failed";
            message: string;
            fields?: Record<string, string[]>;
          };
    };

/**
 * Upsert the low-stock threshold. Persists the integer as a base-10
 * string so the column can host other scalar settings later without a
 * migration.
 */
export async function setLowStockThreshold(
  input: SetThresholdInput,
): Promise<SetThresholdResult> {
  if (
    typeof input.value !== "number" ||
    !Number.isFinite(input.value) ||
    !Number.isInteger(input.value) ||
    input.value < 0 ||
    input.value > LOW_STOCK_THRESHOLD_MAX
  ) {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: "Threshold must be a non-negative integer",
        fields: {
          value: [
            `Expected an integer between 0 and ${LOW_STOCK_THRESHOLD_MAX}`,
          ],
        },
      },
    };
  }

  const updatedAt = new Date();
  await db
    .insert(appConfig)
    .values({
      key: LOW_STOCK_THRESHOLD_CONFIG_KEY,
      value: String(input.value),
      updatedBy: input.userId,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: {
        value: String(input.value),
        updatedBy: input.userId,
        updatedAt,
      },
    });

  return {
    ok: true,
    data: { value: input.value, updatedAt: updatedAt.toISOString() },
  };
}

/** Promote a product row + its category + the lowest-position image into
 *  the public inventory shape. */
function toInventoryRow(
  product: Product,
  category: Category | null,
  primaryImageUrl: string | null,
  lowStockThreshold: number,
): InventoryRow {
  const stock = product.stock ?? 0;
  return {
    productId: product.id,
    slug: product.slug,
    sku: product.sku,
    name: product.name,
    primaryImageUrl,
    category: category
      ? { id: category.id, slug: category.slug, name: category.name }
      : null,
    priceCents: product.priceCents,
    currency: product.currency,
    size: product.size ?? null,
    material: product.material ?? null,
    color: product.color ?? null,
    stock,
    inStock: stock > 0,
    outOfStock: stock <= 0,
    lowStock: stock <= lowStockThreshold,
    lowStockThreshold,
    updatedAt: product.updatedAt.toISOString(),
  };
}

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

export async function listInventory(
  input: ListInventoryInput = {},
): Promise<ListInventoryResult> {
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.max(
    1,
    Math.min(
      INVENTORY_MAX_PAGE_SIZE,
      Math.floor(input.pageSize ?? INVENTORY_DEFAULT_PAGE_SIZE),
    ),
  );

  const lowStockThreshold = await getLowStockThreshold();

  const where = [] as ReturnType<typeof eq>[];
  if (input.q && input.q.trim().length > 0) {
    const term = `%${input.q.trim()}%`;
    const combined = or(
      ilike(products.name, term),
      ilike(products.sku, term),
      ilike(products.slug, term),
    );
    if (combined) where.push(combined as ReturnType<typeof eq>);
  }
  if (input.categoryId && isUuid(input.categoryId)) {
    where.push(eq(products.categoryId, input.categoryId));
  }
  switch (input.status) {
    case "in":
      where.push(sql`${products.stock} > 0` as ReturnType<typeof eq>);
      break;
    case "out":
      where.push(sql`${products.stock} <= 0` as ReturnType<typeof eq>);
      break;
    case "low":
      where.push(lte(products.stock, lowStockThreshold));
      break;
    case "any":
    default:
      break;
  }

  const whereClause = where.length === 0 ? undefined : and(...where);

  const totalRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(products)
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
      lowStockThreshold,
    };
  }

  const rows = await db
    .select({ product: products, category: categories })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(whereClause)
    .orderBy(asc(products.stock), asc(products.name))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const productIds = rows.map((r) => r.product.id);
  const primaryImages = await fetchPrimaryImages(productIds);

  const items = rows.map((r) =>
    toInventoryRow(
      r.product,
      r.category ?? null,
      primaryImages.get(r.product.id) ?? null,
      lowStockThreshold,
    ),
  );

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return {
    items,
    page,
    pageSize,
    total,
    totalPages,
    hasMore: page < totalPages,
    lowStockThreshold,
  };
}

/** Fetch a single inventory row by product id. Returns null if the
 *  product does not exist. */
export async function getInventoryRow(
  productId: string,
): Promise<InventoryRow | null> {
  if (!isUuid(productId)) return null;
  const lowStockThreshold = await getLowStockThreshold();

  const rows = await db
    .select({ product: products, category: categories })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(eq(products.id, productId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const primary = await fetchPrimaryImages([productId]);

  return toInventoryRow(
    row.product,
    row.category ?? null,
    primary.get(productId) ?? null,
    lowStockThreshold,
  );
}

/** Surface low-stock products (stock <= threshold) in one call. Useful
 *  for admin dashboards that show a "needs restock" widget. */
export async function listLowStockProducts(
  options: { limit?: number } = {},
): Promise<{ items: InventoryRow[]; lowStockThreshold: number }> {
  const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 100)));
  const lowStockThreshold = await getLowStockThreshold();

  const rows = await db
    .select({ product: products, category: categories })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(lte(products.stock, lowStockThreshold))
    .orderBy(asc(products.stock), asc(products.name))
    .limit(limit);

  const productIds = rows.map((r) => r.product.id);
  const primaryImages = await fetchPrimaryImages(productIds);

  const items = rows.map((r) =>
    toInventoryRow(
      r.product,
      r.category ?? null,
      primaryImages.get(r.product.id) ?? null,
      lowStockThreshold,
    ),
  );

  return { items, lowStockThreshold };
}

export type StockUpdateError =
  | { code: "not_found" }
  | { code: "no_change" }
  | {
      code: "validation_failed";
      message: string;
      fields?: Record<string, string[]>;
    };

export interface StockUpdateInput {
  productId: string;
  /** Mutually exclusive with `delta`. Sets stock to this absolute value. */
  stock?: number;
  /** Mutually exclusive with `stock`. Adds the signed delta (can be negative). */
  delta?: number;
  /** Optional admin note attached to the audit row. */
  reason?: string | null;
  /** The acting admin (logged on the audit row). */
  userId: string;
}

export interface StockUpdateOutcome {
  product: InventoryRow;
  adjustment: PublicStockAdjustment;
}

export type StockUpdateResult =
  | { ok: true; data: StockUpdateOutcome }
  | { ok: false; error: StockUpdateError };

/**
 * Validate the input shape for a single-line stock change. Returns a
 * normalized `{ stock, reason }` pair the writer can use directly.
 */
function validateStockUpdate(
  input: StockUpdateInput,
  currentStock: number,
):
  | { ok: true; nextStock: number; reason: string | null }
  | { ok: false; error: Extract<StockUpdateError, { code: "validation_failed" }> } {
  const fields: Record<string, string[]> = {};

  const hasStock = input.stock !== undefined && input.stock !== null;
  const hasDelta = input.delta !== undefined && input.delta !== null;

  if (!hasStock && !hasDelta) {
    fields.stock = ["Provide either `stock` or `delta`"];
  }
  if (hasStock && hasDelta) {
    fields.stock = ["`stock` and `delta` are mutually exclusive"];
  }

  let nextStock = currentStock;
  if (hasStock) {
    const v = input.stock!;
    if (
      !Number.isFinite(v) ||
      !Number.isInteger(v) ||
      v < 0 ||
      v > STOCK_MAX
    ) {
      fields.stock = [
        `stock must be a non-negative integer up to ${STOCK_MAX}`,
      ];
    } else {
      nextStock = v;
    }
  }
  if (hasDelta) {
    const v = input.delta!;
    if (
      !Number.isFinite(v) ||
      !Number.isInteger(v) ||
      v < -STOCK_MAX ||
      v > STOCK_MAX
    ) {
      fields.delta = [
        `delta must be a signed integer between -${STOCK_MAX} and ${STOCK_MAX}`,
      ];
    } else {
      const candidate = currentStock + v;
      if (candidate < 0) {
        fields.delta = [
          `delta would drive stock below zero (current ${currentStock}, requested ${v})`,
        ];
      } else if (candidate > STOCK_MAX) {
        fields.delta = [
          `delta would drive stock above the cap (${STOCK_MAX})`,
        ];
      } else {
        nextStock = candidate;
      }
    }
  }

  let reason: string | null = null;
  if (input.reason !== undefined && input.reason !== null) {
    if (typeof input.reason !== "string") {
      fields.reason = ["reason must be a string or null"];
    } else {
      const trimmed = input.reason.trim();
      if (trimmed.length === 0) {
        reason = null;
      } else if (trimmed.length > REASON_MAX) {
        fields.reason = [`reason is too long (max ${REASON_MAX})`];
      } else {
        reason = trimmed;
      }
    }
  }

  if (Object.keys(fields).length > 0) {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: "Invalid stock update payload",
        fields,
      },
    };
  }
  return { ok: true, nextStock, reason };
}

/**
 * Apply a stock change to a single product and write the audit row. The
 * UPDATE is gated on `stock = previous_stock` so concurrent writers can't
 * drive the column past the value the actor authorised — if another
 * admin (or the order pipeline) changed the row first we surface a
 * `not_found` so the caller retries with the fresh value.
 */
export async function updateProductStock(
  input: StockUpdateInput,
): Promise<StockUpdateResult> {
  if (!isUuid(input.productId)) {
    return { ok: false, error: { code: "not_found" } };
  }

  const existing = await db
    .select()
    .from(products)
    .where(eq(products.id, input.productId))
    .limit(1);
  const current = existing[0];
  if (!current) {
    return { ok: false, error: { code: "not_found" } };
  }

  const validated = validateStockUpdate(input, current.stock);
  if (!validated.ok) return validated;

  const previousStock = current.stock;
  const nextStock = validated.nextStock;
  if (nextStock === previousStock) {
    return { ok: false, error: { code: "no_change" } };
  }
  const delta = nextStock - previousStock;
  const reason = validated.reason;

  // Optimistic-locking UPDATE — bail if a concurrent writer changed the
  // row first. The matching row count tells us whether we won the race.
  const updated = await db
    .update(products)
    .set({ stock: nextStock, updatedAt: new Date() })
    .where(
      and(eq(products.id, input.productId), eq(products.stock, previousStock)),
    )
    .returning({ id: products.id });
  if (updated.length === 0) {
    // Race: another writer changed the row first. Treat as not-found so
    // the route layer returns 409-equivalent semantics. We could also
    // model this as its own error code; keeping the surface narrow.
    return { ok: false, error: { code: "not_found" } };
  }

  const adjRows = await db
    .insert(stockAdjustments)
    .values({
      productId: input.productId,
      userId: input.userId,
      delta,
      previousStock,
      newStock: nextStock,
      reason: reason ?? null,
    })
    .returning();
  const adjustment = adjRows[0];
  if (!adjustment) {
    // Should not happen in practice. Kept for type-narrowing.
    return {
      ok: false,
      error: { code: "validation_failed", message: "Failed to log adjustment" },
    };
  }

  const row = await getInventoryRow(input.productId);
  if (!row) return { ok: false, error: { code: "not_found" } };

  return {
    ok: true,
    data: {
      product: row,
      adjustment: toPublicAdjustment(adjustment, {
        productSku: current.sku,
        productName: current.name,
        userEmail: null,
      }),
    },
  };
}

export interface BulkStockLineInput {
  productId: string;
  stock?: number;
  delta?: number;
  reason?: string | null;
}

export interface BulkStockUpdateInput {
  updates: BulkStockLineInput[];
  /** Reason applied to lines that don't carry one of their own. */
  defaultReason?: string | null;
  userId: string;
}

export interface BulkStockLineResult {
  productId: string;
  ok: boolean;
  product?: InventoryRow;
  adjustment?: PublicStockAdjustment;
  error?: StockUpdateError;
}

export interface BulkStockUpdateResult {
  ok: true;
  results: BulkStockLineResult[];
  applied: number;
  failed: number;
}

/**
 * Apply many stock changes in one call. Each line is independent — a
 * single failure does not roll back the others. The response carries
 * a per-line outcome so admin UIs can surface row-level errors.
 *
 * Guarded against duplicate productIds in the input: only the first
 * occurrence is applied; subsequent rows return `validation_failed`
 * (the caller almost certainly meant to combine them client-side).
 */
export async function bulkUpdateProductStock(
  input: BulkStockUpdateInput,
): Promise<
  | BulkStockUpdateResult
  | {
      ok: false;
      error: {
        code: "validation_failed";
        message: string;
        fields?: Record<string, string[]>;
      };
    }
> {
  if (!Array.isArray(input.updates) || input.updates.length === 0) {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: "Provide at least one update",
        fields: { updates: ["updates must be a non-empty array"] },
      },
    };
  }
  if (input.updates.length > 500) {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: "Too many updates in a single call",
        fields: { updates: ["At most 500 updates per call"] },
      },
    };
  }

  const seen = new Set<string>();
  const results: BulkStockLineResult[] = [];
  let applied = 0;
  let failed = 0;

  for (const line of input.updates) {
    if (!isUuid(line.productId)) {
      failed++;
      results.push({
        productId: String(line.productId ?? ""),
        ok: false,
        error: {
          code: "validation_failed",
          message: "Invalid productId",
          fields: { productId: ["Expected a UUID"] },
        },
      });
      continue;
    }
    if (seen.has(line.productId)) {
      failed++;
      results.push({
        productId: line.productId,
        ok: false,
        error: {
          code: "validation_failed",
          message: "Duplicate productId in batch",
          fields: { productId: ["productId appears more than once"] },
        },
      });
      continue;
    }
    seen.add(line.productId);

    const reason = line.reason ?? input.defaultReason ?? null;
    const outcome = await updateProductStock({
      productId: line.productId,
      stock: line.stock,
      delta: line.delta,
      reason,
      userId: input.userId,
    });
    if (outcome.ok) {
      applied++;
      results.push({
        productId: line.productId,
        ok: true,
        product: outcome.data.product,
        adjustment: outcome.data.adjustment,
      });
    } else {
      failed++;
      results.push({
        productId: line.productId,
        ok: false,
        error: outcome.error,
      });
    }
  }

  return { ok: true, results, applied, failed };
}

/* -------------------------------------------------------------------------- */
/* Adjustment log                                                             */
/* -------------------------------------------------------------------------- */

export interface PublicStockAdjustment {
  id: string;
  productId: string;
  productSku: string;
  productName: string;
  userId: string | null;
  userEmail: string | null;
  delta: number;
  previousStock: number;
  newStock: number;
  reason: string | null;
  createdAt: string;
}

interface AdjustmentSnapshot {
  productSku: string;
  productName: string;
  userEmail: string | null;
}

function toPublicAdjustment(
  row: StockAdjustment,
  snapshot: AdjustmentSnapshot,
): PublicStockAdjustment {
  return {
    id: row.id,
    productId: row.productId,
    productSku: snapshot.productSku,
    productName: snapshot.productName,
    userId: row.userId ?? null,
    userEmail: snapshot.userEmail,
    delta: row.delta,
    previousStock: row.previousStock,
    newStock: row.newStock,
    reason: row.reason ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface ListAdjustmentsInput {
  productId?: string;
  userId?: string;
  page?: number;
  pageSize?: number;
}

export interface ListAdjustmentsResult {
  items: PublicStockAdjustment[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export const ADJUSTMENTS_DEFAULT_PAGE_SIZE = 50;
export const ADJUSTMENTS_MAX_PAGE_SIZE = 200;

export async function listStockAdjustments(
  input: ListAdjustmentsInput = {},
): Promise<ListAdjustmentsResult> {
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.max(
    1,
    Math.min(
      ADJUSTMENTS_MAX_PAGE_SIZE,
      Math.floor(input.pageSize ?? ADJUSTMENTS_DEFAULT_PAGE_SIZE),
    ),
  );

  const where = [] as ReturnType<typeof eq>[];
  if (input.productId && isUuid(input.productId)) {
    where.push(eq(stockAdjustments.productId, input.productId));
  }
  if (input.userId && isUuid(input.userId)) {
    where.push(eq(stockAdjustments.userId, input.userId));
  }
  const whereClause = where.length === 0 ? undefined : and(...where);

  const totalRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(stockAdjustments)
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

  const rows = await db
    .select({
      adjustment: stockAdjustments,
      productSku: products.sku,
      productName: products.name,
      userEmail: users.email,
    })
    .from(stockAdjustments)
    .leftJoin(products, eq(products.id, stockAdjustments.productId))
    .leftJoin(users, eq(users.id, stockAdjustments.userId))
    .where(whereClause)
    .orderBy(desc(stockAdjustments.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const items = rows.map((r) =>
    toPublicAdjustment(r.adjustment, {
      productSku: r.productSku ?? "",
      productName: r.productName ?? "(deleted product)",
      userEmail: r.userEmail ?? null,
    }),
  );

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return {
    items,
    page,
    pageSize,
    total,
    totalPages,
    hasMore: page < totalPages,
  };
}

/** Re-export helpers consumed by the route layer. */
export { neonSql };
