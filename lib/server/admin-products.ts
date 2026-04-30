/**
 * Admin-only CRUD helpers for products and product images.
 *
 * Public reads happen in `lib/server/products.ts`; admin writes live here
 * so the route layer (`app/api/admin/products/**`) stays thin. Every
 * helper:
 *
 *   - Validates input up front and returns a typed error on failure
 *     (the route layer maps the error to an HTTP status without
 *     leaking DB details).
 *   - Normalises slug, sku, and string fields so storage stays canonical
 *     regardless of which admin client is on the other end.
 *   - Touches `products.updatedAt` on every mutation so the public listing
 *     queries can sort or invalidate caches by mtime.
 *
 * Image rows are managed alongside the parent product. The create path
 * accepts an `images` array; updates can append, replace, or delete via
 * dedicated endpoints. The blob/CDN lifecycle is intentionally decoupled
 * from the DB rows — the upload route returns a URL that callers store
 * here, and the delete path tries (best-effort) to remove the underlying
 * blob via `deleteImage`.
 */
import { and, asc, desc, eq, ilike, ne, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  categories,
  productImages,
  products,
  type Category,
  type NewProduct,
  type NewProductImage,
  type Product,
} from "@/lib/db/schema";
import {
  toPublicProduct as toPublicProductRow,
  type PublicProduct,
} from "@/lib/server/products";
import { deleteImage } from "@/lib/server/blob";

/** Hard caps on product fields. The DB columns enforce most of these
 *  too; surfacing them here lets the validator return precise messages
 *  before round-tripping to Postgres. */
export const PRODUCT_LIMITS = {
  slugMin: 2,
  slugMax: 200,
  skuMin: 2,
  skuMax: 64,
  nameMin: 2,
  nameMax: 300,
  descriptionMax: 20_000,
  priceMaxCents: 100_000_00, // ten million dollars
  stockMax: 10_000_000,
  variantMax: 64,
  imagesMax: 24,
} as const;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKU_PATTERN = /^[A-Z0-9][A-Z0-9_-]*$/;

