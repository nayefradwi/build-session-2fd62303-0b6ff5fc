/**
 * Admin-only CRUD helpers for the product taxonomy.
 *
 * Categories are slug-keyed (so URLs can reference them without exposing
 * UUIDs) and form a one-or-more-level tree via the self-referential
 * `parentId` column. The helpers below:
 *
 *   - Validate slug + name + optional parent up front and return a typed
 *     error on failure.
 *   - Pre-check unique slug conflicts so the route layer can map them
 *     to a 409 with a clear message instead of a generic constraint
 *     violation.
 *   - Refuse to create a parent cycle on update (a category cannot be
 *     its own ancestor).
 *   - Decorate the public payload with a `productCount` so the admin
 *     table can show "12 products" without an N+1 dance on the client.
 *
 * Public catalog reads (the `?category=slug` filter on /api/products)
 * pull straight from the same tables, so any admin write here surfaces
 * to shoppers on the next request.
 */
import { and, asc, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  categories,
  products,
  type Category,
  type NewCategory,
} from "@/lib/db/schema";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_PATTERN = /^[a-z0-9]+(?:[/-][a-z0-9]+)*$/;

/** Hard caps. Mirror the DB column lengths so validation surfaces a nice
 *  message before the insert ever hits Postgres. */
export const CATEGORY_LIMITS = {
  slugMin: 2,
  slugMax: 120,
  nameMin: 1,
  nameMax: 200,
  descriptionMax: 5_000,
} as const;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function normalizeCategorySlug(raw: string): string {
  return raw
    .normalize("NFKD")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9/-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/^[-/]+|[-/]+$/g, "");
}

export interface AdminCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  parentId: string | null;
  productCount: number;
  createdAt: string;
  updatedAt: string;
}

export type CategoryMutationError =
  | { code: "not_found" }
  | { code: "slug_taken"; slug: string }
  | { code: "parent_not_found"; parentId: string }
  | { code: "parent_cycle"; parentId: string }
  | {
      code: "validation_failed";
      message: string;
      fields?: Record<string, string[]>;
    }
  | { code: "in_use"; productCount: number };

export type CategoryMutationResult<T = AdminCategory> =
  | { ok: true; data: T }
  | { ok: false; error: CategoryMutationError };

export interface CreateCategoryInput {
  slug: string;
  name: string;
  description?: string | null;
  parentId?: string | null;
}

export interface UpdateCategoryInput {
  slug?: string;
  name?: string;
  description?: string | null;
  parentId?: string | null;
}

interface ValidatedCategoryFields {
  slug?: string;
  name?: string;
  description?: string | null;
  parentId?: string | null;
}

function pushError(
  fields: Record<string, string[]>,
  key: string,
  message: string,
) {
  if (!fields[key]) fields[key] = [];
  fields[key].push(message);
}

function validatePayload(
  input: CreateCategoryInput | UpdateCategoryInput,
  mode: "create" | "update",
):
  | { ok: true; values: ValidatedCategoryFields }
  | { ok: false; error: CategoryMutationError } {
  const fields: Record<string, string[]> = {};
  const out: ValidatedCategoryFields = {};

  if (input.slug !== undefined) {
    if (typeof input.slug !== "string") {
      pushError(fields, "slug", "slug must be a string");
    } else {
      const normalized = normalizeCategorySlug(input.slug);
      if (
        normalized.length < CATEGORY_LIMITS.slugMin ||
        normalized.length > CATEGORY_LIMITS.slugMax
      ) {
        pushError(
          fields,
          "slug",
          `slug must be between ${CATEGORY_LIMITS.slugMin} and ${CATEGORY_LIMITS.slugMax} characters`,
        );
      } else if (!SLUG_PATTERN.test(normalized)) {
        pushError(
          fields,
          "slug",
          "slug must contain lower-case alphanumerics, '-' or '/' separators only",
        );
      } else {
        out.slug = normalized;
      }
    }
  } else if (mode === "create") {
    pushError(fields, "slug", "slug is required");
  }

  if (input.name !== undefined) {
    if (typeof input.name !== "string") {
      pushError(fields, "name", "name must be a string");
    } else {
      const trimmed = input.name.trim();
      if (
        trimmed.length < CATEGORY_LIMITS.nameMin ||
        trimmed.length > CATEGORY_LIMITS.nameMax
      ) {
        pushError(
          fields,
          "name",
          `name must be between ${CATEGORY_LIMITS.nameMin} and ${CATEGORY_LIMITS.nameMax} characters`,
        );
      } else {
        out.name = trimmed;
      }
    }
  } else if (mode === "create") {
    pushError(fields, "name", "name is required");
  }

  if (input.description !== undefined) {
    if (input.description === null) {
      out.description = null;
    } else if (typeof input.description !== "string") {
      pushError(fields, "description", "description must be a string or null");
    } else {
      const trimmed = input.description.trim();
      if (trimmed.length === 0) {
        out.description = null;
      } else if (trimmed.length > CATEGORY_LIMITS.descriptionMax) {
        pushError(
          fields,
          "description",
          `description must be at most ${CATEGORY_LIMITS.descriptionMax} characters`,
        );
      } else {
        out.description = trimmed;
      }
    }
  }

  if (input.parentId !== undefined) {
    if (input.parentId === null) {
      out.parentId = null;
    } else if (!isUuid(input.parentId)) {
      pushError(fields, "parentId", "parentId must be a UUID or null");
    } else {
      out.parentId = input.parentId;
    }
  }

  if (Object.keys(fields).length > 0) {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: "Invalid category payload",
        fields,
      },
    };
  }
  return { ok: true, values: out };
}

