/**
 * Admin order-management helpers.
 *
 * Customer-facing reads/writes already live in `lib/server/orders.ts`
 * (`createOrderFromCart`, `listOrdersForUser`, `getOrderForUser`). This
 * module owns the *admin* side of the order surface:
 *
 *   - `listAdminOrders`       — paginated list across every user, with
 *                               status / date-range / free-text search.
 *   - `getAdminOrder`         — full detail (including customer + line
 *                               items + cancellation snapshot).
 *   - `transitionOrderStatus` — Pending → Processing → Shipped →
 *                               Delivered, gated by the linear state
 *                               machine. Refuses transitions that skip a
 *                               step or move backwards.
 *   - `cancelOrder`           — cancel from a non-terminal status with
 *                               a required reason. Snapshots the actor
 *                               and the timestamp onto the order row.
 *   - `streamAdminOrdersCsv`  — CSV export of every order matching the
 *                               same filters as the list endpoint, with
 *                               a stable column header row.
 *
 * The admin routes (`app/api/admin/orders/**`) are a thin shell around
 * these helpers — input parsing + HTTP shaping only.
 *
 * Concurrency: the status / cancel writes use an optimistic guard
 * (`WHERE id = ? AND status = ?`) so two admins racing on the same order
 * never end up in an illegal state — the loser sees a `stale_status`
 * conflict and can retry against the fresh row.
 */
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  lte,
  or,
  sql,
} from "drizzle-orm";

import { db } from "@/lib/db";
import {
  ORDER_STATUSES,
  orderItems,
  orders,
  users,
  type Order,
  type OrderItem,
  type OrderStatus,
  type User,
} from "@/lib/db/schema";

/* -------------------------------------------------------------------------- */
/*  Public payload shapes                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Compact admin list-row. Bigger than the customer list entry — admins
 * need to see who placed the order — but trimmed of the full snapshot
 * line items (those live behind the detail endpoint).
 */