export function normalizeSlug(raw: string): string {
  return raw
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Image payload accepted on create/update. `url` is the only required
 * field; everything else is optional. `position` controls gallery
 * ordering — when omitted, rows are appended in input order.
 */
export interface ProductImageInput {
  url: string;
  alt?: string | null;
  position?: number | null;
}

/**
 * Public payload returned by every admin product endpoint. It is the
 * public catalog shape (so the admin and the storefront agree on
 * vocabulary) plus the full image gallery.
 */
export interface AdminProduct extends PublicProduct {
  images: Array<{
    id: string;
    url: string;
    alt: string | null;
    position: number;
  }>;
}

export interface CreateProductInput {
  slug: string;
  sku: string;
  name: string;
  description?: string;
  categoryId?: string | null;
  priceCents: number;
  compareAtPriceCents?: number | null;
  currency?: string;
  size?: string | null;
  material?: string | null;
  color?: string | null;
  stock?: number;
  isFeatured?: boolean;
  isNew?: boolean;
  images?: ProductImageInput[];
}

export interface UpdateProductInput {
  slug?: string;
  sku?: string;
  name?: string;
  description?: string;
  categoryId?: string | null;
  priceCents?: number;
  compareAtPriceCents?: number | null;
  currency?: string;
  size?: string | null;
  material?: string | null;
  color?: string | null;
  stock?: number;
  isFeatured?: boolean;
  isNew?: boolean;
  /**
   * When provided, replaces the product's image gallery wholesale. Any
   * existing rows are deleted (and their blobs best-effort removed).
   * Pass `undefined` to leave images untouched.
   */
  images?: ProductImageInput[];
}

export type ProductMutationError =
  | { code: "not_found" }
  | { code: "slug_taken"; slug: string }
  | { code: "sku_taken"; sku: string }
  | { code: "category_not_found"; categoryId: string }
  | {
      code: "validation_failed";
      message: string;
      fields?: Record<string, string[]>;
    };

export type ProductMutationResult<T = AdminProduct> =
  | { ok: true; data: T }
  | { ok: false; error: ProductMutationError };

function pushError(
  fields: Record<string, string[]>,
  key: string,
  message: string,
) {
  if (!fields[key]) fields[key] = [];
  fields[key].push(message);
}

interface ValidatedProductFields {
  slug?: string;
  sku?: string;
  name?: string;
  description?: string;
  categoryId?: string | null;
  priceCents?: number;
  compareAtPriceCents?: number | null;
  currency?: string;
  size?: string | null;
  material?: string | null;
  color?: string | null;
  stock?: number;
  isFeatured?: boolean;
  isNew?: boolean;
  images?: ProductImageInput[];
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function clampString(
  raw: unknown,
  field: string,
  min: number,
  max: number,
  fields: Record<string, string[]>,
): string | undefined {
  if (typeof raw !== "string") {
    pushError(fields, field, `${field} must be a string`);
    return undefined;
  }
  const trimmed = raw.trim();
  if (trimmed.length < min) {
    pushError(fields, field, `${field} must be at least ${min} characters`);
    return undefined;
  }
  if (trimmed.length > max) {
    pushError(fields, field, `${field} must be at most ${max} characters`);
    return undefined;
  }
  return trimmed;
}

function validateImage(
  raw: unknown,
  index: number,
  fields: Record<string, string[]>,
): ProductImageInput | undefined {
  const key = `images[${index}]`;
  if (!raw || typeof raw !== "object") {
    pushError(fields, key, "Image must be an object");
    return undefined;
  }
  const img = raw as Record<string, unknown>;
  if (typeof img.url !== "string" || img.url.trim().length === 0) {
    pushError(fields, `${key}.url`, "url is required");
    return undefined;
  }
  const url = img.url.trim();
  if (url.length > 2048) {
    pushError(fields, `${key}.url`, "url is too long (max 2048)");
    return undefined;
  }
  let alt: string | null | undefined;
  if (img.alt === null || img.alt === undefined) {
    alt = null;
  } else if (typeof img.alt !== "string") {
    pushError(fields, `${key}.alt`, "alt must be a string or null");
    return undefined;
  } else {
    const trimmed = img.alt.trim();
    if (trimmed.length > 300) {
      pushError(fields, `${key}.alt`, "alt is too long (max 300)");
      return undefined;
    }
    alt = trimmed.length === 0 ? null : trimmed;
  }
  let position: number | null | undefined;
  if (img.position === undefined || img.position === null) {
    position = null;
  } else if (
    typeof img.position !== "number" ||
    !Number.isFinite(img.position) ||
    !Number.isInteger(img.position) ||
    img.position < 0 ||
    img.position > 1000
  ) {
    pushError(
      fields,
      `${key}.position`,
      "position must be a non-negative integer (max 1000)",
    );
    return undefined;
  } else {
    position = img.position;
  }
  return { url, alt, position };
}

function validateImageList(
  raw: unknown,
  fields: Record<string, string[]>,
): ProductImageInput[] | undefined {
  if (!Array.isArray(raw)) {
    pushError(fields, "images", "images must be an array");
    return undefined;
  }
  if (raw.length > PRODUCT_LIMITS.imagesMax) {
    pushError(
      fields,
      "images",
      `Cannot attach more than ${PRODUCT_LIMITS.imagesMax} images`,
    );
    return undefined;
  }
  const out: ProductImageInput[] = [];
  for (let i = 0; i < raw.length; i++) {
    const v = validateImage(raw[i], i, fields);
    if (v) out.push(v);
  }
  return out;
}

function validatePayload(
  input: CreateProductInput | UpdateProductInput,
  mode: "create" | "update",
):
  | { ok: true; values: ValidatedProductFields }
  | { ok: false; error: ProductMutationError } {
  const fields: Record<string, string[]> = {};
  const out: ValidatedProductFields = {};

  // slug
  if (input.slug !== undefined) {
    const cleaned = clampString(
      input.slug,
      "slug",
      PRODUCT_LIMITS.slugMin,
      PRODUCT_LIMITS.slugMax,
      fields,
    );
    if (cleaned !== undefined) {
      const normalized = normalizeSlug(cleaned);
      if (!SLUG_PATTERN.test(normalized)) {
        pushError(
          fields,
          "slug",
          "slug must be lower-case alphanumerics with single dashes",
        );
      } else {
        out.slug = normalized;
      }
    }
  } else if (mode === "create") {
    pushError(fields, "slug", "slug is required");
  }

  // sku
  if (input.sku !== undefined) {
    const cleaned = clampString(
      input.sku,
      "sku",
      PRODUCT_LIMITS.skuMin,
      PRODUCT_LIMITS.skuMax,
      fields,
    );
    if (cleaned !== undefined) {
      const normalized = normalizeSku(cleaned);
      if (!SKU_PATTERN.test(normalized)) {
        pushError(
          fields,
          "sku",
          "sku must contain only uppercase letters, digits, '-' or '_' and start with an alphanumeric",
        );
      } else {
        out.sku = normalized;
      }
    }
  } else if (mode === "create") {
    pushError(fields, "sku", "sku is required");
  }

  // name
  if (input.name !== undefined) {
    const cleaned = clampString(
      input.name,
      "name",
      PRODUCT_LIMITS.nameMin,
      PRODUCT_LIMITS.nameMax,
      fields,
    );
    if (cleaned !== undefined) out.name = cleaned;
  } else if (mode === "create") {
    pushError(fields, "name", "name is required");
  }

  // description (optional everywhere; default "")
  if (input.description !== undefined) {
    if (typeof input.description !== "string") {
      pushError(fields, "description", "description must be a string");
    } else if (input.description.length > PRODUCT_LIMITS.descriptionMax) {
      pushError(
        fields,
        "description",
        `description must be at most ${PRODUCT_LIMITS.descriptionMax} characters`,
      );
    } else {
      out.description = input.description;
    }
  }

  // categoryId
  if (input.categoryId !== undefined) {
    if (input.categoryId === null) {
      out.categoryId = null;
    } else if (!isUuid(input.categoryId)) {
      pushError(fields, "categoryId", "categoryId must be a UUID or null");
    } else {
      out.categoryId = input.categoryId;
    }
  }

  // priceCents
  if (input.priceCents !== undefined) {
    if (
      !Number.isFinite(input.priceCents) ||
      !Number.isInteger(input.priceCents) ||
      input.priceCents < 0 ||
      input.priceCents > PRODUCT_LIMITS.priceMaxCents
    ) {
      pushError(
        fields,
        "priceCents",
        `priceCents must be a non-negative integer (cents) up to ${PRODUCT_LIMITS.priceMaxCents}`,
      );
    } else {
      out.priceCents = input.priceCents;
    }
  } else if (mode === "create") {
    pushError(fields, "priceCents", "priceCents is required");
  }

  // compareAtPriceCents
  if (input.compareAtPriceCents !== undefined) {
    if (input.compareAtPriceCents === null) {
      out.compareAtPriceCents = null;
    } else if (
      !Number.isFinite(input.compareAtPriceCents) ||
      !Number.isInteger(input.compareAtPriceCents) ||
      input.compareAtPriceCents < 0 ||
      input.compareAtPriceCents > PRODUCT_LIMITS.priceMaxCents
    ) {
      pushError(
        fields,
        "compareAtPriceCents",
        `compareAtPriceCents must be a non-negative integer (cents) up to ${PRODUCT_LIMITS.priceMaxCents} or null`,
      );
    } else {
      out.compareAtPriceCents = input.compareAtPriceCents;
    }
  }

  // currency (3-letter ISO)
  if (input.currency !== undefined) {
    if (
      typeof input.currency !== "string" ||
      !/^[A-Z]{3}$/.test(input.currency.trim().toUpperCase())
    ) {
      pushError(fields, "currency", "currency must be a 3-letter ISO code");
    } else {
      out.currency = input.currency.trim().toUpperCase();
    }
  }

  // size / material / color
  for (const key of ["size", "material", "color"] as const) {
    if (input[key] !== undefined) {
      const value = input[key];
      if (value === null) {
        out[key] = null;
      } else if (typeof value !== "string") {
        pushError(fields, key, `${key} must be a string or null`);
      } else {
        const trimmed = value.trim();
        if (trimmed.length === 0) {
          out[key] = null;
        } else if (trimmed.length > PRODUCT_LIMITS.variantMax) {
          pushError(
            fields,
            key,
            `${key} must be at most ${PRODUCT_LIMITS.variantMax} characters`,
          );
        } else {
          out[key] = trimmed;
        }
      }
    }
  }

  // stock
  if (input.stock !== undefined) {
    if (
      !Number.isFinite(input.stock) ||
      !Number.isInteger(input.stock) ||
      input.stock < 0 ||
      input.stock > PRODUCT_LIMITS.stockMax
    ) {
      pushError(
        fields,
        "stock",
        `stock must be a non-negative integer up to ${PRODUCT_LIMITS.stockMax}`,
      );
    } else {
      out.stock = input.stock;
    }
  }

  // isFeatured / isNew
  for (const key of ["isFeatured", "isNew"] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== "boolean") {
        pushError(fields, key, `${key} must be a boolean`);
      } else {
        out[key] = input[key];
      }
    }
  }

  // images
  if (input.images !== undefined) {
    const validated = validateImageList(input.images, fields);
    if (validated) out.images = validated;
  }

  if (Object.keys(fields).length > 0) {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: "Invalid product payload",
        fields,
      },
    };
  }
  return { ok: true, values: out };
}

