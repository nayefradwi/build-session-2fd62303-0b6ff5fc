"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, Search } from "lucide-react";
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
  ADMIN_ORDER_STATUS_FILTER_OPTIONS,
  type AdminOrderApiError,
  type AdminOrderListEntry,
  type AdminOrderStatusFilter,
  type AdminOrdersListResult,
} from "@/components/admin/orders-types";
import { OrderDetailDrawer } from "@/components/admin/order-detail-drawer";
import { formatPrice } from "@/lib/client/format";

interface OrdersListProps {
  initialData: AdminOrdersListResult;
  initialQuery: string;
  initialStatus: AdminOrderStatusFilter;
  initialDateFrom: string;
  initialDateTo: string;
  initialOrderId: string | null;
}

/**
 * Build the Next.js search-params string the page should live at after a
 * filter / pagination change. Empty values are stripped so the URL stays
 * clean for the unfiltered first page.
 */
function buildSearchString(args: {
  q: string;
  status: AdminOrderStatusFilter;
  dateFrom: string;
  dateTo: string;
  page: number;
  selected?: string | null;
}): string {
  const params = new URLSearchParams();
  if (args.q.trim().length > 0) params.set("q", args.q.trim());
  if (args.status !== "all") params.set("status", args.status);
  if (args.dateFrom.length > 0) params.set("dateFrom", args.dateFrom);
  if (args.dateTo.length > 0) params.set("dateTo", args.dateTo);
  if (args.page > 1) params.set("page", String(args.page));
  if (args.selected) params.set("selected", args.selected);
  const qs = params.toString();
  return qs.length === 0 ? "" : `?${qs}`;
}

/**
 * Build the API URL the list refresh fetches from. Mirrors the search
 * params accepted by `GET /api/admin/orders` — note the `dateFrom` /
 * `dateTo` are passed through verbatim. The page validates them as
 * ISO 8601, but yyyy-MM-dd works too because `new Date(...)` happily
 * parses both.
 */
function buildApiUrl(args: {
  q: string;
  status: AdminOrderStatusFilter;
  dateFrom: string;
  dateTo: string;
  page: number;
}): string {
  const params = new URLSearchParams();
  if (args.q.trim().length > 0) params.set("q", args.q.trim());
  if (args.status !== "all") params.set("status", args.status);
  if (args.dateFrom.length > 0) params.set("dateFrom", args.dateFrom);
  if (args.dateTo.length > 0) params.set("dateTo", args.dateTo);
  if (args.page > 1) params.set("page", String(args.page));
  const qs = params.toString();
  return qs.length === 0 ? "/api/admin/orders" : `/api/admin/orders?${qs}`;
}

/**
 * The CSV export endpoint accepts the same filter set as the list, minus
 * pagination — the export streams every matching order in one go (capped
 * server-side at `ADMIN_ORDERS_EXPORT_MAX`). We re-use the user's active
 * filters so the file mirrors what they're looking at.
 */
function buildExportUrl(args: {
  q: string;
  status: AdminOrderStatusFilter;
  dateFrom: string;
  dateTo: string;
}): string {
  const params = new URLSearchParams();
  if (args.q.trim().length > 0) params.set("q", args.q.trim());
  if (args.status !== "all") params.set("status", args.status);
  if (args.dateFrom.length > 0) params.set("dateFrom", args.dateFrom);
  if (args.dateTo.length > 0) params.set("dateTo", args.dateTo);
  const qs = params.toString();
  return qs.length === 0
    ? "/api/admin/orders/export"
    : `/api/admin/orders/export?${qs}`;
}

async function readApiError(res: Response): Promise<AdminOrderApiError | null> {
  try {
    return (await res.json()) as AdminOrderApiError;
  } catch {
    return null;
  }
}