export interface AdminOrderListEntry {
  id: string;
  /**
   * Short, human-friendly form of the order id (the first 8 hex chars
   * of the UUID, upper-cased and prefixed). The full UUID is `id`.
   * Admin tools that need the database id continue to use `id`.
   */
  orderNumber: string;
  status: OrderStatus | string;
  itemCount: number;
  subtotalCents: number;
  shippingCents: number;
  discountCents: number;
  totalCents: number;
  currency: string;
  discountCode: string | null;
  customer: {
    id: string;
    email: string;
    name: string | null;
  };
  shipping: {
    recipient: string | null;
    city: string;
    state: string | null;
    country: string;
  };
  cancellation: {
    reason: string | null;
    cancelledAt: string | null;
    cancelledByUserId: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminOrderDetailItem {
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

export interface AdminOrderDetail extends AdminOrderListEntry {
  notes: string | null;
  shippingAddress: {
    addressId: string | null;
    recipient: string | null;
    phone: string | null;
    line1: string;
    line2: string | null;
    city: string;
    state: string | null;
    postalCode: string;
    country: string;
  };
  items: AdminOrderDetailItem[];
}

/* -------------------------------------------------------------------------- */
/*  Pagination + filter knobs                                                 */
/* -------------------------------------------------------------------------- */

export const ADMIN_ORDERS_DEFAULT_PAGE_SIZE = 25;
export const ADMIN_ORDERS_MAX_PAGE_SIZE = 100;
/** Hard cap on rows streamed from `streamAdminOrdersCsv`. Prevents an
 *  admin export accidentally hammering the DB / response buffer. */
export const ADMIN_ORDERS_EXPORT_MAX = 10_000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

/**
 * Status filter accepted by the admin list endpoint. Allowed values are
 * `"all"` plus any of the canonical `OrderStatus` strings.
 */
export const ADMIN_ORDER_STATUS_FILTERS = [
  "all",
  ...ORDER_STATUSES,
] as const;
export type AdminOrderStatusFilter =
  (typeof ADMIN_ORDER_STATUS_FILTERS)[number];

export function parseAdminOrderStatusFilter(
  raw: string | null,
): AdminOrderStatusFilter | null {
  if (raw === null || raw === "") return "all";
  if (raw === "all") return "all";
  if (isOrderStatus(raw)) return raw;
  return null;
}

export interface ListAdminOrdersInput {
  /** 1-indexed page number. */
  page?: number;
  pageSize?: number;
  status?: AdminOrderStatusFilter;
  /**
   * Free-text search. Matches against the order id, the
   * customer email, the customer name, the recipient, and the
   * snapshotted discount code. Case-insensitive.
   */
  q?: string;
  /**
   * Inclusive lower bound on `orders.created_at` (ISO string or Date).
   * Strings that fail to parse are ignored — the route layer is
   * responsible for surfacing validation errors up-front.
   */
  dateFrom?: string | Date;
  /** Inclusive upper bound on `orders.created_at`. */
  dateTo?: string | Date;
}

export interface ListAdminOrdersResult {
  items: AdminOrderListEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

/* -------------------------------------------------------------------------- */
/*  Mappers                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Render the short admin order number (e.g. `ORD-1A2B3C4D`). Built from
 * the first 8 hex chars of the UUID — every order has a stable, unique
 * short form that is friendlier than the full UUID for support tickets
 * and CSVs without forcing a schema-side display column.
 */
export function shortOrderNumber(id: string): string {
  const head = id.replace(/-/g, "").slice(0, 8).toUpperCase();
  return `ORD-${head}`;
}

function toListEntry(order: Order, customer: User): AdminOrderListEntry {
  return {
    id: order.id,
    orderNumber: shortOrderNumber(order.id),
    status: order.status,
    itemCount: order.itemCount,
    subtotalCents: order.subtotalCents,
    shippingCents: order.shippingCents,
    discountCents: order.discountCents,
    totalCents: order.totalCents,
    currency: order.currency,
    discountCode: order.discountCode ?? null,
    customer: {
      id: customer.id,
      email: customer.email,
      name: customer.name ?? null,
    },
    shipping: {
      recipient: order.shippingRecipient ?? null,
      city: order.shippingCity,
      state: order.shippingState ?? null,
      country: order.shippingCountry,
    },
    cancellation:
      order.cancelledAt ||
      order.cancellationReason ||
      order.cancelledBy
        ? {
            reason: order.cancellationReason ?? null,
            cancelledAt: order.cancelledAt
              ? order.cancelledAt.toISOString()
              : null,
            cancelledByUserId: order.cancelledBy ?? null,
          }
        : null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

function toDetail(
  order: Order,
  customer: User,
  items: OrderItem[],
): AdminOrderDetail {
  const base = toListEntry(order, customer);
  return {
    ...base,
    notes: order.notes ?? null,
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
  };
}

/* -------------------------------------------------------------------------- */
/*  Filter compiler                                                           */
/* -------------------------------------------------------------------------- */

function coerceDate(value: string | Date | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Build the WHERE clause shared by `listAdminOrders` and the CSV export.
 * Returned as a raw SQL fragment so the caller can plug it into either
 * a Drizzle select or a count query.
 */
function buildFilterClause(input: ListAdminOrdersInput) {
  const where: ReturnType<typeof eq>[] = [];

  if (input.status && input.status !== "all" && isOrderStatus(input.status)) {
    where.push(eq(orders.status, input.status));
  }

  const from = coerceDate(input.dateFrom);
  if (from) where.push(gte(orders.createdAt, from));
  const to = coerceDate(input.dateTo);
  if (to) where.push(lte(orders.createdAt, to));

  if (input.q && input.q.trim().length > 0) {
    const term = `%${input.q.trim()}%`;
    // Order-id match: search against the canonical UUID text. Admins
    // routinely paste a full UUID *or* the short prefix, both of which
    // ILIKE handles. We also try a direct UUID equality probe when the
    // term parses as a UUID — `id::text ILIKE` is fine but the equality
    // is index-friendly. We OR them together.
    const idTextSql = sql`${orders.id}::text`;
    const conds = [
      ilike(idTextSql, term),
      ilike(users.email, term),
      ilike(users.name, term),
      ilike(orders.shippingRecipient, term),
      ilike(orders.discountCode, term),
    ];
    if (isUuid(input.q.trim())) {
      conds.push(eq(orders.id, input.q.trim()));
    }
    const combined = or(...conds);
    if (combined) where.push(combined as ReturnType<typeof eq>);
  }

  return where.length === 0 ? undefined : and(...where);
}

/* -------------------------------------------------------------------------- */
/*  List + detail                                                             */
/* -------------------------------------------------------------------------- */

export async function listAdminOrders(
  input: ListAdminOrdersInput = {},
): Promise<ListAdminOrdersResult> {
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.max(
    1,
    Math.min(
      ADMIN_ORDERS_MAX_PAGE_SIZE,
      Math.floor(input.pageSize ?? ADMIN_ORDERS_DEFAULT_PAGE_SIZE),
    ),
  );

  const whereClause = buildFilterClause(input);

  const totalRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .leftJoin(users, eq(users.id, orders.userId))
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
    .select({ order: orders, customer: users })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.userId))
    .where(whereClause)
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const items = rows.map((r) => toListEntry(r.order, r.customer));
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

export async function getAdminOrder(
  orderId: string,
): Promise<AdminOrderDetail | null> {
  if (!isUuid(orderId)) return null;

  const headerRows = await db
    .select({ order: orders, customer: users })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.userId))
    .where(eq(orders.id, orderId))
    .limit(1);
  const header = headerRows[0];
  if (!header) return null;

  const itemRows = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, header.order.id))
    .orderBy(asc(orderItems.createdAt), asc(orderItems.id));

  return toDetail(header.order, header.customer, itemRows);
}

/* -------------------------------------------------------------------------- */
/*  Status transitions                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Linear forward state machine. Cancellation is a separate primitive so
 * `transitionOrderStatus` does not need to know about reasons.
 *
 * `paid` is treated as a synonym of `processing` for the purpose of
 * forward transitions: an order in `paid` status (created via the
 * customer-facing checkout) can be transitioned straight to `shipped`.
 */
const FORWARD_TRANSITIONS: Record<string, OrderStatus[]> = {
  pending: ["processing"],
  paid: ["processing", "shipped"],
  processing: ["shipped"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

/**
 * Statuses an order can be cancelled FROM. Delivered + cancelled orders
 * are terminal and cannot be cancelled again.
 */
export const CANCELLABLE_STATUSES: readonly OrderStatus[] = [
  "pending",
  "paid",
  "processing",
] as const;

export function isCancellableStatus(status: string): status is OrderStatus {
  return (CANCELLABLE_STATUSES as readonly string[]).includes(status);
}

export function listAllowedNextStatuses(current: string): OrderStatus[] {
  return FORWARD_TRANSITIONS[current] ?? [];
}

export type OrderTransitionError =
  | { code: "not_found" }
  | {
      code: "invalid_transition";
      from: string;
      to: string;
      allowed: OrderStatus[];
    }
  | {
      code: "stale_status";
      currentStatus: string;
    }
  | {
      code: "validation_failed";
      message: string;
      fields?: Record<string, string[]>;
    };

export interface TransitionOrderInput {
  orderId: string;
  /** The status the admin is moving the order TO. */
  to: OrderStatus;
  /** Optional admin who triggered the transition (for future audit hooks). */
  userId?: string;
}

export type TransitionOrderResult =
  | { ok: true; data: AdminOrderDetail }
  | { ok: false; error: OrderTransitionError };

/**
 * Transition an order to the given status, gated by the linear state
 * machine. The UPDATE matches on the current `status` value the caller
 * already saw, so two concurrent admins racing on the same order never
 * end up bypassing a step — the loser receives a `stale_status` error
 * and can re-read the order before retrying.
 */
export async function transitionOrderStatus(
  input: TransitionOrderInput,
): Promise<TransitionOrderResult> {
  if (!isUuid(input.orderId)) {
    return { ok: false, error: { code: "not_found" } };
  }
  if (!isOrderStatus(input.to)) {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: "`to` must be a valid order status",
        fields: { to: [`Expected one of: ${ORDER_STATUSES.join(", ")}`] },
      },
    };
  }
  if (input.to === "cancelled") {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: "Use the dedicated cancel endpoint to cancel an order",
        fields: {
          to: [
            "`cancelled` is not a valid forward transition; POST .../cancel instead",
          ],
        },
      },
    };
  }

