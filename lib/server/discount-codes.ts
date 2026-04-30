/**
 * Server-side helpers for admin-managed discount codes.
 *
 * The data model lives at `discount_codes` (see `lib/db/schema.ts`). This
 * module centralises:
 *
 *   - Input normalisation (codes are stored upper-cased / trimmed).
 *   - Validation of the type/value relationship (percentage 1-100, fixed
 *     non-negative cents).
 *   - The four CRUD primitives the admin API surfaces, plus a list query
 *     that returns each row with a derived `status` and `usageRemaining`
 *     so the admin UI can render the table without re-implementing the
 *     "is this code currently usable?" predicate.
 *   - A typed mutation-error vocabulary so route handlers can map errors
 *     to HTTP statuses without leaking DB details.
 *
 * The route layer is a thin shell around these helpers — it parses the
 * request, calls one helper, and shapes the response.
 */
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  discountCodes,
  type DiscountCode,
  type NewDiscountCode,
} from "@/lib/db/schema";

/** Discount kinds. Stored as a string so adding a new kind is migration-free. */
export type DiscountType = "percentage" | "fixed";

export const DISCOUNT_TYPES: readonly DiscountType[] = [
  "percentage",
  "fixed",
] as const;

/**
 * Hard caps on user-facing fields. The defaults are deliberately generous
 * — admins should rarely hit them, but a check here prevents pathological
 * values (negative cents, 1000% off) from ever reaching the database.
 */
export const DISCOUNT_CODE_LIMITS = {
  /** Min length of the code itself. */
  codeMinLength: 3,
  /** Max length of the code itself. Matches the column. */
  codeMaxLength: 64,
  /** Highest percentage discount accepted (anything above is suspicious). */
  percentageMax: 100,
  /** Highest fixed-cents discount accepted. ~$10,000 — a sane upper bound. */
  fixedMaxCents: 1_000_000,
  /** Highest min-order threshold accepted. */
  minOrderMaxCents: 100_000_000,
  /** Highest usage_limit accepted. */
  usageLimitMax: 10_000_000,
} as const;

/** Codes are normalised on the way in: trimmed and upper-cased. */
export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Code character set: A-Z, 0-9, `-`, `_`. Restricting to ASCII keeps URL
 * encoding / clipboard handling predictable and avoids near-look-alike
 * unicode tricks.
 */
const CODE_PATTERN = /^[A-Z0-9_-]+$/;

/**
 * "Status" exposed in the admin list. Derived at read time from the raw
 * columns:
 *
 *   - `inactive` — `isActive = false`
 *   - `expired`  — `expiresAt` is in the past
 *   - `exhausted` — `usageLimit` reached (`usageCount >= usageLimit`)
 *   - `active`   — none of the above
 *
 * The order above is also the precedence order: an inactive AND expired
 * code reports `inactive` (the admin's explicit toggle wins).
 */
export type DiscountCodeStatus =
  | "active"
  | "inactive"
  | "expired"
  | "exhausted";

export function deriveDiscountStatus(
  row: Pick<DiscountCode, "isActive" | "expiresAt" | "usageLimit" | "usageCount">,
  now: Date = new Date(),
): DiscountCodeStatus {
  if (!row.isActive) return "inactive";
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
    return "expired";
  }
  if (row.usageLimit !== null && row.usageCount >= row.usageLimit) {
    return "exhausted";
  }
  return "active";
}

/**
 * Public payload the admin API returns for a single discount code. The
 * `status` and `usageRemaining` fields are derived from the raw columns
 * — admins editing a single field shouldn't have to also flip a status.
 */
