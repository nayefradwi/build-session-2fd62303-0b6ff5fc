"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Boxes,
  CalendarRange,
  ChevronRight,
  CircleDollarSign,
  Loader2,
  PackageCheck,
  ShoppingBag,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OrderStatusBadge } from "@/components/account/order-status-badge";
import {
  DASHBOARD_DATE_RANGE_OPTIONS,
  type DashboardApiError,
  type DashboardBundle,
  type DashboardDateRange,
  type DashboardOrdersByStatus,
  type DashboardRecentOrders,
  type DashboardSummary,
  type DashboardTopProducts,
  type DashboardTopProductsSortBy,
} from "@/components/admin/dashboard-types";
import { formatPrice } from "@/lib/client/format";
import { cn } from "@/lib/client/utils";

interface DashboardViewProps {
  initialBundle: DashboardBundle;
  initialRange: DashboardDateRange;
  initialDateFrom: string;
  initialDateTo: string;
  initialSortBy: DashboardTopProductsSortBy;
}

/* -------------------------------------------------------------------------- */
/*  Date helpers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Convert a quick-range preset + custom inputs into ISO 8601 bounds the
 * analytics API accepts. Returns `null` for either side when there is no
 * bound (the API treats `null` as "no filter").
 *
 * The `from` value snaps to the start of the day (UTC) so a range like
 * "Last 7 days" actually catches 7 calendar days; the `to` value snaps
 * to the end of the day so an order placed at 23:59 still lands inside
 * the window.
 */
function rangeToIsoBounds(
  range: DashboardDateRange,
  customFrom: string,
  customTo: string,
): { from: string | null; to: string | null } {
  const now = new Date();
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
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
  const startOfYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0, 0));

  switch (range) {
    case "7d":
      return { from: daysAgo(7).toISOString(), to: endOfToday.toISOString() };
    case "30d":
      return { from: daysAgo(30).toISOString(), to: endOfToday.toISOString() };
    case "90d":
      return { from: daysAgo(90).toISOString(), to: endOfToday.toISOString() };
    case "ytd":
      return { from: startOfYear.toISOString(), to: endOfToday.toISOString() };
    case "all":
      return { from: null, to: null };
    case "custom": {
      const fromIso = parseDateInput(customFrom, false);
      const toIso = parseDateInput(customTo, true);
      return { from: fromIso, to: toIso };
    }
    default:
      return { from: null, to: null };
  }
}

/**
 * Parse a `<input type="date" />` value (yyyy-MM-dd) into an ISO 8601
 * UTC string anchored to either the start or end of day. Returns `null`
 * for empty / unparseable input so callers can pass it straight through
 * to the API.
 */
function parseDateInput(raw: string, endOfDay: boolean): string | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return null;
  const [_, y, mo, d] = m;
  void _;
  const date = endOfDay
    ? new Date(Date.UTC(+y, +mo - 1, +d, 23, 59, 59, 999))
    : new Date(Date.UTC(+y, +mo - 1, +d, 0, 0, 0, 0));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/** Friendly long-form date for the header subtitle. */