  const existing = await db
    .select()
    .from(orders)
    .where(eq(orders.id, input.orderId))
    .limit(1);
  const current = existing[0];
  if (!current) {
    return { ok: false, error: { code: "not_found" } };
  }

  const allowed = listAllowedNextStatuses(current.status);
  if (!allowed.includes(input.to)) {
    return {
      ok: false,
      error: {
        code: "invalid_transition",
        from: current.status,
        to: input.to,
        allowed,
      },
    };
  }

  // Optimistic UPDATE: the row only flips when the status is still what
  // we just read. Anything else (a concurrent transition, a cancel) is
  // surfaced as `stale_status`.
  const updated = await db
    .update(orders)
    .set({ status: input.to, updatedAt: new Date() })
    .where(and(eq(orders.id, input.orderId), eq(orders.status, current.status)))
    .returning({ id: orders.id });
  if (updated.length === 0) {
    const fresh = await db
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .limit(1);
    return {
      ok: false,
      error: {
        code: "stale_status",
        currentStatus: fresh[0]?.status ?? current.status,
      },
    };
  }

  const detail = await getAdminOrder(input.orderId);
  if (!detail) {
    // Effectively unreachable — the order existed a moment ago — but
    // keeps the helper total.
    return { ok: false, error: { code: "not_found" } };
  }
  return { ok: true, data: detail };
}

