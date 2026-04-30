/**
 * Admin orders client-side types.
 *
 * Mirrors the public payloads exposed by `lib/server/admin-orders.ts` so
 * the list / detail / drawer components can render against the API
 * response without dragging the Drizzle client (or `next/headers`)
 * into the browser bundle.
 *
 * Keep these shapes in lock-step with the server module — they are the
 * contract `app/api/admin/orders/**` returns to the browser.
 */

export const ADMIN_ORDER_STATUS_FILTERS = [
  "all",
  "pending",
  "paid",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
] as const;
export type AdminOrderStatusFilter =
  (typeof ADMIN_ORDER_STATUS_FILTERS)[number];

export const ADMIN_ORDER_STATUSES = [
  "pending",
  "paid",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
] as const;
export type AdminOrderStatus = (typeof ADMIN_ORDER_STATUSES)[number];

/**
 * Statuses an order can be cancelled FROM. `delivered` and `cancelled`
 * are terminal; the cancel button is hidden once the order reaches
 * either. Mirrors `CANCELLABLE_STATUSES` in `lib/server/admin-orders.ts`.
 */
export const ADMIN_CANCELLABLE_STATUSES: ReadonlyArray<AdminOrderStatus> = [
  "pending",
  "paid",
  "processing",
];

/**
 * Linear forward state machine the admin transition endpoint accepts.
 * Mirrors `FORWARD_TRANSITIONS` in `lib/server/admin-orders.ts`. Used to
 * decide which status buttons to surface in the detail drawer.
 */
export const ADMIN_FORWARD_TRANSITIONS: Record<string, AdminOrderStatus[]> = {
  pending: ["processing"],
  paid: ["processing", "shipped"],
  processing: ["shipped"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

export interface AdminOrderListEntry {
  id: string;
  orderNumber: string;
  status: AdminOrderStatus | string;
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

export interface AdminOrdersListResult {
  items: AdminOrderListEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface AdminOrderApiError {
  error: string;
  code: string;
  fieldErrors?: Record<string, string[]>;
  details?: Record<string, unknown>;
}

/**
 * The status filter chips the admin list page surfaces. Order intentional —
 * `all` first, then the customer-side journey, with `cancelled` last.
 */
export const ADMIN_ORDER_STATUS_FILTER_OPTIONS: ReadonlyArray<{
  value: AdminOrderStatusFilter;
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "paid", label: "Paid" },
  { value: "processing", label: "Processing" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];