/** One round trip: load the product + its category + every image row. */
async function loadAdminProduct(productId: string): Promise<AdminProduct | null> {
  const productRows = await db
    .select({ product: products, category: categories })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(eq(products.id, productId))
    .limit(1);

  const row = productRows[0];
  if (!row) return null;

  const imageRows = await db
    .select()
    .from(productImages)
    .where(eq(productImages.productId, productId))
    .orderBy(asc(productImages.position), asc(productImages.createdAt));

  const primary = imageRows[0]?.url ?? null;
  const base = toPublicProductRow(
    { product: row.product, category: row.category },
    primary,
  );

  return {
    ...base,
    images: imageRows.map((img) => ({
      id: img.id,
      url: img.url,
      alt: img.alt ?? null,
      position: img.position,
    })),
  };
}

/**
 * Insert image rows for a freshly created product. Position defaults to
 * the input index when not supplied. Skips an empty input array.
 */
async function insertImageRows(
  productId: string,
  images: ProductImageInput[],
): Promise<void> {
  if (images.length === 0) return;
  const values: NewProductImage[] = images.map((img, idx) => ({
    productId,
    url: img.url,
    alt: img.alt ?? null,
    position: img.position ?? idx,
  }));
  await db.insert(productImages).values(values);
}

/** Load category ids exist? — used by the validator to avoid FK errors. */
async function categoryExists(categoryId: string): Promise<boolean> {
  const rows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .limit(1);
  return rows.length === 1;
}