/* -------------------------------------------------------------------------- */
/*  Cancellation                                                              */
/* -------------------------------------------------------------------------- */

export const CANCEL_REASON_MIN = 1;
export const CANCEL_REASON_MAX = 1000;

export type CancelOrderError =
  | { code: "not_found" }
  | {
      code: "not_cancellable";
      currentStatus: string;
      cancellable: readonly OrderStatus[];
    }
  | {
      code: "stale_status";
      currentStatus: string;
    }
  | {
      code: "validation_failed";
      message: string;
      fields?: Record<string, string[]>;
    };

export interface CancelOrderInput {
  orderId: string;
  /** Required free-form admin note. */
  reason: string;
  /** The cancelling admin's user id (snapshotted onto the row). */
  userId: string;
}

export type CancelOrderResult =
  | { ok: true; data: AdminOrderDetail }
  | { ok: false; error: CancelOrderError };

export async function cancelOrder(
  input: CancelOrderInput,
): Promise<CancelOrderResult> {
  if (!isUuid(input.orderId)) {
    return { ok: false, error: { code: "not_found" } };
  }

  if (typeof input.reason !== "string") {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: "`reason` must be a string",
        fields: { reason: ["Expected a string"] },
      },
    };
  }
  const reason = input.reason.trim();
  if (reason.length < CANCEL_REASON_MIN) {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: "`reason` is required",
        fields: { reason: ["A cancellation reason is required"] },
      },
    };
  }
  if (reason.length > CANCEL_REASON_MAX) {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: "`reason` is too long",
        fields: { reason: [`Max ${CANCEL_REASON_MAX} characters`] },
      },
    };
  }

  const existing = await db
    .select()
    .from(orders)
    .where(eq(orders.id, input.orderId))
    .limit(1);
  const current = existing[0];
  if (!current) {
    return { ok: false, error: { code: "not_found" } };
  }
  if (!isCancellableStatus(current.status)) {
    return {
      ok: false,
      error: {
        code: "not_cancellable",
        currentStatus: current.status,
        cancellable: CANCELLABLE_STATUSES,
      },
    };
  }

  const cancelledAt = new Date();
  const updated = await db
    .update(orders)
    .set({
      status: "cancelled",
      cancellationReason: reason,
      cancelledAt,
      cancelledBy: input.userId,
      updatedAt: cancelledAt,
    })
    .where(
      and(
        eq(orders.id, input.orderId),
        eq(orders.status, current.status),
      ),
    )
    .returning({ id: orders.id });

  if (updated.length === 0) {
    const fresh = await db
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .limit(1);
    return {
      ok: false,
      error: {
        code: "stale_status",
        currentStatus: fresh[0]?.status ?? current.status,
      },
    };
  }

  const detail = await getAdminOrder(input.orderId);
  if (!detail) return { ok: false, error: { code: "not_found" } };
  return { ok: true, data: detail };
}

/* -------------------------------------------------------------------------- */
/*  CSV export                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Header row used by the CSV export. Order is intentionally fixed —
 * downstream spreadsheet tooling routinely keys on column position.
 */
