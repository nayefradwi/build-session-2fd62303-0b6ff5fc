/**
 * Admin user-management helpers.
 *
 * The customer self-serve surface lives in `lib/server/auth.ts`
 * (`requireUser`, `getCurrentUser`, etc.). This module owns the *admin*
 * side of the user surface:
 *
 *   - `listAdminUsers`      paginated list across every account, with a
 *                           free-text q (email / name / id), a role
 *                           filter (all / user / admin), and a status
 *                           filter (all / active / disabled). Each entry
 *                           carries a denormalised order count so the UI
 *                           can flag accounts that cannot be deleted
 *                           without a per-row probe.
 *   - `getAdminUserDetail`  full detail: profile, addresses, account
 *                           status, and the order history (all rows
 *                           plus aggregate totals).
 *   - `setUserDisabled`     enable / disable an account. Disabling
 *                           snapshots the actor / timestamp / reason
 *                           and revokes every active session for the
 *                           target user. Enabling clears the snapshot.
 *   - `deleteAdminUser`     hard-delete a user, *unless* they have any
 *                           order history — orders.user_id is `restrict`
 *                           so an attempted DELETE would fail with a FK
 *                           error anyway; the helper checks first and
 *                           returns a typed error so the route layer can
 *                           surface a clean 409.
 *
 * Concurrency: the disable / enable writes use an optimistic guard
 * (`WHERE id = ? AND ...`) so two admins racing on the same row never
 * end up in an inconsistent state. The delete probe reads the order
 * count before issuing the DELETE — a race where a brand-new order is
 * inserted between the check and the delete will surface as the
 * underlying FK error, which we map to the same `has_orders` 409.
 *
 * Self-protection: the route layer prevents an admin from disabling /
 * deleting their own account. The helpers themselves accept any pair of
 * ids; the actor-id check is a route-level concern so the helpers stay
 * unit-testable without a session context.
 */
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";

import { db } from "@/lib/db";
import {
  addresses,
  orders,
  refreshTokens,
  sessions,
  users,
  type Address,
  type Order,
  type User,
} from "@/lib/db/schema";

/* -------------------------------------------------------------------------- */
/*  Public payload shapes                                                     */
/* -------------------------------------------------------------------------- */