export interface ListAdminProductsInput {
  q?: string;
  page?: number;
  pageSize?: number;
  isFeatured?: boolean;
  isNew?: boolean;
  categoryId?: string;
}

export interface ListAdminProductsResult {
  items: AdminProduct[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export const ADMIN_PRODUCTS_DEFAULT_PAGE_SIZE = 25;
export const ADMIN_PRODUCTS_MAX_PAGE_SIZE = 100;

export async function listAdminProducts(
  input: ListAdminProductsInput = {},
): Promise<ListAdminProductsResult> {
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.max(
    1,
    Math.min(
      ADMIN_PRODUCTS_MAX_PAGE_SIZE,
      Math.floor(input.pageSize ?? ADMIN_PRODUCTS_DEFAULT_PAGE_SIZE),
    ),
  );

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
  if (input.isFeatured === true) {
    where.push(eq(products.isFeatured, true));
  }
  if (input.isNew === true) {
    where.push(eq(products.isNew, true));
  }
  if (input.categoryId && isUuid(input.categoryId)) {
    where.push(eq(products.categoryId, input.categoryId));
  }
  const whereClause = where.length === 0 ? undefined : and(...where);

  const totalRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(products)
    .where(whereClause);
  const total = totalRows[0]?.count ?? 0;

  if (total === 0) {
    return { items: [], page, pageSize, total: 0, totalPages: 0, hasMore: false };
  }

  const rows = await db
    .select({ id: products.id })
    .from(products)
    .where(whereClause)
    .orderBy(desc(products.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const items: AdminProduct[] = [];
  for (const r of rows) {
    const full = await loadAdminProduct(r.id);
    if (full) items.push(full);
  }

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

export async function getAdminProduct(
  idOrSlug: string,
): Promise<AdminProduct | null> {
  const predicate = isUuid(idOrSlug)
    ? eq(products.id, idOrSlug)
    : eq(products.slug, idOrSlug);

  const rows = await db
    .select({ id: products.id })
    .from(products)
    .where(predicate)
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return loadAdminProduct(row.id);
}

export async function createProduct(
  input: CreateProductInput,
): Promise<ProductMutationResult> {
  const validated = validatePayload(input, "create");
  if (!validated.ok) return validated;
  const v = validated.values;

  if (v.categoryId && !(await categoryExists(v.categoryId))) {
    return {
      ok: false,
      error: { code: "category_not_found", categoryId: v.categoryId },
    };
  }

  const insertValues: NewProduct = {
    slug: v.slug!,
    sku: v.sku!,
    name: v.name!,
    description: v.description ?? "",
    categoryId: v.categoryId ?? null,
    priceCents: v.priceCents!,
    compareAtPriceCents: v.compareAtPriceCents ?? null,
    currency: v.currency ?? "USD",
    size: v.size ?? null,
    material: v.material ?? null,
    color: v.color ?? null,
    stock: v.stock ?? 0,
    isFeatured: v.isFeatured ?? false,
    isNew: v.isNew ?? false,
  };

  let inserted: Product;
  try {
    const rows = await db.insert(products).values(insertValues).returning();
    if (!rows[0]) {
      return {
        ok: false,
        error: { code: "validation_failed", message: "Insert returned no row" },
      };
    }
    inserted = rows[0];
  } catch (err) {
    return mapInsertError(err, insertValues.slug, insertValues.sku);
  }

  if (v.images && v.images.length > 0) {
    try {
      await insertImageRows(inserted.id, v.images);
    } catch (err) {
      // Best effort rollback — Drizzle's HTTP driver doesn't expose a
      // `tx()` for us, so we hand-roll the cleanup. Subsequent reads
      // will see no orphan product.
      await db.delete(products).where(eq(products.id, inserted.id));
      throw err;
    }
  }

  const full = await loadAdminProduct(inserted.id);
  if (!full) {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: "Inserted product disappeared",
      },
    };
  }
  return { ok: true, data: full };
}

function mapInsertError(
  err: unknown,
  slug: string,
  sku: string,
): ProductMutationResult {
  const message = err instanceof Error ? err.message : String(err);
  if (/duplicate|unique/i.test(message)) {
    if (/sku/i.test(message)) {
      return { ok: false, error: { code: "sku_taken", sku } };
    }
    if (/slug/i.test(message)) {
      return { ok: false, error: { code: "slug_taken", slug } };
    }
    // Default to slug when we can't tell — admin can retry with a
    // different slug if it was actually the sku.
    return { ok: false, error: { code: "slug_taken", slug } };
  }
  throw err;
}

export async function updateProduct(
  id: string,
  input: UpdateProductInput,
): Promise<ProductMutationResult> {
  if (!isUuid(id)) return { ok: false, error: { code: "not_found" } };

  const existing = await db
    .select()
    .from(products)
    .where(eq(products.id, id))
    .limit(1);
  if (existing.length === 0) return { ok: false, error: { code: "not_found" } };
  const current = existing[0];

  const validated = validatePayload(input, "update");
  if (!validated.ok) return validated;
  const v = validated.values;

  // Cross-field unique pre-check (skip when slug/sku unchanged).
  if (v.slug !== undefined && v.slug !== current.slug) {
    const conflict = await db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.slug, v.slug), ne(products.id, id)))
      .limit(1);
    if (conflict.length > 0) {
      return { ok: false, error: { code: "slug_taken", slug: v.slug } };
    }
  }
  if (v.sku !== undefined && v.sku !== current.sku) {
    const conflict = await db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.sku, v.sku), ne(products.id, id)))
      .limit(1);
    if (conflict.length > 0) {
      return { ok: false, error: { code: "sku_taken", sku: v.sku } };
    }
  }

  if (
    v.categoryId !== undefined &&
    v.categoryId !== null &&
    !(await categoryExists(v.categoryId))
  ) {
    return {
      ok: false,
      error: { code: "category_not_found", categoryId: v.categoryId },
    };
  }

  const patch: Partial<NewProduct> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (v.slug !== undefined) patch.slug = v.slug;
  if (v.sku !== undefined) patch.sku = v.sku;
  if (v.name !== undefined) patch.name = v.name;
  if (v.description !== undefined) patch.description = v.description;
  if (v.categoryId !== undefined) patch.categoryId = v.categoryId;
  if (v.priceCents !== undefined) patch.priceCents = v.priceCents;
  if (v.compareAtPriceCents !== undefined)
    patch.compareAtPriceCents = v.compareAtPriceCents;
  if (v.currency !== undefined) patch.currency = v.currency;
  if (v.size !== undefined) patch.size = v.size;
  if (v.material !== undefined) patch.material = v.material;
  if (v.color !== undefined) patch.color = v.color;
  if (v.stock !== undefined) patch.stock = v.stock;
  if (v.isFeatured !== undefined) patch.isFeatured = v.isFeatured;
  if (v.isNew !== undefined) patch.isNew = v.isNew;

  // Only fire UPDATE when something other than updatedAt changed.
  const fieldsTouched = Object.keys(patch).length;
  if (fieldsTouched > 1) {
    try {
      await db.update(products).set(patch).where(eq(products.id, id));
    } catch (err) {
      return mapInsertError(err, patch.slug ?? current.slug, patch.sku ?? current.sku);
    }
  }

  // Replace image gallery if explicitly provided.
  if (v.images !== undefined) {
    const oldRows = await db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, id));
    await db.delete(productImages).where(eq(productImages.productId, id));
    await insertImageRows(id, v.images);
    // Best-effort blob cleanup for URLs no longer referenced.
    const survivingUrls = new Set(v.images.map((i) => i.url));
    for (const old of oldRows) {
      if (!survivingUrls.has(old.url)) {
        await deleteImage(old.url);
      }
    }
  }

  const full = await loadAdminProduct(id);
  if (!full) return { ok: false, error: { code: "not_found" } };
  return { ok: true, data: full };
}