/** Count of products currently bucketed under each category id. */
async function countProductsByCategory(
  ids: string[],
): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      categoryId: products.categoryId,
      count: sql<number>`count(*)::int`,
    })
    .from(products)
    .where(inArray(products.categoryId, ids))
    .groupBy(products.categoryId);
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r.categoryId) out.set(r.categoryId, r.count);
  }
  return out;
}

function toAdminCategory(row: Category, productCount: number): AdminCategory {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? null,
    parentId: row.parentId ?? null,
    productCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface ListCategoriesInput {
  q?: string;
  /** When true, restricts to top-level (parent IS NULL) rows. */
  topLevelOnly?: boolean;
}

export interface ListCategoriesResult {
  items: AdminCategory[];
  total: number;
}

export async function listCategories(
  input: ListCategoriesInput = {},
): Promise<ListCategoriesResult> {
  const where = [] as ReturnType<typeof eq>[];
  if (input.q && input.q.trim().length > 0) {
    const term = `%${input.q.trim()}%`;
    const combined = or(
      ilike(categories.name, term),
      ilike(categories.slug, term),
    );
    if (combined) where.push(combined as ReturnType<typeof eq>);
  }
  if (input.topLevelOnly) {
    where.push(isNull(categories.parentId) as ReturnType<typeof eq>);
  }
  const whereClause = where.length === 0 ? undefined : and(...where);

  const rows = await db
    .select()
    .from(categories)
    .where(whereClause)
    .orderBy(asc(categories.name));

  const counts = await countProductsByCategory(rows.map((r) => r.id));
  const items = rows.map((r) => toAdminCategory(r, counts.get(r.id) ?? 0));

  return { items, total: items.length };
}

export async function getCategory(
  idOrSlug: string,
): Promise<AdminCategory | null> {
  const predicate = isUuid(idOrSlug)
    ? eq(categories.id, idOrSlug)
    : eq(categories.slug, idOrSlug);
  const rows = await db
    .select()
    .from(categories)
    .where(predicate)
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const counts = await countProductsByCategory([row.id]);
  return toAdminCategory(row, counts.get(row.id) ?? 0);
}

async function categoryExists(id: string): Promise<boolean> {
  const rows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, id))
    .limit(1);
  return rows.length === 1;
}

/**
 * Walk up the parent chain from `candidateParentId` to make sure
 * `selfId` is not an ancestor — preventing the cycle "A's parent is B,
 * B's parent is A" or any longer loop. The depth cap also doubles as a
 * safety net against pre-existing cycles in the data.
 */
async function wouldCreateCycle(
  selfId: string,
  candidateParentId: string,
): Promise<boolean> {
  if (selfId === candidateParentId) return true;
  let current: string | null = candidateParentId;
  for (let depth = 0; depth < 32 && current !== null; depth++) {
    const rows: Array<{ id: string; parentId: string | null }> = await db
      .select({ id: categories.id, parentId: categories.parentId })
      .from(categories)
      .where(eq(categories.id, current))
      .limit(1);
    const row = rows[0];
    if (!row) return false;
    if (row.parentId === selfId) return true;
    current = row.parentId;
  }
  return false;
}