export interface PublicDiscountCode {
  id: string;
  code: string;
  type: DiscountType;
  value: number;
  minOrderValue: number | null;
  expiresAt: string | null;
  isActive: boolean;
  usageLimit: number | null;
  usageCount: number;
  /** `usageLimit - usageCount`, or null when there is no limit. */
  usageRemaining: number | null;
  status: DiscountCodeStatus;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toPublicDiscountCode(
  row: DiscountCode,
  now: Date = new Date(),
): PublicDiscountCode {
  return {
    id: row.id,
    code: row.code,
    type: row.type as DiscountType,
    value: row.value,
    minOrderValue: row.minOrderValue ?? null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    isActive: row.isActive,
    usageLimit: row.usageLimit ?? null,
    usageCount: row.usageCount,
    usageRemaining:
      row.usageLimit === null ? null : Math.max(0, row.usageLimit - row.usageCount),
    status: deriveDiscountStatus(row, now),
    description: row.description ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Mutation-error vocabulary surfaced to the route layer.
 *
 *   - `code_taken`       — unique-index violation on `code`.
 *   - `not_found`        — id doesn't exist (or was already deleted).
 *   - `validation_failed` — input failed the helpers' invariants. The
 *                           `fields` map mirrors the Zod-style fieldErrors
 *                           shape used by the rest of the API surface.
 */
export type DiscountCodeMutationError =
  | { code: "code_taken"; conflictingCode: string }
  | { code: "not_found" }
  | {
      code: "validation_failed";
      message: string;
      fields?: Record<string, string[]>;
    };

export type DiscountCodeMutationResult<T = PublicDiscountCode> =
  | { ok: true; data: T }
  | { ok: false; error: DiscountCodeMutationError };

/**
 * Shared invariant checks for create + update payloads. Returns either
 * the cleaned-up values (with the right column types) or a typed error.
 *
 * `mode` is "create" when every required field must be present and
 * "update" when partial-payload semantics apply (any field may be
 * omitted, but a supplied value must still be valid).
 */
interface ValidateInput {
  code?: string | null;
  type?: string | null;
  value?: number | null;
  minOrderValue?: number | null;
  expiresAt?: Date | string | null;
  isActive?: boolean | null;
  usageLimit?: number | null;
  description?: string | null;
}

interface ValidatedFields {
  code?: string;
  type?: DiscountType;
  value?: number;
  minOrderValue?: number | null;
  expiresAt?: Date | null;
  isActive?: boolean;
  usageLimit?: number | null;
  description?: string | null;
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
  input: ValidateInput,
  mode: "create" | "update",
):
  | { ok: true; values: ValidatedFields }
  | { ok: false; error: DiscountCodeMutationError } {
  const fields: Record<string, string[]> = {};
  const out: ValidatedFields = {};

  // code
  if (input.code !== undefined && input.code !== null) {
    const normalized = normalizeCode(input.code);
    if (
      normalized.length < DISCOUNT_CODE_LIMITS.codeMinLength ||
      normalized.length > DISCOUNT_CODE_LIMITS.codeMaxLength
    ) {
      pushError(
        fields,
        "code",
        `Code must be between ${DISCOUNT_CODE_LIMITS.codeMinLength} and ${DISCOUNT_CODE_LIMITS.codeMaxLength} characters`,
      );
    } else if (!CODE_PATTERN.test(normalized)) {
      pushError(
        fields,
        "code",
        "Code must contain only A-Z, 0-9, '-', or '_'",
      );
    } else {
      out.code = normalized;
    }
  } else if (mode === "create") {
    pushError(fields, "code", "Code is required");
  }

  // type
  if (input.type !== undefined && input.type !== null) {
    if (!DISCOUNT_TYPES.includes(input.type as DiscountType)) {
      pushError(
        fields,
        "type",
        `Type must be one of: ${DISCOUNT_TYPES.join(", ")}`,
      );
    } else {
      out.type = input.type as DiscountType;
    }
  } else if (mode === "create") {
    pushError(fields, "type", "Type is required");
  }

  // value (validated against the resolved type when possible)
  let resolvedType: DiscountType | undefined = out.type;
  if (input.value !== undefined && input.value !== null) {
    if (
      !Number.isFinite(input.value) ||
      !Number.isInteger(input.value) ||
      input.value <= 0
    ) {
      pushError(fields, "value", "Value must be a positive integer");
    } else if (resolvedType === "percentage") {
      if (input.value > DISCOUNT_CODE_LIMITS.percentageMax) {
        pushError(
          fields,
          "value",
          `Percentage value cannot exceed ${DISCOUNT_CODE_LIMITS.percentageMax}`,
        );
      } else {
        out.value = input.value;
      }
    } else if (resolvedType === "fixed") {
      if (input.value > DISCOUNT_CODE_LIMITS.fixedMaxCents) {
        pushError(
          fields,
          "value",
          `Fixed value cannot exceed ${DISCOUNT_CODE_LIMITS.fixedMaxCents} cents`,
        );
      } else {
        out.value = input.value;
      }
    } else {
      // type was missing on this update — accept the integer as-is. The
      // DB CHECK constraint catches anything beyond the column type.
      out.value = input.value;
    }
  } else if (mode === "create") {
    pushError(fields, "value", "Value is required");
  }

  // minOrderValue (nullable; explicit null clears it)
  if (input.minOrderValue !== undefined) {
    if (input.minOrderValue === null) {
      out.minOrderValue = null;
    } else if (
      !Number.isFinite(input.minOrderValue) ||
      !Number.isInteger(input.minOrderValue) ||
      input.minOrderValue < 0
    ) {
      pushError(
        fields,
        "minOrderValue",
        "minOrderValue must be a non-negative integer (cents)",
      );
    } else if (input.minOrderValue > DISCOUNT_CODE_LIMITS.minOrderMaxCents) {
      pushError(
        fields,
        "minOrderValue",
        `minOrderValue cannot exceed ${DISCOUNT_CODE_LIMITS.minOrderMaxCents}`,
      );
    } else {
      out.minOrderValue = input.minOrderValue;
    }
  }

  // expiresAt (nullable)
  if (input.expiresAt !== undefined) {
    if (input.expiresAt === null) {
      out.expiresAt = null;
    } else {
      const d =
        input.expiresAt instanceof Date
          ? input.expiresAt
          : new Date(input.expiresAt);
      if (Number.isNaN(d.getTime())) {
        pushError(
          fields,
          "expiresAt",
          "expiresAt must be a valid ISO 8601 timestamp",
        );
      } else {
        out.expiresAt = d;
      }
    }
  }

  // isActive
  if (input.isActive !== undefined && input.isActive !== null) {
    if (typeof input.isActive !== "boolean") {
      pushError(fields, "isActive", "isActive must be a boolean");
    } else {
      out.isActive = input.isActive;
    }
  }

  // usageLimit (nullable)
  if (input.usageLimit !== undefined) {
    if (input.usageLimit === null) {
      out.usageLimit = null;
    } else if (
      !Number.isFinite(input.usageLimit) ||
      !Number.isInteger(input.usageLimit) ||
      input.usageLimit <= 0
    ) {
      pushError(
        fields,
        "usageLimit",
        "usageLimit must be a positive integer or null",
      );
    } else if (input.usageLimit > DISCOUNT_CODE_LIMITS.usageLimitMax) {
      pushError(
        fields,
        "usageLimit",
        `usageLimit cannot exceed ${DISCOUNT_CODE_LIMITS.usageLimitMax}`,
      );
    } else {
      out.usageLimit = input.usageLimit;
    }
  }

  // description (nullable)
  if (input.description !== undefined) {
    if (input.description === null) {
      out.description = null;
    } else if (typeof input.description !== "string") {
      pushError(fields, "description", "description must be a string");
    } else {
      const trimmed = input.description.trim();
      out.description = trimmed.length === 0 ? null : trimmed;
    }
  }

  if (Object.keys(fields).length > 0) {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: "Invalid discount code payload",
        fields,
      },
    };
  }
  return { ok: true, values: out };
}

/**
 * List filter knobs. Status filters are derived (the admin UI passes
 * `status=expired` and the helper translates that into the right WHERE
 * clauses on `expiresAt` / `isActive`).
 */
export interface ListDiscountCodesInput {
  q?: string;
  status?: DiscountCodeStatus | "all";
  page?: number;
  pageSize?: number;
}

export interface ListDiscountCodesResult {
  items: PublicDiscountCode[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export async function listDiscountCodes(
  input: ListDiscountCodesInput = {},
): Promise<ListDiscountCodesResult> {
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.max(
    1,
    Math.min(MAX_PAGE_SIZE, Math.floor(input.pageSize ?? DEFAULT_PAGE_SIZE)),
  );
  const status = input.status ?? "all";
  const now = new Date();

  const where = [] as ReturnType<typeof eq>[];

  if (input.q && input.q.trim().length > 0) {
    const term = `%${input.q.trim()}%`;
    const codeMatch = ilike(discountCodes.code, term);
    const descMatch = ilike(discountCodes.description, term);
    const combined = or(codeMatch, descMatch);
    if (combined) where.push(combined);
  }

  if (status === "active") {
    where.push(eq(discountCodes.isActive, true));
    where.push(
      sql`(${discountCodes.expiresAt} IS NULL OR ${discountCodes.expiresAt} > ${now})` as unknown as ReturnType<
        typeof eq
      >,
    );
    where.push(
      sql`(${discountCodes.usageLimit} IS NULL OR ${discountCodes.usageCount} < ${discountCodes.usageLimit})` as unknown as ReturnType<
        typeof eq
      >,
    );
  } else if (status === "inactive") {
    where.push(eq(discountCodes.isActive, false));
  } else if (status === "expired") {
    where.push(eq(discountCodes.isActive, true));
    where.push(
      sql`${discountCodes.expiresAt} IS NOT NULL AND ${discountCodes.expiresAt} <= ${now}` as unknown as ReturnType<
        typeof eq
      >,
    );
  } else if (status === "exhausted") {
    where.push(eq(discountCodes.isActive, true));
    where.push(
      sql`${discountCodes.usageLimit} IS NOT NULL AND ${discountCodes.usageCount} >= ${discountCodes.usageLimit}` as unknown as ReturnType<
        typeof eq
      >,
    );
    where.push(
      sql`(${discountCodes.expiresAt} IS NULL OR ${discountCodes.expiresAt} > ${now})` as unknown as ReturnType<
        typeof eq
      >,
    );
  }

  const whereClause = where.length === 0 ? undefined : and(...where);

  const totalRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(discountCodes)
    .where(whereClause);
  const total = totalRows[0]?.count ?? 0;

  const rows = await db
    .select()
    .from(discountCodes)
    .where(whereClause)
    .orderBy(desc(discountCodes.createdAt), asc(discountCodes.code))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

  return {
    items: rows.map((row) => toPublicDiscountCode(row, now)),
    page,
    pageSize,
    total,
    totalPages,
    hasMore: page * pageSize < total,
  };
}

/** Single-row lookup. Returns the public payload, or null when absent. */
export async function getDiscountCodeById(
  id: string,
): Promise<PublicDiscountCode | null> {
  const rows = await db
    .select()
    .from(discountCodes)
    .where(eq(discountCodes.id, id))
    .limit(1);
  const row = rows[0];
  return row ? toPublicDiscountCode(row) : null;
}

/** Find a row by its (already normalised) code. Used by the unique check. */
export async function findDiscountCodeByCode(
  code: string,
): Promise<DiscountCode | null> {
  const rows = await db
    .select()
    .from(discountCodes)
    .where(eq(discountCodes.code, normalizeCode(code)))
    .limit(1);
  return rows[0] ?? null;
}

export interface CreateDiscountCodeInput {
  code: string;
  type: DiscountType | string;
  value: number;
  minOrderValue?: number | null;
  expiresAt?: Date | string | null;
  isActive?: boolean;
  usageLimit?: number | null;
  description?: string | null;
}

export async function createDiscountCode(
  input: CreateDiscountCodeInput,
): Promise<DiscountCodeMutationResult> {
  const validated = validatePayload(input, "create");
  if (!validated.ok) return validated;
  const v = validated.values;

  // We have already validated the required fields exist for create mode.
  const insertValues: NewDiscountCode = {
    code: v.code!,
    type: v.type!,
    value: v.value!,
    minOrderValue: v.minOrderValue ?? null,
    expiresAt: v.expiresAt ?? null,
    isActive: v.isActive ?? true,
    usageLimit: v.usageLimit ?? null,
    description: v.description ?? null,
  };

  try {
    const inserted = await db
      .insert(discountCodes)
      .values(insertValues)
      .returning();
    const row = inserted[0];
    if (!row) {
      return {
        ok: false,
        error: {
          code: "validation_failed",
          message: "Insert returned no row",
        },
      };
    }
    return { ok: true, data: toPublicDiscountCode(row) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/duplicate|unique/i.test(message)) {
      return {
        ok: false,
        error: { code: "code_taken", conflictingCode: insertValues.code },
      };
    }
    throw err;
  }
}

export interface UpdateDiscountCodeInput {
  code?: string;
  type?: DiscountType | string;
  value?: number;
  minOrderValue?: number | null;
  expiresAt?: Date | string | null;
  isActive?: boolean;
  usageLimit?: number | null;
  description?: string | null;
}

/**
 * Apply a partial update. An empty payload is rejected (the route layer
 * also enforces this) so admins don't accidentally bump `updatedAt` to no
 * effect.
 */
export async function updateDiscountCode(
  id: string,
  input: UpdateDiscountCodeInput,
): Promise<DiscountCodeMutationResult> {
  const existing = await db
    .select()
    .from(discountCodes)
    .where(eq(discountCodes.id, id))
    .limit(1);
  if (existing.length === 0) {
    return { ok: false, error: { code: "not_found" } };
  }
  const current = existing[0];

  const validated = validatePayload(
    {
      ...input,
      // Carry the resolved type forward so the value-vs-type cross-check
      // works even if the caller is updating only the value.
      type: input.type ?? current.type,
    },
    "update",
  );
  if (!validated.ok) return validated;
  const v = validated.values;

  const patch: Partial<NewDiscountCode> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };
  // Only set keys that were actually provided so `updatedAt` is the only
  // unconditional column update.
  if (input.code !== undefined && v.code !== undefined) patch.code = v.code;
  if (input.type !== undefined && v.type !== undefined) patch.type = v.type;
  if (input.value !== undefined && v.value !== undefined) patch.value = v.value;
  if (input.minOrderValue !== undefined)
    patch.minOrderValue = v.minOrderValue ?? null;
  if (input.expiresAt !== undefined) patch.expiresAt = v.expiresAt ?? null;
  if (input.isActive !== undefined && v.isActive !== undefined)
    patch.isActive = v.isActive;
  if (input.usageLimit !== undefined) patch.usageLimit = v.usageLimit ?? null;
  if (input.description !== undefined)
    patch.description = v.description ?? null;

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
    const updated = await db
      .update(discountCodes)
      .set(patch)
      .where(eq(discountCodes.id, id))
      .returning();
    const row = updated[0];
    if (!row) return { ok: false, error: { code: "not_found" } };
    return { ok: true, data: toPublicDiscountCode(row) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/duplicate|unique/i.test(message)) {
      return {
        ok: false,
        error: {
          code: "code_taken",
          conflictingCode: patch.code ?? current.code,
        },
      };
    }
    throw err;
  }
}

/** Hard delete. Returns false when no row was removed. */
export async function deleteDiscountCode(id: string): Promise<boolean> {
  const removed = await db
    .delete(discountCodes)
    .where(eq(discountCodes.id, id))
    .returning({ id: discountCodes.id });
  return removed.length > 0;
}
