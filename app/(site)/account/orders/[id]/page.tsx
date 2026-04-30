import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Banknote,
  CalendarDays,
  MapPin,
  Package,
  Receipt,
  Tag,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { OrderStatusBadge } from "@/components/account/order-status-badge";
import { PrintButton } from "@/components/account/print-button";
import { formatPrice } from "@/lib/client/format";
import { requireUser } from "@/lib/server/auth";
import { getOrderForUser, type PublicOrderSummary } from "@/lib/server/orders";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface OrderDetailPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Pull the per-order metadata title out of the server payload. We avoid
 * leaking sensitive fields into the title bar (no addresses, no totals);
 * the short order number is enough for tab-switching context.
 */
export async function generateMetadata({
  params,
}: OrderDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  if (!id || !UUID_RE.test(id)) {
    return { title: "Order not found" };
  }
  return {
    title: `Order #${id.slice(0, 8).toUpperCase()}`,
    description: "Order details and item lines.",
  };
}

function formatDate(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString(undefined, {
    dateStyle: "long",
    timeStyle: "short",
  });
}

/**
 * Compose the address into an array of human-friendly lines so we can
 * render them as a stacked block. Empty / nullish parts are dropped.
 */
function addressLines(address: PublicOrderSummary["shippingAddress"]) {
  const cityLine = [address.city, address.state, address.postalCode]
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join(", ");
  return [
    address.recipient,
    address.line1,
    address.line2,
    cityLine,
    address.country,
  ].filter((line): line is string => Boolean(line && line.length > 0));
}

/**
 * `/account/orders/{id}`
 *
 * Server-rendered detail view for a single order belonging to the
 * authenticated user. The lookup runs through `getOrderForUser`, which
 * enforces ownership at the SQL `WHERE` clause — an attacker who
 * guesses another user's UUID still gets a 404 here.
 *
 * Layout:
 *   - Header bar with the short order number, status badge, placed-at
 *     timestamp, plus "Back" and "Print" actions (the back link drops
 *     during print thanks to `data-no-print`).
 *   - The receipt body wrapped in `data-print-area="order-receipt"`,
 *     which the print stylesheet uses to hide every other piece of
 *     chrome on the page (site header, sidebar, action bar, etc.). The
 *     receipt itself stays — totals, items, snapshotted shipping
 *     address — so printing the page produces a clean, ink-friendly
 *     copy of the order.
 */