export async function createCategory(
  input: CreateCategoryInput,
): Promise<CategoryMutationResult> {
  const validated = validatePayload(input, "create");
  if (!validated.ok) return validated;
  const v = validated.values;

  if (v.parentId && !(await categoryExists(v.parentId))) {
    return {
      ok: false,
      error: { code: "parent_not_found", parentId: v.parentId },
    };
  }

  // Pre-check slug uniqueness for a clean 409.
  const slugConflict = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, v.slug!))
    .limit(1);
  if (slugConflict.length > 0) {
    return { ok: false, error: { code: "slug_taken", slug: v.slug! } };
  }

  const insertValues: NewCategory = {
    slug: v.slug!,
    name: v.name!,
    description: v.description ?? null,
    parentId: v.parentId ?? null,
  };

  let inserted: Category;
  try {
    const rows = await db.insert(categories).values(insertValues).returning();
    if (!rows[0]) {
      return {
        ok: false,
        error: { code: "validation_failed", message: "Insert returned no row" },
      };
    }
    inserted = rows[0];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/duplicate|unique/i.test(message)) {
      return { ok: false, error: { code: "slug_taken", slug: v.slug! } };
    }
    throw err;
  }

  return { ok: true, data: toAdminCategory(inserted, 0) };
}

export async function updateCategory(
  id: string,
  input: UpdateCategoryInput,
): Promise<CategoryMutationResult> {
  if (!isUuid(id)) return { ok: false, error: { code: "not_found" } };

  const existing = await db
    .select()
    .from(categories)
    .where(eq(categories.id, id))
    .limit(1);
  if (existing.length === 0) return { ok: false, error: { code: "not_found" } };
  const current = existing[0];

  const validated = validatePayload(input, "update");
  if (!validated.ok) return validated;
  const v = validated.values;

  if (v.slug !== undefined && v.slug !== current.slug) {
    const conflict = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.slug, v.slug), ne(categories.id, id)))
      .limit(1);
    if (conflict.length > 0) {
      return { ok: false, error: { code: "slug_taken", slug: v.slug } };
    }
  }

  if (v.parentId !== undefined && v.parentId !== null) {
    if (!(await categoryExists(v.parentId))) {
      return {
        ok: false,
        error: { code: "parent_not_found", parentId: v.parentId },
      };
    }
    if (await wouldCreateCycle(id, v.parentId)) {
      return {
        ok: false,
        error: { code: "parent_cycle", parentId: v.parentId },
      };
    }
  }

  const patch: Partial<NewCategory> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (v.slug !== undefined) patch.slug = v.slug;
  if (v.name !== undefined) patch.name = v.name;
  if (v.description !== undefined) patch.description = v.description;
  if (v.parentId !== undefined) patch.parentId = v.parentId;

  if (Object.keys(patch).length === 1) {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: "Update payload must include at least one field",
      },
    };
  }

  try {
    await db.update(categories).set(patch).where(eq(categories.id, id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/duplicate|unique/i.test(message)) {
      return { ok: false, error: { code: "slug_taken", slug: v.slug ?? current.slug } };
    }
    throw err;
  }

  const refreshed = await getCategory(id);
  if (!refreshed) return { ok: false, error: { code: "not_found" } };
  return { ok: true, data: refreshed };
}

/**
 * Hard-delete a category. By default refuses to delete a category that
 * is still referenced by any product (`in_use` error) — admins should
 * either re-categorise the products first or pass `force: true` to
 * detach them (the FK is `ON DELETE SET NULL`, so a forced delete
 * promotes the products to "uncategorised"). Children get their
 * `parent_id` cleared automatically by the FK rule.
 */
export interface DeleteCategoryInput {
  force?: boolean;
}

export type DeleteCategoryError =
  | { code: "not_found" }
  | { code: "in_use"; productCount: number };

export type DeleteCategoryResult =
  | { ok: true }
  | { ok: false; error: DeleteCategoryError };

export async function deleteCategory(
  id: string,
  input: DeleteCategoryInput = {},
): Promise<DeleteCategoryResult> {
  if (!isUuid(id)) return { ok: false, error: { code: "not_found" } };

  const existing = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, id))
    .limit(1);
  if (existing.length === 0) return { ok: false, error: { code: "not_found" } };

  if (!input.force) {
    const counts = await countProductsByCategory([id]);
    const used = counts.get(id) ?? 0;
    if (used > 0) {
      return { ok: false, error: { code: "in_use", productCount: used } };
    }
  }

  await db.delete(categories).where(eq(categories.id, id));
  return { ok: true };
}

export type { Category };