function formatDate(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Admin > Orders list. Owns the table view, filter / search / date-range
 * controls, pagination, the Export CSV action, and the row → detail
 * drawer interaction.
 *
 * Detail and write actions (status transitions, cancel-with-reason) live
 * inside the drawer (`OrderDetailDrawer`) so the surface stays a single
 * page from the operator's point of view — no full navigation away from
 * the list while triaging.
 */
export function OrdersList({
  initialData,
  initialQuery,
  initialStatus,
  initialDateFrom,
  initialDateTo,
  initialOrderId,
}: OrdersListProps) {
  const router = useRouter();
  const [data, setData] = React.useState<AdminOrdersListResult>(initialData);
  const [query, setQuery] = React.useState(initialQuery);
  const [status, setStatus] =
    React.useState<AdminOrderStatusFilter>(initialStatus);
  const [dateFrom, setDateFrom] = React.useState(initialDateFrom);
  const [dateTo, setDateTo] = React.useState(initialDateTo);
  const [loading, setLoading] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(
    initialOrderId,
  );

  React.useEffect(() => setData(initialData), [initialData]);
  React.useEffect(() => setQuery(initialQuery), [initialQuery]);
  React.useEffect(() => setStatus(initialStatus), [initialStatus]);
  React.useEffect(() => setDateFrom(initialDateFrom), [initialDateFrom]);
  React.useEffect(() => setDateTo(initialDateTo), [initialDateTo]);
  React.useEffect(() => setSelectedId(initialOrderId), [initialOrderId]);

  const fetchPage = React.useCallback(
    async (args: {
      q: string;
      status: AdminOrderStatusFilter;
      dateFrom: string;
      dateTo: string;
      page: number;
    }) => {
      setLoading(true);
      try {
        const res = await fetch(buildApiUrl(args), {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!res.ok) {
          if (res.status === 401) {
            router.replace("/login?next=/admin/orders");
            return;
          }
          if (res.status === 403) {
            toast.error("Admin access required", {
              description:
                "Your account doesn't have permission to view orders.",
            });
            return;
          }
          const body = await readApiError(res);
          toast.error("Couldn't load orders", {
            description:
              body?.error ?? "Something went wrong. Please try again.",
          });
          return;
        }
        let next: AdminOrdersListResult;
        try {
          next = (await res.json()) as AdminOrdersListResult;
        } catch {
          toast.error("Unexpected response", {
            description: "Could not parse the orders list response.",
          });
          return;
        }
        setData(next);
        const search = buildSearchString({
          ...args,
          selected: selectedId,
        });
        router.replace(`/admin/orders${search}`);
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
    [router, selectedId],
  );

  // Debounce search-box typing + date pickers. The status select fires
  // immediately via its own handler so users get instant feedback when
  // toggling between Pending / Shipped / etc.
  React.useEffect(() => {
    if (
      query === initialQuery &&
      status === initialStatus &&
      dateFrom === initialDateFrom &&
      dateTo === initialDateTo
    ) {
      return;
    }
    const timer = setTimeout(() => {
      void fetchPage({
        q: query,
        status,
        dateFrom,
        dateTo,
        page: 1,
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [
    query,
    status,
    dateFrom,
    dateTo,
    initialQuery,
    initialStatus,
    initialDateFrom,
    initialDateTo,
    fetchPage,
  ]);

  const goToPage = (page: number) => {
    void fetchPage({ q: query, status, dateFrom, dateTo, page });
  };

  const refresh = React.useCallback(
    () =>
      fetchPage({
        q: query,
        status,
        dateFrom,
        dateTo,
        page: data.page,
      }),
    [fetchPage, query, status, dateFrom, dateTo, data.page],
  );

  const clearDates = () => {
    setDateFrom("");
    setDateTo("");
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await fetch(
        buildExportUrl({ q: query, status, dateFrom, dateTo }),
        {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
        },
      );
      if (!res.ok) {
        if (res.status === 401) {
          router.replace("/login?next=/admin/orders");
          return;
        }
        const body = await readApiError(res);
        toast.error("Export failed", {
          description:
            body?.error ?? "Something went wrong. Please try again.",
        });
        return;
      }
      const blob = await res.blob();
      const truncated = res.headers.get("X-Orders-Truncated") === "true";
      const rowCount = res.headers.get("X-Orders-Row-Count");
      const filename =
        parseFilename(res.headers.get("Content-Disposition")) ??
        `orders-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.csv`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      if (truncated) {
        toast.warning("Export truncated", {
          description: `Only the first ${rowCount ?? "10000"} rows were included. Narrow the date range to see the rest.`,
        });
      } else {
        toast.success("Export ready", {
          description: rowCount
            ? `${rowCount} order${rowCount === "1" ? "" : "s"} exported.`
            : undefined,
        });
      }
    } catch (err) {
      toast.error("Network error", {
        description:
          err instanceof Error
            ? err.message
            : "Could not reach the server. Please try again.",
      });
    } finally {
      setExporting(false);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Drawer hooks                                                       */
  /* ------------------------------------------------------------------ */

  const openOrder = (orderId: string) => {
    setSelectedId(orderId);
    const search = buildSearchString({
      q: query,
      status,
      dateFrom,
      dateTo,
      page: data.page,
      selected: orderId,
    });
    router.replace(`/admin/orders${search}`);
  };

  const closeDrawer = () => {
    setSelectedId(null);
    const search = buildSearchString({
      q: query,
      status,
      dateFrom,
      dateTo,
      page: data.page,
      selected: null,
    });
    router.replace(`/admin/orders${search}`);
  };

  /**
   * After a write inside the drawer (status change, cancel) we patch the
   * matching row in the list locally so the operator sees the new pill
   * immediately, then schedule a refetch in the background to pick up
   * any concurrent server-side changes.
   */
  const onOrderUpdated = (updated: AdminOrderListEntry) => {
    setData((prev) => ({
      ...prev,
      items: prev.items.map((row) =>
        row.id === updated.id ? { ...row, ...updated } : row,
      ),
    }));
    void refresh();
  };

  /* ------------------------------------------------------------------ */
  /* Render                                                             */
  /* ------------------------------------------------------------------ */

  const isEmpty = data.items.length === 0;
  const showingFrom =
    data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
  const showingTo = Math.min(data.total, data.page * data.pageSize);

  const filtersActive =
    query.trim().length > 0 ||
    status !== "all" ||
    dateFrom.length > 0 ||
    dateTo.length > 0;

  return (
    <Card data-testid="admin-orders-list">
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle className="text-xl">Orders</CardTitle>
          <CardDescription>
            Triage customer orders, transition fulfilment status, cancel
            with a reason, and export a CSV of the current view.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void exportCsv()}
            disabled={exporting}
            data-testid="admin-orders-export"
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="h-4 w-4" aria-hidden="true" />
            )}
            Export CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 md:grid-cols-[1.4fr_180px_180px_180px] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="orders-search" className="text-sm">
              Search
            </Label>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="orders-search"
                type="search"
                placeholder="Order #, email, name, recipient, code"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
                data-testid="admin-orders-search"
              />
              {query.length > 0 && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-xs text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="orders-status" className="text-sm">
              Status
            </Label>
            <select
              id="orders-status"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as AdminOrderStatusFilter)
              }
              data-testid="admin-orders-status"
            >
              {ADMIN_ORDER_STATUS_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="orders-date-from" className="text-sm">
              From
            </Label>
            <Input
              id="orders-date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              data-testid="admin-orders-date-from"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="orders-date-to" className="text-sm">
              To
            </Label>
            <Input
              id="orders-date-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              data-testid="admin-orders-date-to"
            />
          </div>
        </div>

        {filtersActive && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Filters applied.</span>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setStatus("all");
                clearDates();
              }}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
            >
              Clear all
            </button>
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading…
          </div>
        )}

        {isEmpty && !loading ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 p-8 text-center">
            <p className="text-sm font-medium">
              {filtersActive ? "No orders match those filters" : "No orders yet"}
            </p>
            <p className="text-sm text-muted-foreground">
              {filtersActive
                ? "Try clearing the search, status, or date range."
                : "When customers place orders, they'll show up here."}
            </p>
          </div>
        ) : (
          <>
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
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.items.map((row) => (
                    <tr
                      key={row.id}
                      className="cursor-pointer bg-card transition-colors hover:bg-muted/40 data-[selected=true]:bg-muted/50"
                      data-testid={`admin-orders-row-${row.id}`}
                      data-selected={
                        selectedId === row.id ? "true" : undefined
                      }
                      onClick={() => openOrder(row.id)}
                    >
                      <td className="px-3 py-2 align-top">
                        <div className="space-y-1">
                          <div className="font-mono text-xs font-semibold uppercase">
                            {row.orderNumber}
                          </div>
                          {row.discountCode && (
                            <div className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200">
                              {row.discountCode}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="space-y-0.5">
                          <div className="font-medium">
                            {row.customer.name ?? row.shipping.recipient ?? "—"}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {row.customer.email}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {row.shipping.city}
                            {row.shipping.state
                              ? `, ${row.shipping.state}`
                              : ""}
                            , {row.shipping.country}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top whitespace-nowrap text-xs text-muted-foreground">
                        {formatDate(row.createdAt)}
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
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            openOrder(row.id);
                          }}
                          data-testid={`admin-orders-view-${row.id}`}
                        >
                          View
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>
                Showing {showingFrom.toLocaleString()}–
                {showingTo.toLocaleString()} of {data.total.toLocaleString()}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => goToPage(Math.max(1, data.page - 1))}
                  disabled={loading || data.page <= 1}
                >
                  Previous
                </Button>
                <span className="text-xs">
                  Page {data.page} of {Math.max(1, data.totalPages)}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => goToPage(data.page + 1)}
                  disabled={loading || !data.hasMore}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>

      <OrderDetailDrawer
        orderId={selectedId}
        onClose={closeDrawer}
        onUpdated={onOrderUpdated}
      />
    </Card>
  );
}

/**
 * Pull the filename out of a `Content-Disposition: attachment;
 * filename="orders-...csv"` header. Tolerates RFC 5987-style
 * `filename*=UTF-8''…` parameters too. Returns null when no filename
 * could be extracted.
 */
function parseFilename(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*=([^']+)''([^;]+)/i.exec(header);
  if (star && star[2]) {
    try {
      return decodeURIComponent(star[2].trim().replace(/^"|"$/g, ""));
    } catch {
      // fall through
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  if (plain && plain[1]) return plain[1].trim();
  return null;
}
