/**
 * Catalog query helpers.
 *
 * The browse API (`GET /api/products`) and product detail API
 * (`GET /api/products/{id}`) share these helpers so paging, sorting,
 * filtering, and the public response shape stay consistent.
 *
 * Highlights:
 * - Full-text search rides Postgres' `tsvector` column on `products`
 *   (defined by the SQL migration). Matches are ranked with `ts_rank`.
 * - Filters are inclusive (multi-value `size`, `material`, `color`,
 *   `category` are OR within field, AND across fields).
 * - Sorts are constrained to a known whitelist; arbitrary expressions
 *   are not accepted.
 */
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { db } from "@/lib/db";
import {
  categories,
  productImages,
  products,
  type Category,
  type Product,
  type ProductImage,
} from "@/lib/db/schema";

export type SortOption =
  | "price_asc"
  | "price_desc"
  | "newest"
  | "popularity"
  | "rating"
  | "relevance";

export const VALID_SORTS: readonly SortOption[] = [
  "price_asc",
  "price_desc",
  "newest",
  "popularity",
  "rating",
  "relevance",
] as const;

export type AvailabilityFilter = "in_stock" | "out_of_stock" | "all";

export const VALID_AVAILABILITY: readonly AvailabilityFilter[] = [
  "in_stock",
  "out_of_stock",
  "all",
] as const;

export interface ProductListFilters {
  q?: string;
  categorySlugs?: string[];
  priceMinCents?: number;
  priceMaxCents?: number;
  sizes?: string[];
  materials?: string[];
  colors?: string[];
  availability?: AvailabilityFilter;
  isFeatured?: boolean;
  isNew?: boolean;
}

export interface ProductListParams extends ProductListFilters {
  page: number;
  pageSize: number;
  sort: SortOption;
}