/**
 * Hard delete a product. Cascade rules on `product_images`,
 * `wishlist_items`, `cart_items`, and `reviews` clean up dependents.
 * Order line items reference the product softly (set-null) so deleting
 * a product does NOT erase order history.
 *
 * Best-effort: also walks the deleted images and removes their blobs.
 */
export async function deleteProduct(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const oldImages = await db
    .select()
    .from(productImages)
    .where(eq(productImages.productId, id));

  const removed = await db
    .delete(products)
    .where(eq(products.id, id))
    .returning({ id: products.id });
  if (removed.length === 0) return false;

  for (const img of oldImages) await deleteImage(img.url);
  return true;
}

export interface AddImagesInput {
  images: ProductImageInput[];
}

export type AddImagesResult =
  | { ok: true; data: AdminProduct }
  | {
      ok: false;
      error:
        | { code: "not_found" }
        | {
            code: "validation_failed";
            message: string;
            fields?: Record<string, string[]>;
          };
    };

/** Append image rows to an existing product. Positions auto-increment if
 *  not provided so the new rows land at the end of the gallery. */
export async function addProductImages(
  productId: string,
  input: AddImagesInput,
): Promise<AddImagesResult> {
  if (!isUuid(productId)) return { ok: false, error: { code: "not_found" } };

  const fields: Record<string, string[]> = {};
  const validated = validateImageList(input.images, fields);
  if (!validated || Object.keys(fields).length > 0) {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: "Invalid images payload",
        fields,
      },
    };
  }
  if (validated.length === 0) {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: "Provide at least one image",
      },
    };
  }

  const existing = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  if (existing.length === 0) return { ok: false, error: { code: "not_found" } };

  // Compute next position for inputs that omitted one.
  const maxRows = await db
    .select({ position: productImages.position })
    .from(productImages)
    .where(eq(productImages.productId, productId))
    .orderBy(desc(productImages.position))
    .limit(1);
  const startAt = (maxRows[0]?.position ?? -1) + 1;

  const rows: NewProductImage[] = validated.map((img, idx) => ({
    productId,
    url: img.url,
    alt: img.alt ?? null,
    position: img.position ?? startAt + idx,
  }));
  await db.insert(productImages).values(rows);

  // Bump product updatedAt so downstream caches see the change.
  await db
    .update(products)
    .set({ updatedAt: new Date() })
    .where(eq(products.id, productId));

  const full = await loadAdminProduct(productId);
  if (!full) return { ok: false, error: { code: "not_found" } };
  return { ok: true, data: full };
}

