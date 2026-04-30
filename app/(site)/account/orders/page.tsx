import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Package } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { OrderStatusBadge } from "@/components/account/order-status-badge";
import { formatPrice } from "@/lib/client/format";
import { requireUser } from "@/lib/server/auth";
import {
  ORDERS_DEFAULT_PAGE_SIZE,
  listOrdersForUser,
  parseOrderStatusFilter,
  type OrderListStatusFilter,
  type PublicOrderListEntry,
} from "@/lib/server/orders";

export const metadata: Metadata = {
  title: "Order history",
  description: "Review your past orders.",
};

export const dynamic = "force-dynamic";

interface AccountOrdersPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Status filter chips rendered above the table. */
const STATUS_FILTERS: ReadonlyArray<{
  value: OrderListStatusFilter;
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "processing", label: "Processing" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

function pickString(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const raw = params[key];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function parsePage(raw: string | undefined): number {
  if (!raw) return 1;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

function buildHref(params: {
  status: OrderListStatusFilter;
  page: number;
}): string {
  const search = new URLSearchParams();
  if (params.status !== "all") search.set("status", params.status);
  if (params.page > 1) search.set("page", String(params.page));
  const qs = search.toString();
  return qs ? `/account/orders?${qs}` : "/account/orders";
}

/**
 * Localised human-friendly date for the "Placed" column.
 *
 * `toLocaleString` honours the user's locale, but we render this on the
 * server during SSR so the date format the user first sees comes from
 * the server's locale. The values are stable enough across locales to
 * make this fine for an order history view (no time zones beyond the
 * implicit UTC stored in `created_at`).
 */
function formatDate(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Render a single order row in the history table. Pulled out of the
 * page body so the empty/loading branches stay readable.
 */
function OrderRow({ order }: { order: PublicOrderListEntry }) {
  const orderNumber = order.id.slice(0, 8).toUpperCase();
  const itemNoun = order.itemCount === 1 ? "item" : "items";
  const previewNames = order.previewItems
    .slice(0, 3)
    .map((p) => p.name)
    .join(", ");

  return (
    <li
      className="rounded-lg border bg-card p-4 transition-colors hover:bg-muted/40"
      data-testid={`order-row-${order.id}`}
    >
      <Link
        href={`/account/orders/${order.id}`}
        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        aria-label={`View order ${orderNumber}`}
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="font-mono text-sm font-semibold uppercase"
              data-testid="order-row-number"
            >
              #{orderNumber}
            </span>
            <OrderStatusBadge status={order.status} />
            {order.discountCode && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200">
                {order.discountCode}
              </span>
            )}
          </div>
          <div
            className="text-sm text-muted-foreground"
            data-testid="order-row-date"
          >
            Placed {formatDate(order.createdAt)}
          </div>
          {previewNames && (
            <p
              className="line-clamp-1 text-sm text-foreground/80"
              data-testid="order-row-preview"
            >
              {previewNames}
              {order.itemCount > order.previewItems.length && (
                <span className="ml-1 text-muted-foreground">…</span>
              )}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {order.itemCount.toLocaleString()} {itemNoun}
          </p>
        </div>
        <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end sm:gap-1 sm:text-right">
          <div
            className="text-base font-semibold"
            data-testid="order-row-total"
          >
            {formatPrice(order.totalCents, order.currency)}
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
            View details
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </div>
      </Link>
    </li>
  );
}

/**
 * `/account/orders`
 *
 * Server-rendered order history view. Pulls the authenticated user's
 * orders newest-first via `listOrdersForUser` (the same helper backing
 * `GET /api/orders`); ownership is enforced inside the helper at the
 * SQL `WHERE user_id = $userId` clause, so this surface cannot leak
 * another user's history even with a tampered URL.
 *
 * The page supports two query knobs:
 *
 *   - `status`  filter to a single order status (or `all`, the default).
 *   - `page`    1-indexed pagination cursor; clamped to the valid range.
 *
 * Status filter chips (Pending, Processing, Shipped, Delivered,
 * Cancelled) re-render the page with the appropriate `?status=` filter
 * applied. Pagination preserves the active filter.
 */
export default async function AccountOrdersPage({
  searchParams,
}: AccountOrdersPageProps) {
  // Auth is enforced by the layout, but we re-resolve here to read
  // `user.id` without an extra request.
  const user = await requireUser();

  const resolved = await searchParams;
  const rawStatus = pickString(resolved, "status") ?? "all";
  const parsedStatus = parseOrderStatusFilter(rawStatus);
  // `parseOrderStatusFilter` returns null on garbage. Treat unknown
  // values as "all" rather than 4xx-ing the page — query-string filters
  // should fail open for SSR.
  const status: OrderListStatusFilter = parsedStatus ?? "all";
  const page = parsePage(pickString(resolved, "page"));

  const result = await listOrdersForUser({
    userId: user.id,
    page,
    pageSize: ORDERS_DEFAULT_PAGE_SIZE,
    status,
    previewItemLimit: 3,
  });

  // If the requested page overshoots the data set (deep-link from a
  // bookmark after orders were cancelled, etc.), fall back to page 1.
  const effectivePage = result.total === 0 ? 1 : Math.min(page, result.totalPages || 1);
  const showingFrom =
    result.total === 0 ? 0 : (effectivePage - 1) * result.pageSize + 1;
  const showingTo = Math.min(effectivePage * result.pageSize, result.total);

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="space-y-1">
          <CardTitle className="text-xl">Order history</CardTitle>
          <CardDescription>
            A record of every order you&apos;ve placed, most recent first.
          </CardDescription>
        </div>
        <nav
          aria-label="Filter orders by status"
          className="flex flex-wrap gap-2"
          data-testid="order-status-filters"
        >
          {STATUS_FILTERS.map((filter) => {
            const active = status === filter.value;
            return (
              <Link
                key={filter.value}
                href={buildHref({ status: filter.value, page: 1 })}
                aria-current={active ? "page" : undefined}
                data-active={active ? "true" : undefined}
                className={
                  active
                    ? "inline-flex items-center rounded-full border border-primary bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground"
                    : "inline-flex items-center rounded-full border border-input bg-background px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }
              >
                {filter.label}
              </Link>
            );
          })}
        </nav>
      </CardHeader>
      <CardContent className="space-y-4">
        {result.items.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-muted/20 p-8 text-center"
            data-testid="order-empty-state"
          >
            <Package
              className="h-8 w-8 text-muted-foreground"
              aria-hidden="true"
            />
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {status === "all"
                  ? "No orders yet"
                  : `No ${status} orders`}
              </p>
              <p className="text-sm text-muted-foreground">
                {status === "all"
                  ? "When you place an order, it'll show up here."
                  : "Try a different status filter, or browse our catalogue."}
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/products">Continue browsing</Link>
            </Button>
          </div>
        ) : (
          <>
            <ul
              className="space-y-3"
              data-testid="order-history-list"
            >
              {result.items.map((order) => (
                <OrderRow key={order.id} order={order} />
              ))}
            </ul>

            {/* Pagination controls — only render when there's more than
                one page so the empty/short-list views stay clean. */}
            {result.totalPages > 1 && (
              <nav
                aria-label="Pagination"
                className="flex flex-col items-center justify-between gap-3 border-t pt-4 sm:flex-row"
              >
                <p className="text-xs text-muted-foreground">
                  Showing {showingFrom.toLocaleString()}–
                  {showingTo.toLocaleString()} of{" "}
                  {result.total.toLocaleString()}
                </p>
                <div className="flex items-center gap-2">
                  {effectivePage > 1 ? (
                    <Button asChild variant="outline" size="sm">
                      <Link
                        href={buildHref({ status, page: effectivePage - 1 })}
                        rel="prev"
                      >
                        Previous
                      </Link>
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" disabled>
                      Previous
                    </Button>
                  )}
                  <span className="text-xs text-muted-foreground">
                    Page {effectivePage} of {result.totalPages}
                  </span>
                  {result.hasMore ? (
                    <Button asChild variant="outline" size="sm">
                      <Link
                        href={buildHref({ status, page: effectivePage + 1 })}
                        rel="next"
                      >
                        Next
                      </Link>
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" disabled>
                      Next
                    </Button>
                  )}
                </div>
              </nav>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