function formatLongDate(iso: string | null): string {
  if (!iso) return "earliest";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "earliest";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Friendly date+time for the recent orders table. */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/* -------------------------------------------------------------------------- */
/*  Network                                                                   */
/* -------------------------------------------------------------------------- */

function buildBundleQuery(args: {
  from: string | null;
  to: string | null;
  sortBy: DashboardTopProductsSortBy;
}): { summary: string; byStatus: string; topProducts: string; recent: string } {
  const baseParams = new URLSearchParams();
  if (args.from) baseParams.set("dateFrom", args.from);
  if (args.to) baseParams.set("dateTo", args.to);
  const baseQs = baseParams.toString();
  const baseSuffix = baseQs.length === 0 ? "" : `?${baseQs}`;

  const topParams = new URLSearchParams(baseParams);
  topParams.set("sortBy", args.sortBy);
  topParams.set("limit", "5");

  const recentParams = new URLSearchParams(baseParams);
  recentParams.set("limit", "8");

  return {
    summary: `/api/admin/analytics/summary${baseSuffix}`,
    byStatus: `/api/admin/analytics/orders-by-status${baseSuffix}`,
    topProducts: `/api/admin/analytics/top-products?${topParams.toString()}`,
    recent: `/api/admin/analytics/recent-orders?${recentParams.toString()}`,
  };
}

async function readApiError(res: Response): Promise<DashboardApiError | null> {
  try {
    return (await res.json()) as DashboardApiError;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*  URL serialisation                                                         */
/* -------------------------------------------------------------------------- */

function buildSearchString(args: {
  range: DashboardDateRange;
  dateFrom: string;
  dateTo: string;
  sortBy: DashboardTopProductsSortBy;
}): string {
  const params = new URLSearchParams();
  if (args.range !== "30d") params.set("range", args.range);
  if (args.range === "custom") {
    if (args.dateFrom) params.set("dateFrom", args.dateFrom);
    if (args.dateTo) params.set("dateTo", args.dateTo);
  }
  if (args.sortBy !== "revenue") params.set("sortBy", args.sortBy);
  const qs = params.toString();
  return qs.length === 0 ? "" : `?${qs}`;
}

/* -------------------------------------------------------------------------- */
/*  Dashboard view                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Admin > Dashboard. Owns the date-range selector, the four metric
 * cards, the orders-by-status breakdown bar chart, the top-products
 * leaderboard, and the recent-orders table.
 *
 * Keeps initial paint server-rendered through `initialBundle` so the
 * first view is fully populated. Subsequent range changes re-fetch all
 * four endpoints in parallel and patch the bundle in-place.
 */
export function DashboardView({
  initialBundle,
  initialRange,
  initialDateFrom,
  initialDateTo,
  initialSortBy,
}: DashboardViewProps) {
  const router = useRouter();

  const [bundle, setBundle] = React.useState<DashboardBundle>(initialBundle);
  const [range, setRange] = React.useState<DashboardDateRange>(initialRange);
  const [dateFrom, setDateFrom] = React.useState(initialDateFrom);
  const [dateTo, setDateTo] = React.useState(initialDateTo);
  const [sortBy, setSortBy] =
    React.useState<DashboardTopProductsSortBy>(initialSortBy);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => setBundle(initialBundle), [initialBundle]);
  React.useEffect(() => setRange(initialRange), [initialRange]);
  React.useEffect(() => setDateFrom(initialDateFrom), [initialDateFrom]);
  React.useEffect(() => setDateTo(initialDateTo), [initialDateTo]);
  React.useEffect(() => setSortBy(initialSortBy), [initialSortBy]);

  const refresh = React.useCallback(
    async (args: {
      range: DashboardDateRange;
      dateFrom: string;
      dateTo: string;
      sortBy: DashboardTopProductsSortBy;
    }) => {
      const bounds = rangeToIsoBounds(args.range, args.dateFrom, args.dateTo);
      // Custom range with from > to — bail early so we don't hammer the API
      // with a 400 response.
      if (
        args.range === "custom" &&
        bounds.from &&
        bounds.to &&
        new Date(bounds.from).getTime() > new Date(bounds.to).getTime()
      ) {
        toast.error("Invalid date range", {
          description: "“From” must be earlier than or equal to “To”.",
        });
        return;
      }
      const urls = buildBundleQuery({ ...bounds, sortBy: args.sortBy });
      setLoading(true);
      try {
        const [summaryRes, byStatusRes, topRes, recentRes] = await Promise.all([
          fetch(urls.summary, {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store",
          }),
          fetch(urls.byStatus, {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store",
          }),
          fetch(urls.topProducts, {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store",
          }),
          fetch(urls.recent, {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store",
          }),
        ]);

        // Auth failures bubble up first; the rest of the responses are
        // moot if the session is gone.
        if (
          summaryRes.status === 401 ||
          byStatusRes.status === 401 ||
          topRes.status === 401 ||
          recentRes.status === 401
        ) {
          router.replace("/login?next=/admin/dashboard");
          return;
        }
        if (
          summaryRes.status === 403 ||
          byStatusRes.status === 403 ||
          topRes.status === 403 ||
          recentRes.status === 403
        ) {
          toast.error("Admin access required", {
            description: "Your account doesn't have permission to view analytics.",
          });
          return;
        }
        if (!summaryRes.ok || !byStatusRes.ok || !topRes.ok || !recentRes.ok) {
          const failing = [summaryRes, byStatusRes, topRes, recentRes].find(
            (r) => !r.ok,
          );
          const body = failing ? await readApiError(failing) : null;
          toast.error("Couldn't load dashboard", {
            description:
              body?.error ?? "Something went wrong. Please try again.",
          });
          return;
        }

        const [summary, byStatus, topProducts, recentOrders] =
          (await Promise.all([
            summaryRes.json(),
            byStatusRes.json(),
            topRes.json(),
            recentRes.json(),
          ])) as [
            DashboardSummary,
            DashboardOrdersByStatus,
            DashboardTopProducts,
            DashboardRecentOrders,
          ];

        setBundle({ summary, byStatus, topProducts, recentOrders });

        const search = buildSearchString({
          range: args.range,
          dateFrom: args.dateFrom,
          dateTo: args.dateTo,
          sortBy: args.sortBy,
        });
        router.replace(`/admin/dashboard${search}`);
      } catch (err) {
        toast.error("Network error", {
          description:
            err instanceof Error
              ? err.message
              : "Could not reach the server. Please try again.",
        });
      } finally {
        setLoading(false);
      }
    },
    [router],
  );

  const onRangeChange = (next: DashboardDateRange) => {
    setRange(next);
    if (next !== "custom") {
      // Quick-range presets fire immediately — no need to wait for the
      // user to click anything.
      void refresh({
        range: next,
        dateFrom,
        dateTo,
        sortBy,
      });
    }
  };

  const onApplyCustom = () => {
    void refresh({ range: "custom", dateFrom, dateTo, sortBy });
  };

  const onSortChange = (next: DashboardTopProductsSortBy) => {
    if (next === sortBy) return;
    setSortBy(next);
    void refresh({ range, dateFrom, dateTo, sortBy: next });
  };

  /* ---------------- Derived ---------------- */

  const { summary, byStatus, topProducts, recentOrders } = bundle;

  const subtitle = React.useMemo(() => {
    if (range === "all" || (!summary.range.from && !summary.range.to)) {
      return "All time";
    }
    return `${formatLongDate(summary.range.from)} → ${formatLongDate(summary.range.to)}`;
  }, [range, summary.range.from, summary.range.to]);

  return (
    <div className="space-y-6" data-testid="admin-dashboard">
      {/* Header + date range selector */}
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-xl">
              <TrendingUp className="h-5 w-5 text-sky-600" aria-hidden="true" />
              Dashboard
            </CardTitle>
            <CardDescription>
              Sales, fulfilment, and product performance at a glance.
            </CardDescription>
            <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
              <CalendarRange className="h-3.5 w-3.5" aria-hidden="true" />
              <span data-testid="admin-dashboard-range-label">{subtitle}</span>
              {loading && (
                <span className="inline-flex items-center gap-1">
                  <Loader2
                    className="h-3 w-3 animate-spin"
                    aria-hidden="true"
                  />
                  Refreshing
                </span>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className="flex flex-wrap gap-2"
            role="radiogroup"
            aria-label="Date range"
          >
            {DASHBOARD_DATE_RANGE_OPTIONS.map((opt) => {
              const active = opt.value === range;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onRangeChange(opt.value)}
                  data-testid={`admin-dashboard-range-${opt.value}`}
                  className={cn(
                    "inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "border-sky-500 bg-sky-50 text-sky-900 hover:bg-sky-100 dark:border-sky-400 dark:bg-sky-900/30 dark:text-sky-100"
                      : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {range === "custom" && (
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="dashboard-date-from" className="text-sm">
                  From
                </Label>
                <Input
                  id="dashboard-date-from"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  data-testid="admin-dashboard-date-from"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dashboard-date-to" className="text-sm">
                  To
                </Label>
                <Input
                  id="dashboard-date-to"
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  data-testid="admin-dashboard-date-to"
                />
              </div>
              <Button
                type="button"
                size="sm"
                onClick={onApplyCustom}
                disabled={loading}
                className="bg-sky-600 text-white hover:bg-sky-700"
                data-testid="admin-dashboard-apply"
              >
                Apply
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Metric tiles */}
      <MetricsGrid summary={summary} loading={loading} />

      {/* Two-column secondary section */}
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <OrdersByStatusCard data={byStatus} />
        </div>
        <div className="lg:col-span-2">
          <TopProductsCard
            data={topProducts}
            sortBy={sortBy}
            onSortChange={onSortChange}
          />
        </div>
      </div>

      {/* Recent orders */}
      <RecentOrdersCard data={recentOrders} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Metric tiles                                                              */
/* -------------------------------------------------------------------------- */

interface MetricTileProps {
  label: string;
  value: string;
  hint?: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  testId: string;
  loading?: boolean;
}

function MetricTile({ label, value, hint, icon: Icon, testId, loading }: MetricTileProps) {
  return (
    <Card data-testid={testId} className="overflow-hidden">
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div className="min-w-0 space-y-1">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          <div
            className={cn(
              "truncate text-2xl font-semibold tracking-tight",
              loading && "text-muted-foreground/70",
            )}
          >
            {value}
          </div>
          {hint && (
            <div className="text-xs text-muted-foreground">{hint}</div>
          )}
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-300">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
      </CardContent>
    </Card>
  );
}

function MetricsGrid({
  summary,
  loading,
}: {
  summary: DashboardSummary;
  loading: boolean;
}) {
  const currency = summary.currency || "USD";
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <MetricTile
        label="Revenue"
        value={formatPrice(summary.revenueCents, currency)}
        hint={
          summary.cancelledRevenueCents > 0
            ? `${formatPrice(summary.cancelledRevenueCents, currency)} cancelled`
            : "Excludes cancelled orders"
        }
        icon={CircleDollarSign}
        testId="admin-dashboard-metric-revenue"
        loading={loading}
      />
      <MetricTile
        label="Orders"
        value={summary.totalOrders.toLocaleString()}
        hint={
          <>
            <span className="font-medium text-foreground">
              {summary.paidOrders.toLocaleString()}
            </span>{" "}
            paid · {summary.cancelledOrders.toLocaleString()} cancelled
          </>
        }
        icon={ShoppingBag}
        testId="admin-dashboard-metric-orders"
        loading={loading}
      />
      <MetricTile
        label="Avg. order value"
        value={formatPrice(summary.averageOrderValueCents, currency)}
        hint={
          summary.paidOrders > 0
            ? `Across ${summary.paidOrders.toLocaleString()} paid orders`
            : "No paid orders yet"
        }
        icon={PackageCheck}
        testId="admin-dashboard-metric-aov"
        loading={loading}
      />
      <MetricTile
        label="Items sold"
        value={summary.itemsSold.toLocaleString()}
        hint={
          summary.discountCents > 0
            ? `${formatPrice(summary.discountCents, currency)} discounts applied`
            : "No discounts in window"
        }
        icon={Boxes}
        testId="admin-dashboard-metric-items"
        loading={loading}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Orders by status (lightweight horizontal bar chart)                       */
/* -------------------------------------------------------------------------- */

function OrdersByStatusCard({ data }: { data: DashboardOrdersByStatus }) {
  const max = Math.max(1, ...data.items.map((i) => i.count));
  const empty = data.totalOrders === 0;

  return (
    <Card data-testid="admin-dashboard-by-status" className="h-full">
      <CardHeader>
        <CardTitle className="text-base">Orders by status</CardTitle>
        <CardDescription>
          {empty
            ? "No orders in this window."
            : `${data.totalOrders.toLocaleString()} order${
                data.totalOrders === 1 ? "" : "s"
              } across all statuses.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {empty ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 p-6 text-center">
            <p className="text-sm font-medium">Nothing to chart yet</p>
            <p className="text-xs text-muted-foreground">
              Once orders come in they'll appear here, broken down by
              fulfilment status.
            </p>
          </div>
        ) : (
          <ul className="space-y-3" role="list">
            {data.items.map((row) => {
              const widthPct = Math.max(
                row.count === 0 ? 0 : 4,
                Math.round((row.count / max) * 100),
              );
              return (
                <li
                  key={row.status}
                  className="space-y-1.5"
                  data-testid={`admin-dashboard-by-status-row-${row.status}`}
                >
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <OrderStatusBadge status={row.status} />
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono text-xs text-foreground">
                        {row.count.toLocaleString()}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{formatPrice(row.revenueCents, "USD")}</span>
                    </div>
                  </div>
                  <div
                    className="h-2 w-full overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={data.totalOrders}
                    aria-valuenow={row.count}
                    aria-label={`${row.status}: ${row.count} orders`}
                  >
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        statusBarClass(row.status),
                      )}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Per-status bar fill colour. Mirrors the badge palette on
 * `OrderStatusBadge` so the chart and pills read as a single set, with
 * a subtle muted fallback for any future status that hasn't been
 * styled yet.
 */
function statusBarClass(status: string): string {
  switch (status) {
    case "pending":
      return "bg-amber-500";
    case "paid":
    case "processing":
      return "bg-sky-500";
    case "shipped":
      return "bg-indigo-500";
    case "delivered":
      return "bg-emerald-500";
    case "cancelled":
      return "bg-rose-500";
    default:
      return "bg-muted-foreground/60";
  }
}

/* -------------------------------------------------------------------------- */
/*  Top products                                                              */
/* -------------------------------------------------------------------------- */

function TopProductsCard({
  data,
  sortBy,
  onSortChange,
}: {
  data: DashboardTopProducts;
  sortBy: DashboardTopProductsSortBy;
  onSortChange: (s: DashboardTopProductsSortBy) => void;
}) {
  const empty = data.items.length === 0;
  const max =
    Math.max(
      1,
      ...data.items.map((i) =>
        sortBy === "quantity" ? i.quantitySold : i.revenueCents,
      ),
    ) || 1;

  return (
    <Card data-testid="admin-dashboard-top-products" className="h-full">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Top products</CardTitle>
          <CardDescription>Ranked by {sortBy}.</CardDescription>
        </div>
        <div
          className="inline-flex shrink-0 items-center rounded-md border border-input bg-background p-0.5 text-xs"
          role="tablist"
          aria-label="Sort top products"
        >
          {(
            [
              { value: "revenue", label: "Revenue" },
              { value: "quantity", label: "Units" },
            ] as const
          ).map((opt) => {
            const active = sortBy === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSortChange(opt.value)}
                data-testid={`admin-dashboard-top-products-sort-${opt.value}`}
                className={cn(
                  "rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
                  active
                    ? "bg-sky-600 text-white"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </CardHeader>
      <CardContent>
        {empty ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 p-6 text-center">
            <p className="text-sm font-medium">No products sold yet</p>
            <p className="text-xs text-muted-foreground">
              Top sellers will appear here as orders come in.
            </p>
          </div>
        ) : (
          <ol className="space-y-3" role="list">
            {data.items.map((row, idx) => {
              const value =
                sortBy === "quantity" ? row.quantitySold : row.revenueCents;
              const widthPct = Math.max(
                value === 0 ? 0 : 4,
                Math.round((value / max) * 100),
              );
              return (
                <li
                  key={`${row.productId ?? "missing"}-${row.sku}`}
                  className="space-y-1.5"
                  data-testid={`admin-dashboard-top-product-${idx + 1}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-50 text-xs font-semibold text-sky-700 dark:bg-sky-900/40 dark:text-sky-200">
                      {idx + 1}
                    </span>
                    {row.primaryImageUrl ? (
                      <Image
                        src={row.primaryImageUrl}
                        alt=""
                        width={36}
                        height={36}
                        className="h-9 w-9 shrink-0 rounded-md object-cover"
                        unoptimized
                      />
                    ) : (
                      <div
                        aria-hidden="true"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] uppercase text-muted-foreground"
                      >
                        {row.sku.slice(0, 3)}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        {row.slug ? (
                          <Link
                            href={`/products/${row.slug}`}
                            className="truncate font-medium hover:underline"
                          >
                            {row.name}
                          </Link>
                        ) : (
                          <span className="truncate font-medium">
                            {row.name}
                          </span>
                        )}
                        <span className="shrink-0 font-mono text-xs text-foreground">
                          {sortBy === "quantity"
                            ? `${row.quantitySold.toLocaleString()} sold`
                            : formatPrice(row.revenueCents, row.currency)}
                        </span>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        SKU {row.sku} ·{" "}
                        {row.ordersCount.toLocaleString()} order
                        {row.ordersCount === 1 ? "" : "s"}
                      </div>
                    </div>
                  </div>
                  <div
                    className="ml-9 h-1.5 overflow-hidden rounded-full bg-muted"
                    aria-hidden="true"
                  >
                    <div
                      className="h-full rounded-full bg-sky-500 transition-all"
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  Recent orders                                                             */
/* -------------------------------------------------------------------------- */

function RecentOrdersCard({ data }: { data: DashboardRecentOrders }) {
  const empty = data.items.length === 0;
  return (
    <Card data-testid="admin-dashboard-recent-orders">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Recent orders</CardTitle>
          <CardDescription>
            Latest orders in the selected range.
          </CardDescription>
        </div>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="self-start text-sky-700 hover:bg-sky-50 hover:text-sky-800 dark:text-sky-300 dark:hover:bg-sky-900/40"
        >
          <Link
            href="/admin/orders"
            data-testid="admin-dashboard-recent-orders-all"
          >
            View all
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {empty ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 p-6 text-center">
            <p className="text-sm font-medium">No recent orders</p>
            <p className="text-xs text-muted-foreground">
              When customers place orders in this date range they'll show
              up here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Order</th>
                  <th className="px-3 py-2 font-medium">Customer</th>
                  <th className="px-3 py-2 font-medium">Placed</th>
                  <th className="px-3 py-2 font-medium">Items</th>
                  <th className="px-3 py-2 font-medium">Total</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.items.map((row) => (
                  <tr
                    key={row.id}
                    className="bg-card transition-colors hover:bg-muted/40"
                    data-testid={`admin-dashboard-recent-order-${row.id}`}
                  >
                    <td className="px-3 py-2 align-top">
                      <Link
                        href={`/admin/orders?selected=${encodeURIComponent(row.id)}`}
                        className="font-mono text-xs font-semibold uppercase hover:underline"
                      >
                        {row.orderNumber}
                      </Link>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="space-y-0.5">
                        <div className="font-medium">
                          {row.customer.name ?? "—"}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {row.customer.email}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(row.createdAt)}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {row.itemCount.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 align-top whitespace-nowrap font-medium">
                      {formatPrice(row.totalCents, row.currency)}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <OrderStatusBadge status={row.status} />
                    </td>
                    <td className="px-3 py-2 align-top text-right">
                      <Link
                        href={`/admin/orders?selected=${encodeURIComponent(row.id)}`}
                        className="inline-flex items-center gap-1 text-xs text-sky-700 hover:underline dark:text-sky-300"
                        aria-label={`Open order ${row.orderNumber}`}
                      >
                        Open
                        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