export interface PublicProduct {
  id: string;
  slug: string;
  sku: string;
  name: string;
  description: string;
  category: { id: string; slug: string; name: string } | null;
  priceCents: number;
  compareAtPriceCents: number | null;
  currency: string;
  size: string | null;
  material: string | null;
  color: string | null;
  stock: number;
  inStock: boolean;
  isFeatured: boolean;
  isNew: boolean;
  rating: { average: number; count: number };
  salesCount: number;
  primaryImageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicProductImage {
  id: string;
  url: string;
  alt: string | null;
  position: number;
}

export interface PublicProductDetail extends PublicProduct {
  /**
   * Full PDP image gallery, ordered by position ascending. The first
   * entry mirrors `primaryImageUrl` on the base product shape.
   */
  images: PublicProductImage[];
  /**
   * Recommendations shown on the PDP. Populated from products in the
   * same category, excluding this product, ordered by popularity. Empty
   * array if the product has no category or no peers.
   */
  related: PublicProduct[];
}

export interface ProductListResult {
  items: PublicProduct[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
  sort: SortOption;
}

const PAGE_SIZE_DEFAULT = 24;
const PAGE_SIZE_MAX = 100;

export function clampPageSize(input: number | undefined): number {
  if (!input || !Number.isFinite(input) || input <= 0) return PAGE_SIZE_DEFAULT;
  return Math.min(Math.floor(input), PAGE_SIZE_MAX);
}

export function clampPage(input: number | undefined): number {
  if (!input || !Number.isFinite(input) || input <= 0) return 1;
  return Math.floor(input);
}

/** UUID v4-ish detector — good enough to disambiguate id vs slug. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Build the WHERE clause for the product list query. Returns an SQL
 * fragment (or undefined when there are no constraints).
 *
 * Keeping the predicate construction separate from the rest of the
 * query lets the COUNT(*) query reuse it without duplication.
 */
function buildWhere(
  filters: ProductListFilters,
  categoryIds: string[] | null,
): SQL | undefined {
  const clauses: SQL[] = [];

  if (filters.q && filters.q.trim().length > 0) {
    clauses.push(
      sql`${products}.search_vector @@ plainto_tsquery('english', ${filters.q})`,
    );
  }

  if (categoryIds && categoryIds.length > 0) {
    clauses.push(inArray(products.categoryId, categoryIds));
  }

  if (typeof filters.priceMinCents === "number") {
    clauses.push(gte(products.priceCents, filters.priceMinCents));
  }
  if (typeof filters.priceMaxCents === "number") {
    clauses.push(lte(products.priceCents, filters.priceMaxCents));
  }

  if (filters.sizes && filters.sizes.length > 0) {
    clauses.push(inArray(products.size, filters.sizes));
  }
  if (filters.materials && filters.materials.length > 0) {
    clauses.push(inArray(products.material, filters.materials));
  }
  if (filters.colors && filters.colors.length > 0) {
    clauses.push(inArray(products.color, filters.colors));
  }

  if (filters.availability === "in_stock") {
    clauses.push(sql`${products.stock} > 0`);
  } else if (filters.availability === "out_of_stock") {
    clauses.push(sql`${products.stock} <= 0`);
  }

  if (filters.isFeatured === true) {
    clauses.push(eq(products.isFeatured, true));
  }
  if (filters.isNew === true) {
    clauses.push(eq(products.isNew, true));
  }

  if (clauses.length === 0) return undefined;
  return and(...clauses);
}

function buildOrderBy(sort: SortOption, q: string | undefined): SQL[] {
  switch (sort) {
    case "price_asc":
      return [asc(products.priceCents), desc(products.createdAt)];
    case "price_desc":
      return [desc(products.priceCents), desc(products.createdAt)];
    case "newest":
      return [desc(products.createdAt), desc(products.id)];
    case "popularity":
      return [desc(products.salesCount), desc(products.ratingAverage)];
    case "rating":
      return [desc(products.ratingAverage), desc(products.ratingCount)];
    case "relevance": {
      if (q && q.trim().length > 0) {
        return [
          sql`ts_rank(${products}.search_vector, plainto_tsquery('english', ${q})) DESC`,
          desc(products.salesCount),
        ];
      }
      // No query → "relevance" degrades gracefully into popularity.
      return [desc(products.salesCount), desc(products.createdAt)];
    }
    default:
      return [desc(products.createdAt)];
  }
}

/**
 * Resolve the supplied category slugs to ids. Unknown slugs are
 * filtered out — the resulting array is the actual filter input. If
 * caller passed slugs but none resolved, returns an empty array which
 * the query layer will translate to "no matches" so we don't silently
 * widen the search.
 */
async function resolveCategorySlugs(
  slugs: string[] | undefined,
): Promise<string[] | null> {
  if (!slugs || slugs.length === 0) return null;
  const rows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(inArray(categories.slug, slugs));
  return rows.map((r) => r.id);
}

interface ProductRow {
  product: Product;
  category: Category | null;
}

/**
 * Fetch the primary image URL (lowest position) for each product id in
 * one round trip. Used to enrich the list response without an N+1.
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

  // Pick the lowest-position image per product (ties broken by url).
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

export function toPublicProduct(
  row: ProductRow,
  primaryImageUrl: string | null,
): PublicProduct {
  const { product: p, category } = row;
  return {
    id: p.id,
    slug: p.slug,
    sku: p.sku,
    name: p.name,
    description: p.description,
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
    isFeatured: p.isFeatured,
    isNew: p.isNew,
    rating: {
      average: Number(p.ratingAverage ?? 0),
      count: p.ratingCount,
    },
    salesCount: p.salesCount,
    primaryImageUrl,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function listProducts(
  params: ProductListParams,
): Promise<ProductListResult> {
  const page = clampPage(params.page);
  const pageSize = clampPageSize(params.pageSize);
  const offset = (page - 1) * pageSize;

  const categoryIds = await resolveCategorySlugs(params.categorySlugs);

  // If the caller supplied category slugs but none matched, short-circuit.
  if (params.categorySlugs && params.categorySlugs.length > 0 && categoryIds && categoryIds.length === 0) {
    return {
      items: [],
      page,
      pageSize,
      total: 0,
      totalPages: 0,
      hasMore: false,
      sort: params.sort,
    };
  }

  const where = buildWhere(params, categoryIds);
  const orderBy = buildOrderBy(params.sort, params.q);

  // Total count.
  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(products)
    .where(where ?? sql`TRUE`);
  const total = countRows[0]?.count ?? 0;

  if (total === 0) {
    return {
      items: [],
      page,
      pageSize,
      total: 0,
      totalPages: 0,
      hasMore: false,
      sort: params.sort,
    };
  }

  // Page rows + category join.
  const rows = await db
    .select({
      product: products,
      category: categories,
    })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(where ?? sql`TRUE`)
    .orderBy(...orderBy)
    .limit(pageSize)
    .offset(offset);

  const productIds = rows.map((r) => r.product.id);
  const primaryImages = await fetchPrimaryImages(productIds);

  const items = rows.map((r) =>
    toPublicProduct(r, primaryImages.get(r.product.id) ?? null),
  );

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return {
    items,
    page,
    pageSize,
    total,
    totalPages,
    hasMore: page < totalPages,
    sort: params.sort,
  };
}

/** Default number of related products to surface on the PDP. */
export const RELATED_PRODUCTS_DEFAULT_LIMIT = 8;
/** Hard cap so an unbounded `limit` query param can't exhaust the DB. */
export const RELATED_PRODUCTS_MAX_LIMIT = 24;

export function clampRelatedLimit(input: number | undefined): number {
  if (!input || !Number.isFinite(input) || input <= 0) {
    return RELATED_PRODUCTS_DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(input), RELATED_PRODUCTS_MAX_LIMIT);
}

/**
 * Find products related to the given product. The catalog has no first-
 * class brand column, so "same brand" is approximated by matching on the
 * shared category (the canonical merchandising bucket). Tie-breakers
 * prefer SKUs with the same material or color so the recommendations
 * are visually/categorically cohesive without requiring an exact match.
 *
 * Always excludes the source product itself. If the source has no
 * category, returns an empty array — there is no useful signal to fall
 * back on with the current schema.
 */
export async function getRelatedProducts(
  source: Product,
  limit: number = RELATED_PRODUCTS_DEFAULT_LIMIT,
): Promise<PublicProduct[]> {
  if (!source.categoryId) return [];
  const cap = clampRelatedLimit(limit);

  // Score: +2 for same material, +2 for same color. Ties broken by
  // popularity (sales) and rating, then recency for stability.
  const sameMaterial = source.material
    ? sql<number>`CASE WHEN ${products.material} = ${source.material} THEN 2 ELSE 0 END`
    : sql<number>`0`;
  const sameColor = source.color
    ? sql<number>`CASE WHEN ${products.color} = ${source.color} THEN 2 ELSE 0 END`
    : sql<number>`0`;

  const rows = await db
    .select({
      product: products,
      category: categories,
      affinity: sql<number>`(${sameMaterial} + ${sameColor})`,
    })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(
      and(
        eq(products.categoryId, source.categoryId),
        ne(products.id, source.id),
      ),
    )
    .orderBy(
      sql`(${sameMaterial} + ${sameColor}) DESC`,
      desc(products.salesCount),
      desc(products.ratingAverage),
      desc(products.createdAt),
    )
    .limit(cap);

  if (rows.length === 0) return [];

  const productIds = rows.map((r) => r.product.id);
  const primaryImages = await fetchPrimaryImages(productIds);

  return rows.map((r) =>
    toPublicProduct(
      { product: r.product, category: r.category },
      primaryImages.get(r.product.id) ?? null,
    ),
  );
}

/**
 * Fetch a single product by either UUID or slug. Returns null if it
 * doesn't exist. Includes the full image gallery and a related-products
 * roster (same category, popularity-ordered) for the PDP.
 */
export async function getProductByIdOrSlug(
  idOrSlug: string,
  options: { relatedLimit?: number } = {},
): Promise<PublicProductDetail | null> {
  const predicate = isUuid(idOrSlug)
    ? eq(products.id, idOrSlug)
    : eq(products.slug, idOrSlug);

  const rows = await db
    .select({
      product: products,
      category: categories,
    })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(predicate)
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const [imageRows, related] = await Promise.all([
    db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, row.product.id))
      .orderBy(asc(productImages.position), asc(productImages.createdAt)),
    getRelatedProducts(
      row.product,
      clampRelatedLimit(options.relatedLimit),
    ),
  ]);

  const typedImages: ProductImage[] = imageRows;
  const primary = typedImages[0]?.url ?? null;
  const base = toPublicProduct(row, primary);

  return {
    ...base,
    images: typedImages.map((img) => ({
      id: img.id,
      url: img.url,
      alt: img.alt ?? null,
      position: img.position,
    })),
    related,
  };
}

/**
 * Lightweight "duplicate slug allowed?" prober used by potential admin
 * surfaces. Exported here for completeness; not currently wired to a
 * route handler.
 */
export async function findProductBySku(sku: string): Promise<Product | null> {
  const rows = await db
    .select()
    .from(products)
    .where(eq(products.sku, sku))
    .limit(1);
  return rows[0] ?? null;
}

/** Suppress unused-import warnings if a consumer drops one of the helpers. */
export const _internalSqlHelpers = { or };