export type DeleteImageResult =
  | { ok: true; data: AdminProduct }
  | { ok: false; error: { code: "not_found" } };

/** Remove a single image row and (best-effort) its underlying blob. */
export async function deleteProductImage(
  productId: string,
  imageId: string,
): Promise<DeleteImageResult> {
  if (!isUuid(productId) || !isUuid(imageId)) {
    return { ok: false, error: { code: "not_found" } };
  }

  const rows = await db
    .select()
    .from(productImages)
    .where(
      and(
        eq(productImages.id, imageId),
        eq(productImages.productId, productId),
      ),
    )
    .limit(1);
  const target = rows[0];
  if (!target) return { ok: false, error: { code: "not_found" } };

  await db.delete(productImages).where(eq(productImages.id, imageId));
  await db
    .update(products)
    .set({ updatedAt: new Date() })
    .where(eq(products.id, productId));

  await deleteImage(target.url);

  const full = await loadAdminProduct(productId);
  if (!full) return { ok: false, error: { code: "not_found" } };
  return { ok: true, data: full };
}

/**
 * Used by image-list reorder endpoints. Each entry must reference an
 * image that already belongs to the product; unknown ids return a
 * validation error.
 */
export interface ReorderImagesInput {
  order: Array<{ id: string; position: number }>;
}