export interface AdminUserListEntry {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: "active" | "disabled";
  disabledAt: string | null;
  disabledReason: string | null;
  disabledByUserId: string | null;
  orderCount: number;
  totalSpentCents: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUserAddress {
  id: string;
  label: string | null;
  recipient: string | null;
  phone: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postalCode: string;
  country: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUserOrderEntry {
  id: string;
  orderNumber: string;
  status: string;
  itemCount: number;
  subtotalCents: number;
  shippingCents: number;
  discountCents: number;
  totalCents: number;
  currency: string;
  discountCode: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUserDetail extends AdminUserListEntry {
  addresses: AdminUserAddress[];
  orders: AdminUserOrderEntry[];
  /**
   * Aggregate totals across the full order history (independent of any
   * pagination on the `orders` array — currently the detail returns the
   * full history because user-level histories are typically short).
   */
  orderTotals: {
    count: number;
    totalSpentCents: number;
    currency: string | null;
  };
}

/* -------------------------------------------------------------------------- */
/*  Pagination + filter knobs                                                 */
/* -------------------------------------------------------------------------- */

export const ADMIN_USERS_DEFAULT_PAGE_SIZE = 25;
export const ADMIN_USERS_MAX_PAGE_SIZE = 100;
/** Hard cap on orders embedded into the detail payload so a single
 *  high-volume customer cannot blow up the JSON response. */
export const ADMIN_USER_DETAIL_ORDER_LIMIT = 200;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** Roles surfaced through the admin UI's filter dropdown. */
export const ADMIN_USER_ROLE_FILTERS = ["all", "user", "admin"] as const;
export type AdminUserRoleFilter = (typeof ADMIN_USER_ROLE_FILTERS)[number];

export function parseAdminUserRoleFilter(
  raw: string | null,
): AdminUserRoleFilter | null {
  if (raw === null || raw === "") return "all";
  if ((ADMIN_USER_ROLE_FILTERS as readonly string[]).includes(raw)) {
    return raw as AdminUserRoleFilter;
  }
  return null;
}

/** Status surfaced through the admin UI's filter dropdown. */
export const ADMIN_USER_STATUS_FILTERS = [
  "all",
  "active",
  "disabled",
] as const;
export type AdminUserStatusFilter =
  (typeof ADMIN_USER_STATUS_FILTERS)[number];

export function parseAdminUserStatusFilter(
  raw: string | null,
): AdminUserStatusFilter | null {
  if (raw === null || raw === "") return "all";
  if ((ADMIN_USER_STATUS_FILTERS as readonly string[]).includes(raw)) {
    return raw as AdminUserStatusFilter;
  }
  return null;
}

export interface ListAdminUsersInput {
  /** 1-indexed page number. */
  page?: number;
  pageSize?: number;
  role?: AdminUserRoleFilter;
  status?: AdminUserStatusFilter;
  /**
   * Free-text search. Matches against the user id, email, and name.
   * Case-insensitive.
   */
  q?: string;
}

export interface ListAdminUsersResult {
  items: AdminUserListEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

/* -------------------------------------------------------------------------- */
/*  Mappers                                                                   */
/* -------------------------------------------------------------------------- */

function toListEntry(
  u: User,
  orderCount: number,
  totalSpentCents: number,
): AdminUserListEntry {
  return {
    id: u.id,
    email: u.email,
    name: u.name ?? null,
    role: u.role,
    status: u.disabledAt ? "disabled" : "active",
    disabledAt: u.disabledAt ? u.disabledAt.toISOString() : null,
    disabledReason: u.disabledReason ?? null,
    disabledByUserId: u.disabledBy ?? null,
    orderCount,
    totalSpentCents,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

function toAddressEntry(a: Address): AdminUserAddress {
  return {
    id: a.id,
    label: a.label ?? null,
    recipient: a.recipient ?? null,
    phone: a.phone ?? null,
    line1: a.line1,
    line2: a.line2 ?? null,
    city: a.city,
    state: a.state ?? null,
    postalCode: a.postalCode,
    country: a.country,
    isDefault: a.isDefault,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

/** Short, human-friendly form of an order id (`ORD-XXXXXXXX`). */
function shortOrderNumber(id: string): string {
  const head = id.replace(/-/g, "").slice(0, 8).toUpperCase();
  return `ORD-${head}`;
}

function toOrderEntry(o: Order): AdminUserOrderEntry {
  return {
    id: o.id,
    orderNumber: shortOrderNumber(o.id),
    status: o.status,
    itemCount: o.itemCount,
    subtotalCents: o.subtotalCents,
    shippingCents: o.shippingCents,
    discountCents: o.discountCents,
    totalCents: o.totalCents,
    currency: o.currency,
    discountCode: o.discountCode ?? null,
    cancelledAt: o.cancelledAt ? o.cancelledAt.toISOString() : null,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/*  Filter compiler                                                           */
/* -------------------------------------------------------------------------- */

function buildFilterClause(input: ListAdminUsersInput) {
  const where: ReturnType<typeof eq>[] = [];

  if (input.role && input.role !== "all") {
    where.push(eq(users.role, input.role));
  }
  if (input.status === "active") {
    where.push(isNull(users.disabledAt));
  } else if (input.status === "disabled") {
    where.push(isNotNull(users.disabledAt));
  }

  if (input.q && input.q.trim().length > 0) {
    const term = `%${input.q.trim()}%`;
    const idTextSql = sql`${users.id}::text`;
    const conds = [
      ilike(idTextSql, term),
      ilike(users.email, term),
      ilike(users.name, term),
    ];
    if (isUuid(input.q.trim())) {
      conds.push(eq(users.id, input.q.trim()));
    }
    const combined = or(...conds);
    if (combined) where.push(combined as ReturnType<typeof eq>);
  }

  return where.length === 0 ? undefined : and(...where);
}

/* -------------------------------------------------------------------------- */
/*  List + detail                                                             */
/* -------------------------------------------------------------------------- */

export async function listAdminUsers(
  input: ListAdminUsersInput = {},
): Promise<ListAdminUsersResult> {
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.max(
    1,
    Math.min(
      ADMIN_USERS_MAX_PAGE_SIZE,
      Math.floor(input.pageSize ?? ADMIN_USERS_DEFAULT_PAGE_SIZE),
    ),
  );

  const whereClause = buildFilterClause(input);

  const totalRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
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

  const userRows = await db
    .select()
    .from(users)
    .where(whereClause)
    .orderBy(desc(users.createdAt), desc(users.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const ids = userRows.map((u) => u.id);

  // Per-user aggregate. One round trip — the IN-list is bounded by
  // pageSize, so the cardinality is at most ADMIN_USERS_MAX_PAGE_SIZE.
  const aggMap = new Map<
    string,
    { orderCount: number; totalSpentCents: number }
  >();
  if (ids.length > 0) {
    const aggRows = await db
      .select({
        userId: orders.userId,
        orderCount: sql<number>`count(*)::int`,
        totalSpentCents: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
      })
      .from(orders)
      .where(
        sql`${orders.userId} in (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`,
      )
      .groupBy(orders.userId);
    for (const row of aggRows) {
      aggMap.set(row.userId, {
        orderCount: row.orderCount ?? 0,
        totalSpentCents: row.totalSpentCents ?? 0,
      });
    }
  }

  const items = userRows.map((u) => {
    const agg = aggMap.get(u.id) ?? { orderCount: 0, totalSpentCents: 0 };
    return toListEntry(u, agg.orderCount, agg.totalSpentCents);
  });
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

export async function getAdminUserDetail(
  userId: string,
): Promise<AdminUserDetail | null> {
  if (!isUuid(userId)) return null;

  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const user = userRows[0];
  if (!user) return null;

  const [addressRows, orderRows, orderAggRows] = await Promise.all([
    db
      .select()
      .from(addresses)
      .where(eq(addresses.userId, userId))
      .orderBy(desc(addresses.isDefault), asc(addresses.createdAt)),
    db
      .select()
      .from(orders)
      .where(eq(orders.userId, userId))
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(ADMIN_USER_DETAIL_ORDER_LIMIT),
    db
      .select({
        count: sql<number>`count(*)::int`,
        totalSpentCents: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
        currency: sql<string | null>`max(${orders.currency})`,
      })
      .from(orders)
      .where(eq(orders.userId, userId)),
  ]);

  const orderAgg = orderAggRows[0] ?? {
    count: 0,
    totalSpentCents: 0,
    currency: null,
  };

  const base = toListEntry(
    user,
    orderAgg.count ?? 0,
    orderAgg.totalSpentCents ?? 0,
  );

  return {
    ...base,
    addresses: addressRows.map(toAddressEntry),
    orders: orderRows.map(toOrderEntry),
    orderTotals: {
      count: orderAgg.count ?? 0,
      totalSpentCents: orderAgg.totalSpentCents ?? 0,
      currency: orderAgg.currency ?? null,
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Disable / enable                                                          */
/* -------------------------------------------------------------------------- */

export const DISABLE_REASON_MAX = 1000;

export type SetUserDisabledError =
  | { code: "not_found" }
  | { code: "self_action"; message: string }
  | {
      code: "stale_status";
      currentStatus: "active" | "disabled";
    }
  | {
      code: "validation_failed";
      message: string;
      fields?: Record<string, string[]>;
    };

export interface SetUserDisabledInput {
  /** The user being enabled / disabled. */
  userId: string;
  /** True ⇒ disable, false ⇒ enable. */
  disabled: boolean;
  /** The acting admin's user id. */
  actorUserId: string;
  /** Optional admin note (only used when disabling). */
  reason?: string | null;
}

export type SetUserDisabledResult =
  | { ok: true; data: AdminUserDetail }
  | { ok: false; error: SetUserDisabledError };

export async function setUserDisabled(
  input: SetUserDisabledInput,
): Promise<SetUserDisabledResult> {
  if (!isUuid(input.userId)) {
    return { ok: false, error: { code: "not_found" } };
  }
  if (input.userId === input.actorUserId) {
    return {
      ok: false,
      error: {
        code: "self_action",
        message: "An admin cannot change their own account status",
      },
    };
  }

  let reason: string | null = null;
  if (input.disabled) {
    const raw = input.reason ?? null;
    if (raw !== null && raw !== undefined) {
      if (typeof raw !== "string") {
        return {
          ok: false,
          error: {
            code: "validation_failed",
            message: "`reason` must be a string",
            fields: { reason: ["Expected a string"] },
          },
        };
      }
      const trimmed = raw.trim();
      if (trimmed.length > DISABLE_REASON_MAX) {
        return {
          ok: false,
          error: {
            code: "validation_failed",
            message: "`reason` is too long",
            fields: { reason: [`Max ${DISABLE_REASON_MAX} characters`] },
          },
        };
      }
      reason = trimmed.length === 0 ? null : trimmed;
    }
  }

  const existing = await db
    .select()
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  const current = existing[0];
  if (!current) {
    return { ok: false, error: { code: "not_found" } };
  }

  const isCurrentlyDisabled = current.disabledAt !== null;
  if (isCurrentlyDisabled === input.disabled) {
    return {
      ok: false,
      error: {
        code: "stale_status",
        currentStatus: isCurrentlyDisabled ? "disabled" : "active",
      },
    };
  }

  const now = new Date();

  if (input.disabled) {
    // Optimistic guard: only flip the row when it is still enabled.
    const updated = await db
      .update(users)
      .set({
        disabledAt: now,
        disabledReason: reason,
        disabledBy: input.actorUserId,
        updatedAt: now,
      })
      .where(and(eq(users.id, input.userId), isNull(users.disabledAt)))
      .returning({ id: users.id });
    if (updated.length === 0) {
      return {
        ok: false,
        error: { code: "stale_status", currentStatus: "disabled" },
      };
    }

    // Revoke every active session and refresh token so the disabled
    // user can no longer use a previously issued cookie.
    await db
      .update(sessions)
      .set({ revokedAt: now })
      .where(
        and(eq(sessions.userId, input.userId), isNull(sessions.revokedAt)),
      );
    await db
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(
        and(
          eq(refreshTokens.userId, input.userId),
          isNull(refreshTokens.revokedAt),
        ),
      );
  } else {
    const updated = await db
      .update(users)
      .set({
        disabledAt: null,
        disabledReason: null,
        disabledBy: null,
        updatedAt: now,
      })
      .where(and(eq(users.id, input.userId), isNotNull(users.disabledAt)))
      .returning({ id: users.id });
    if (updated.length === 0) {
      return {
        ok: false,
        error: { code: "stale_status", currentStatus: "active" },
      };
    }
  }

  const detail = await getAdminUserDetail(input.userId);
  if (!detail) return { ok: false, error: { code: "not_found" } };
  return { ok: true, data: detail };
}

/* -------------------------------------------------------------------------- */
/*  Delete (blocked when the user has order history)                          */
/* -------------------------------------------------------------------------- */

export type DeleteAdminUserError =
  | { code: "not_found" }
  | { code: "self_action"; message: string }
  | {
      code: "has_orders";
      orderCount: number;
      message: string;
    };

export interface DeleteAdminUserInput {
  userId: string;
  /** The acting admin's user id (must differ from `userId`). */
  actorUserId: string;
}

export type DeleteAdminUserResult =
  | { ok: true }
  | { ok: false; error: DeleteAdminUserError };

export async function deleteAdminUser(
  input: DeleteAdminUserInput,
): Promise<DeleteAdminUserResult> {
  if (!isUuid(input.userId)) {
    return { ok: false, error: { code: "not_found" } };
  }
  if (input.userId === input.actorUserId) {
    return {
      ok: false,
      error: {
        code: "self_action",
        message: "An admin cannot delete their own account",
      },
    };
  }

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (existing.length === 0) {
    return { ok: false, error: { code: "not_found" } };
  }

  // Block deletion of users with order history. orders.user_id is
  // `restrict` so the FK would refuse the DELETE anyway — but we want a
  // typed error and a precise count for the error body.
  const counts = await db
    .select({ count: count() })
    .from(orders)
    .where(eq(orders.userId, input.userId));
  const orderCount = counts[0]?.count ?? 0;
  if (orderCount > 0) {
    return {
      ok: false,
      error: {
        code: "has_orders",
        orderCount,
        message:
          "User has order history and cannot be deleted; disable the account instead.",
      },
    };
  }

  try {
    await db.delete(users).where(eq(users.id, input.userId));
  } catch (err: unknown) {
    // Race: an order was inserted between the count and the delete.
    // Surface the same `has_orders` error so the route layer maps to
    // the same 409 in both code paths.
    const message = err instanceof Error ? err.message : String(err);
    if (/foreign key|orders_user_id/i.test(message)) {
      return {
        ok: false,
        error: {
          code: "has_orders",
          orderCount: 0,
          message:
            "User has order history and cannot be deleted; disable the account instead.",
        },
      };
    }
    throw err;
  }

  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/*  Misc helpers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * `users.role` values surfaced through admin UIs. Accepts `"user"` and
 * `"admin"` today; future roles can be added without touching the
 * routes (they validate against this list).
 */
export const ADMIN_USER_ROLES = ["user", "admin"] as const;
export type AdminUserRole = (typeof ADMIN_USER_ROLES)[number];

export function isAdminUserRole(value: string): value is AdminUserRole {
  return (ADMIN_USER_ROLES as readonly string[]).includes(value);
}

// Re-export the unique guards (intentionally no `ne` user — included
// here so future endpoints that need a "every user except me" probe
// can use the helper without a fresh import).
export { ne as neUserId };
