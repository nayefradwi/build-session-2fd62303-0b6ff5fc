import type { Metadata } from "next";

import { DashboardView } from "@/components/admin/dashboard-view";
import {
  DASHBOARD_DATE_RANGES,
  type DashboardBundle,
  type DashboardDateRange,
  type DashboardTopProductsSortBy,
} from "@/components/admin/dashboard-types";
import {
  getOrdersByStatus,
  getOrdersSummary,
  getRecentOrders,
  getTopProducts,
} from "@/lib/server/admin-analytics";

export const metadata: Metadata = {
  title: "Dashboard",
  description:
    "Headline metrics, orders by status, top products, and recent orders for the storefront.",
};

export const dynamic = "force-dynamic";

interface AdminDashboardPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function pickString(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const raw = params[key];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function parseRange(raw: string | undefined): DashboardDateRange {
  if (!raw) return "30d";
  return (DASHBOARD_DATE_RANGES as readonly string[]).includes(raw)
    ? (raw as DashboardDateRange)
    : "30d";
}

function parseSortBy(raw: string | undefined): DashboardTopProductsSortBy {
  return raw === "quantity" ? "quantity" : "revenue";
}

/**
 * Convert the page's range / custom-date inputs into the actual
 * `dateFrom` / `dateTo` Date instances passed to the analytics
 * helpers. Mirrors the client-side computation in `dashboard-view.tsx`
 * so server-rendered initial paint matches what the same range would
 * produce after a refetch.
 */
function rangeToBounds(
  range: DashboardDateRange,
  dateFrom: string,
  dateTo: string,
): { from: Date | undefined; to: Date | undefined } {
  if (range === "all") return { from: undefined, to: undefined };

  const now = new Date();
  const startOfToday = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      0,
      0,
      0,
      0,
    ),
  );
  const endOfToday = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      23,
      59,
      59,
      999,
    ),
  );
  const daysAgo = (n: number): Date => {
    const d = new Date(startOfToday);
    d.setUTCDate(d.getUTCDate() - (n - 1));
    return d;
  };

  switch (range) {
    case "7d":
      return { from: daysAgo(7), to: endOfToday };
    case "30d":
      return { from: daysAgo(30), to: endOfToday };
    case "90d":
      return { from: daysAgo(90), to: endOfToday };
    case "ytd":
      return {
        from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0, 0)),
        to: endOfToday,
      };
    case "custom": {
      const fromDate = parseDateOnly(dateFrom, false);
      const toDate = parseDateOnly(dateTo, true);
      return { from: fromDate, to: toDate };
    }
    default:
      return { from: undefined, to: undefined };
  }
}

function parseDateOnly(raw: string, endOfDay: boolean): Date | undefined {
  if (!raw) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return undefined;
  const [_, y, mo, d] = m;
  void _;
  const date = endOfDay
    ? new Date(Date.UTC(+y, +mo - 1, +d, 23, 59, 59, 999))
    : new Date(Date.UTC(+y, +mo - 1, +d, 0, 0, 0, 0));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Admin > Dashboard.
 *
 * Server component — performs the initial fetch for the four analytics
 * endpoints in parallel using the shared `lib/server/admin-analytics`
 * helpers (so the first paint is fully populated and indexable). The
 * `/admin` layout already enforces `requireAdmin()` upstream.
 *
 * The URL state is intentionally simple:
 *   - `range`     one of `7d|30d|90d|ytd|all|custom` (default `30d`)
 *   - `dateFrom`  yyyy-MM-dd, only honoured when `range=custom`
 *   - `dateTo`    yyyy-MM-dd, only honoured when `range=custom`
 *   - `sortBy`    `revenue` (default) | `quantity` for top products
 */
export default async function AdminDashboardPage({
  searchParams,
}: AdminDashboardPageProps) {
  const resolved = await searchParams;
  const range = parseRange(pickString(resolved, "range"));
  const sortBy = parseSortBy(pickString(resolved, "sortBy"));
  const dateFromRaw = pickString(resolved, "dateFrom") ?? "";
  const dateToRaw = pickString(resolved, "dateTo") ?? "";
  const bounds = rangeToBounds(range, dateFromRaw, dateToRaw);

  const [summary, byStatus, topProducts, recentOrders] = await Promise.all([
    getOrdersSummary({ dateFrom: bounds.from, dateTo: bounds.to }),
    getOrdersByStatus({ dateFrom: bounds.from, dateTo: bounds.to }),
    getTopProducts({
      dateFrom: bounds.from,
      dateTo: bounds.to,
      sortBy,
      limit: 5,
    }),
    getRecentOrders({
      dateFrom: bounds.from,
      dateTo: bounds.to,
      limit: 8,
    }),
  ]);

  const initialBundle: DashboardBundle = {
    summary,
    byStatus,
    topProducts,
    recentOrders,
  };

  return (
    <DashboardView
      initialBundle={initialBundle}
      initialRange={range}
      initialDateFrom={dateFromRaw}
      initialDateTo={dateToRaw}
      initialSortBy={sortBy}
    />
  );
}