export const ADMIN_ORDERS_CSV_COLUMNS = [
  "order_number",
  "id",
  "status",
  "created_at",
  "updated_at",
  "customer_email",
  "customer_name",
  "item_count",
  "subtotal_cents",
  "shipping_cents",
  "discount_cents",
  "total_cents",
  "currency",
  "discount_code",
  "shipping_recipient",
  "shipping_line1",
  "shipping_line2",
  "shipping_city",
  "shipping_state",
  "shipping_postal_code",
  "shipping_country",
  "cancellation_reason",
  "cancelled_at",
] as const;

/**
 * Encode a single field as a CSV cell, RFC 4180 style:
 *   - undefined / null  → empty string
 *   - everything else   → string(value), quoted if it contains
 *                         comma / quote / newline / carriage return.
 *   - embedded `"`      → doubled (`""`).
 */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.length === 0) return "";
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Render a single order row into a CSV-encoded line (no trailing newline).
 * Exposed for tests / future formatters; the export endpoint uses it via
 * `streamAdminOrdersCsv` below.
 */
export function adminOrderToCsvRow(
  entry: AdminOrderListEntry & {
    shippingLine1?: string;
    shippingLine2?: string | null;
    shippingPostalCode?: string;
  },
): string {
  // The list-entry shape doesn't carry the full shipping address columns
  // — overload the entry type here so the export query can pass the
  // full set without re-deriving them.
  const e = entry as AdminOrderListEntry & {
    shippingLine1: string;
    shippingLine2: string | null;
    shippingPostalCode: string;
  };
  const cells: string[] = [
    csvCell(entry.orderNumber),
    csvCell(entry.id),
    csvCell(entry.status),
    csvCell(entry.createdAt),
    csvCell(entry.updatedAt),
    csvCell(entry.customer.email),
    csvCell(entry.customer.name ?? ""),
    csvCell(entry.itemCount),
    csvCell(entry.subtotalCents),
    csvCell(entry.shippingCents),
    csvCell(entry.discountCents),
    csvCell(entry.totalCents),
    csvCell(entry.currency),
    csvCell(entry.discountCode ?? ""),
    csvCell(entry.shipping.recipient ?? ""),
    csvCell(e.shippingLine1 ?? ""),
    csvCell(e.shippingLine2 ?? ""),
    csvCell(entry.shipping.city),
    csvCell(entry.shipping.state ?? ""),
    csvCell(e.shippingPostalCode ?? ""),
    csvCell(entry.shipping.country),
    csvCell(entry.cancellation?.reason ?? ""),
    csvCell(entry.cancellation?.cancelledAt ?? ""),
  ];
  return cells.join(",");
}

/**
 * Render the full export — a header row plus one row per matching order,
 * separated by `\r\n` (the safer of the two RFC 4180 separators).
 *
 * Capped at `ADMIN_ORDERS_EXPORT_MAX` rows. Bigger exports should be
 * paginated by passing `dateFrom` / `dateTo` to chunk the result.
 */
export async function streamAdminOrdersCsv(
  input: ListAdminOrdersInput = {},
  options: { maxRows?: number } = {},
): Promise<{ csv: string; rowCount: number; truncated: boolean }> {
  const maxRows = Math.max(
    1,
    Math.min(ADMIN_ORDERS_EXPORT_MAX, options.maxRows ?? ADMIN_ORDERS_EXPORT_MAX),
  );

  const whereClause = buildFilterClause(input);

  const rows = await db
    .select({ order: orders, customer: users })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.userId))
    .where(whereClause)
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(maxRows + 1);

  const truncated = rows.length > maxRows;
  const usable = truncated ? rows.slice(0, maxRows) : rows;

  const lines: string[] = [];
  lines.push(ADMIN_ORDERS_CSV_COLUMNS.join(","));
  for (const row of usable) {
    const entry = toListEntry(row.order, row.customer);
    const csvRow = adminOrderToCsvRow({
      ...entry,
      shippingLine1: row.order.shippingLine1,
      shippingLine2: row.order.shippingLine2 ?? null,
      shippingPostalCode: row.order.shippingPostalCode,
    });
    lines.push(csvRow);
  }

  return {
    csv: lines.join("\r\n") + "\r\n",
    rowCount: usable.length,
    truncated,
  };
}

/* Re-export for the route layer. */
export { ORDER_STATUSES };