export default async function OrderDetailPage({
  params,
}: OrderDetailPageProps) {
  const { id } = await params;
  // Treat malformed ids the same as a miss so we never leak the
  // "valid uuid but not yours" vs "garbage uuid" distinction.
  if (!id || !UUID_RE.test(id)) notFound();

  const user = await requireUser();
  const order = await getOrderForUser(user.id, id);
  if (!order) notFound();

  const orderNumber = order.id.slice(0, 8).toUpperCase();
  const placedAt = formatDate(order.createdAt);
  const updatedAt =
    order.updatedAt !== order.createdAt ? formatDate(order.updatedAt) : null;
  const lines = addressLines(order.shippingAddress);
  const shippingFree = order.shippingCents <= 0 && order.itemCount > 0;
  const itemNoun = order.items.length === 1 ? "item" : "items";

  return (
    <div className="space-y-6">
      {/* ─── Action bar (hidden on print) ───────────────────────── */}
      <div
        className="flex flex-wrap items-center justify-between gap-3"
        data-no-print
      >
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link
            href="/account/orders"
            className="inline-flex items-center gap-1"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to orders
          </Link>
        </Button>
        <PrintButton />
      </div>

      {/* ─── Print area: the receipt itself ─────────────────────── */}
      <article
        data-print-area="order-receipt"
        data-testid="order-detail"
        className="space-y-6"
      >
        {/* Header */}
        <header className="space-y-3 rounded-lg border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Order
              </p>
              <h1
                className="font-mono text-2xl font-semibold uppercase"
                data-testid="order-detail-number"
              >
                #{orderNumber}
              </h1>
              <p className="text-xs text-muted-foreground">
                Full reference: {order.id}
              </p>
            </div>
            <OrderStatusBadge
              status={order.status}
              data-testid="order-detail-status"
            />
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="flex items-start gap-2">
              <CalendarDays
                className="mt-0.5 h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Placed
                </dt>
                <dd
                  className="font-medium"
                  data-testid="order-detail-placed-at"
                >
                  {placedAt}
                </dd>
                {updatedAt && (
                  <dd className="text-xs text-muted-foreground">
                    Last updated {updatedAt}
                  </dd>
                )}
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Package
                className="mt-0.5 h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Contents
                </dt>
                <dd
                  className="font-medium"
                  data-testid="order-detail-item-count"
                >
                  {order.items.length.toLocaleString()} {itemNoun} ·{" "}
                  {order.itemCount.toLocaleString()} unit
                  {order.itemCount === 1 ? "" : "s"}
                </dd>
              </div>
            </div>
          </dl>
        </header>

        {/* Items */}
        <Card data-testid="order-detail-items">
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center gap-2">
              <Package
                className="h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
              <h2 className="text-base font-semibold">Items</h2>
            </div>
            <ul
              className="divide-y"
              data-testid="order-detail-line-items"
            >
              {order.items.map((item) => {
                const lineTotal = formatPrice(
                  item.lineTotalCents,
                  item.currency,
                );
                const unit = formatPrice(item.unitPriceCents, item.currency);
                const variantBits = [item.size, item.material, item.color]
                  .filter(
                    (bit): bit is string => Boolean(bit && bit.length > 0),
                  )
                  .join(" · ");
                return (
                  <li
                    key={item.id}
                    className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
                    data-testid={`order-detail-line-${item.id}`}
                  >
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
                      {item.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.imageUrl}
                          alt={item.name}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
                          No image
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="truncate text-sm font-medium">
                        {item.name}
                      </p>
                      {variantBits && (
                        <p className="truncate text-xs text-muted-foreground">
                          {variantBits}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        SKU {item.sku}
                      </p>
                      <p
                        className="text-xs text-muted-foreground"
                        data-testid={`order-detail-line-${item.id}-qty`}
                      >
                        Quantity {item.quantity.toLocaleString()} × {unit}
                      </p>
                    </div>
                    <div
                      className="text-right text-sm font-semibold"
                      data-testid={`order-detail-line-${item.id}-total`}
                    >
                      {lineTotal}
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        {/* Shipping + totals */}
        <div className="grid gap-6 md:grid-cols-2">
          <Card data-testid="order-detail-shipping">
            <CardContent className="space-y-2 p-5">
              <div className="flex items-center gap-2">
                <MapPin
                  className="h-4 w-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <h2 className="text-base font-semibold">Shipping address</h2>
              </div>
              <address className="space-y-0.5 text-sm not-italic text-muted-foreground">
                {lines.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
                {order.shippingAddress.phone && (
                  <div className="pt-0.5">{order.shippingAddress.phone}</div>
                )}
              </address>
            </CardContent>
          </Card>

          <Card data-testid="order-detail-totals">
            <CardContent className="space-y-2 p-5">
              <div className="flex items-center gap-2">
                <Receipt
                  className="h-4 w-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <h2 className="text-base font-semibold">Totals</h2>
              </div>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd
                    className="font-medium"
                    data-testid="order-detail-subtotal"
                  >
                    {formatPrice(order.subtotalCents, order.currency)}
                  </dd>
                </div>
                {order.discountCents > 0 && (
                  <div className="flex justify-between">
                    <dt className="flex items-center gap-1.5 text-muted-foreground">
                      <Tag className="h-3.5 w-3.5" aria-hidden="true" />
                      Discount
                      {order.discountCode && (
                        <span className="ml-1 font-mono text-xs uppercase tracking-wide">
                          ({order.discountCode})
                        </span>
                      )}
                    </dt>
                    <dd
                      className="font-medium text-emerald-600 dark:text-emerald-400"
                      data-testid="order-detail-discount"
                    >
                      −{formatPrice(order.discountCents, order.currency)}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Shipping</dt>
                  <dd
                    className="font-medium"
                    data-testid="order-detail-shipping-total"
                  >
                    {shippingFree ? (
                      <span className="text-emerald-600 dark:text-emerald-400">
                        Free
                      </span>
                    ) : (
                      formatPrice(order.shippingCents, order.currency)
                    )}
                  </dd>
                </div>
                <div className="border-t pt-2">
                  <div className="flex items-baseline justify-between">
                    <dt className="text-base font-semibold">Total</dt>
                    <dd
                      className="text-base font-semibold"
                      data-testid="order-detail-total"
                    >
                      {formatPrice(order.totalCents, order.currency)}
                    </dd>
                  </div>
                  {order.status !== "cancelled" && (
                    <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Banknote
                        className="h-3.5 w-3.5"
                        aria-hidden="true"
                      />
                      Cash on Delivery
                    </p>
                  )}
                </div>
              </dl>
            </CardContent>
          </Card>
        </div>
      </article>
    </div>
  );
}