export type ReorderImagesResult =
  | { ok: true; data: AdminProduct }
  | {
      ok: false;
      error:
        | { code: "not_found" }
        | {
            code: "validation_failed";
            message: string;
            fields?: Record<string, string[]>;
          };
    };

export async function reorderProductImages(
  productId: string,
  input: ReorderImagesInput,
): Promise<ReorderImagesResult> {
  if (!isUuid(productId)) return { ok: false, error: { code: "not_found" } };

  const fields: Record<string, string[]> = {};
  if (!Array.isArray(input.order) || input.order.length === 0) {
    pushError(fields, "order", "order must be a non-empty array");
  }
  if (Object.keys(fields).length > 0) {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: "Invalid reorder payload",
        fields,
      },
    };
  }

  const existing = await db
    .select({ id: productImages.id })
    .from(productImages)
    .where(eq(productImages.productId, productId));
  const known = new Set(existing.map((r) => r.id));

  for (const entry of input.order) {
    if (!isUuid(entry.id) || !known.has(entry.id)) {
      pushError(fields, "order", `Unknown image id: ${entry.id}`);
    }
    if (
      typeof entry.position !== "number" ||
      !Number.isInteger(entry.position) ||
      entry.position < 0
    ) {
      pushError(fields, "order", `Invalid position for ${entry.id}`);
    }
  }
  if (Object.keys(fields).length > 0) {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: "Invalid reorder payload",
        fields,
      },
    };
  }

  for (const entry of input.order) {
    await db
      .update(productImages)
      .set({ position: entry.position })
      .where(
        and(
          eq(productImages.id, entry.id),
          eq(productImages.productId, productId),
        ),
      );
  }

  await db
    .update(products)
    .set({ updatedAt: new Date() })
    .where(eq(products.id, productId));

  const full = await loadAdminProduct(productId);
  if (!full) return { ok: false, error: { code: "not_found" } };
  return { ok: true, data: full };
}

/** Re-export so the route layer's error mapper can branch on this set. */
export type { Category, Product };
