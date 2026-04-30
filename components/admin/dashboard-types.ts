/**
 * Admin dashboard client-side types.
 *
 * Mirrors the public payloads exposed by `lib/server/admin-analytics.ts`
 * so the dashboard view can render against the API responses without
 * importing any server-only modules. Keep these shapes in lock-step with
 * `app/api/admin/analytics/**` — they are the contract those routes
 * return to the browser.
 */

export type DashboardOrderStatus =
  | "pending"
  | "paid"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled"
  | (string & {});

export interface DashboardSummary {
  totalOrders: number;
  paidOrders: number;
  cancelledOrders: number;
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  revenueCents: number;
  cancelledRevenueCents: number;
  itemsSold: number;
  averageOrderValueCents: number;
  currency: string;
  range: { from: string | null; to: string | null };
  generatedAt: string;
}

export interface DashboardOrdersByStatusEntry {
  status: DashboardOrderStatus;
  count: number;
  revenueCents: number;
}

export interface DashboardOrdersByStatus {
  items: DashboardOrdersByStatusEntry[];
  totalOrders: number;
  range: { from: string | null; to: string | null };
  generatedAt: string;
}

export type DashboardTopProductsSortBy = "quantity" | "revenue";

export interface DashboardTopProductRow {
  productId: string | null;
  sku: string;
  name: string;
  slug: string | null;
  primaryImageUrl: string | null;
  quantitySold: number;
  revenueCents: number;
  ordersCount: number;
  currency: string;
}

export interface DashboardTopProducts {
  items: DashboardTopProductRow[];
  sortBy: DashboardTopProductsSortBy;
  limit: number;
  range: { from: string | null; to: string | null };
  generatedAt: string;
}

export interface DashboardRecentOrderEntry {
  id: string;
  orderNumber: string;
  status: DashboardOrderStatus;
  totalCents: number;
  currency: string;
  itemCount: number;
  customer: { id: string; email: string; name: string | null };
  createdAt: string;
}

export interface DashboardRecentOrders {
  items: DashboardRecentOrderEntry[];
  range: { from: string | null; to: string | null };
  generatedAt: string;
}

export interface DashboardBundle {
  summary: DashboardSummary;
  byStatus: DashboardOrdersByStatus;
  topProducts: DashboardTopProducts;
  recentOrders: DashboardRecentOrders;
}

/**
 * Quick-range presets surfaced in the date selector. `custom` exposes
 * the two `<input type="date" />` fields for ad-hoc windows. `all`
 * clears both bounds.
 */
export const DASHBOARD_DATE_RANGES = [
  "7d",
  "30d",
  "90d",
  "ytd",
  "all",
  "custom",
] as const;
export type DashboardDateRange = (typeof DASHBOARD_DATE_RANGES)[number];

export const DASHBOARD_DATE_RANGE_OPTIONS: ReadonlyArray<{
  value: DashboardDateRange;
  label: string;
}> = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "ytd", label: "Year to date" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom range" },
];

export interface DashboardApiError {
  error: string;
  code: string;
  fieldErrors?: Record<string, string[]>;
}
