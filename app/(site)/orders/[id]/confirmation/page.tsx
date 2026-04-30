import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowRight,
  Banknote,
  CheckCircle2,
  MapPin,
  Package,
  Receipt,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatPrice } from "@/lib/client/format";
import { getCurrentUser } from "@/lib/server/auth";
import { getOrderForUser } from "@/lib/server/orders";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Order confirmed",
  description: "Thanks for your order — here's what happens next.",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface OrderConfirmationPageProps {
  params: Promise<{ id: string }>;
}

/**
 * /orders/{id}/confirmation
 *
 * Thank-you screen the shopper lands on after `POST /api/orders` succeeds.
 * The page is auth-gated (redirects anonymous visitors to /login) and
 * SSR-loads the order through `getOrderForUser` — the helper enforces
 * ownership at the SQL `WHERE` clause, so an attacker guessing another
 * user's UUID still gets a 404.
 *
 * The view summarises:
 *
 *   - the order number (short id) and status badge,
 *   - every line item that was committed (with the snapshotted price /
 *     quantity, never re-derived from the live `products` table),
 *   - subtotal / discount / shipping / total to pay on delivery,
 *   - the shipping address the courier will deliver to, and
 *   - the Cash on Delivery payment notice — including the amount the
 *     driver will collect at the door.
 *
 * Two CTAs sit at the bottom: a primary link to the full order detail
 * view (under /account/orders) and a secondary link to /products to
 * keep shopping.
 */
export default async function OrderConfirmationPage({
  params,
}: OrderConfirmationPageProps) {
  const { id } = await params;
  // Treat malformed ids as 404 to avoid leaking the "valid uuid but
  // somebody else's order" vs "garbage uuid" distinction.
  if (!id || !UUID_RE.test(id)) notFound();

  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?next=/orders/${id}/confirmation`);
  }

  const order = await getOrderForUser(user.id, id);
  if (!order) notFound();

  const address = order.shippingAddress;
  const cityLine = [address.city, address.state, address.postalCode]
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join(", ");
  const addressLines = [
    address.recipient,
    address.line1,
    address.line2,
    cityLine,
    address.country,
  ].filter((line): line is string => Boolean(line && line.length > 0));

  const shippingFree = order.shippingCents <= 0 && order.itemCount > 0;
  const placedAt = new Date(order.createdAt);
  const placedAtLabel = Number.isNaN(placedAt.getTime())
    ? null
    : placedAt.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });

  // The "order number" surfaced to the shopper is the first 8 chars of
  // the UUID. It's stable, copy-pastable, and unique enough for support
  // lookups (the full id is in the URL for any deeper query).
  const orderNumber = order.id.slice(0, 8).toUpperCase();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <header className="mb-6 flex flex-col items-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
          <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">
            Thanks for your order!
          </h1>
          <p className="text-sm text-muted-foreground">
            We&apos;ve sent a confirmation email to{" "}
            <span className="font-medium text-foreground">{user.email}</span>.
          </p>
        </div>
        <div
          className="flex flex-wrap items-center justify-center gap-2 text-xs"
          data-testid="order-confirmation-meta"
        >
          <Badge
            variant="outline"
            className="font-mono uppercase"
            data-testid="order-confirmation-number"
          >
            #{orderNumber}
          </Badge>
          <Badge variant="success" className="capitalize">
            {order.status}
          </Badge>
          {placedAtLabel && (
            <span className="text-muted-foreground">
              Placed {placedAtLabel}
            </span>
          )}
        </div>
      </header>

      <div className="space-y-6">
        {/* ─── Cash on Delivery callout ──────────────────────────── */}
        <Card data-testid="order-confirmation-payment">
          <CardContent className="flex items-start gap-3 p-5">
            <Banknote
              className="mt-0.5 h-5 w-5 text-emerald-600 dark:text-emerald-400"
              aria-hidden="true"
            />
            <div className="flex-1 space-y-1">
              <p className="text-sm font-semibold">Cash on Delivery</p>
              <p className="text-sm text-muted-foreground">
                Please have{" "}
                <span
                  className="font-semibold text-foreground"
                  data-testid="order-confirmation-cod-amount"
                >
                  {formatPrice(order.totalCents, order.currency)}
                </span>{" "}
                ready when the courier arrives. They&apos;ll collect payment
                at the door — no card needed.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* ─── Order line items ─────────────────────────────────── */}
        <Card data-testid="order-confirmation-items">
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center gap-2">
              <Package
                className="h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
              <h2 className="text-base font-semibold">
                {order.items.length === 1
                  ? "1 item"
                  : `${order.items.length.toLocaleString()} items`}
              </h2>
              <span className="text-xs text-muted-foreground">
                · {order.itemCount.toLocaleString()} unit
                {order.itemCount === 1 ? "" : "s"}
              </span>
            </div>

            <ul className="space-y-3">
              {order.items.map((item) => {
                const lineTotal = formatPrice(
                  item.lineTotalCents,
                  item.currency,
                );
                const unit = formatPrice(
                  item.unitPriceCents,
                  item.currency,
                );
                const variantBits = [item.size, item.material, item.color]
                  .filter(
                    (bit): bit is string => Boolean(bit && bit.length > 0),
                  )
                  .join(" · ");
                return (
                  <li
                    key={item.id}
                    className="flex items-start gap-3"
                    data-testid={`order-confirmation-line-${item.id}`}
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
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {item.name}
                      </p>
                      {variantBits && (
                        <p className="truncate text-xs text-muted-foreground">
                          {variantBits}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {item.quantity} × {unit}
                      </p>
                    </div>
                    <div className="text-right text-sm font-semibold">
                      {lineTotal}
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        {/* ─── Shipping + totals ────────────────────────────────── */}
        <div className="grid gap-6 md:grid-cols-2">
          <Card data-testid="order-confirmation-shipping">
            <CardContent className="space-y-2 p-5">
              <div className="flex items-center gap-2">
                <MapPin
                  className="h-4 w-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <h2 className="text-base font-semibold">Shipping to</h2>
              </div>
              <address className="space-y-0.5 text-sm not-italic text-muted-foreground">
                {addressLines.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
                {address.phone && (
                  <div className="pt-0.5">{address.phone}</div>
                )}
              </address>
            </CardContent>
          </Card>

          <Card data-testid="order-confirmation-totals">
            <CardContent className="space-y-2 p-5">
              <div className="flex items-center gap-2">
                <Receipt
                  className="h-4 w-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <h2 className="text-base font-semibold">Total to pay</h2>
              </div>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd
                    className="font-medium"
                    data-testid="order-confirmation-subtotal"
                  >
                    {formatPrice(order.subtotalCents, order.currency)}
                  </dd>
                </div>
                {order.discountCents > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">
                      Discount
                      {order.discountCode && (
                        <span className="ml-1 text-xs uppercase tracking-wide">
                          ({order.discountCode})
                        </span>
                      )}
                    </dt>
                    <dd
                      className="font-medium text-emerald-600 dark:text-emerald-400"
                      data-testid="order-confirmation-discount"
                    >
                      −{formatPrice(order.discountCents, order.currency)}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Shipping</dt>
                  <dd
                    className="font-medium"
                    data-testid="order-confirmation-shipping-total"
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
                    <dt className="text-base font-semibold">
                      Pay on delivery
                    </dt>
                    <dd
                      className="text-base font-semibold"
                      data-testid="order-confirmation-total"
                    >
                      {formatPrice(order.totalCents, order.currency)}
                    </dd>
                  </div>
                </div>
              </dl>
            </CardContent>
          </Card>
        </div>

        {/* ─── Next-step CTAs ───────────────────────────────────── */}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            asChild
            variant="outline"
            data-testid="order-confirmation-continue-shopping"
          >
            <Link href="/products">Continue shopping</Link>
          </Button>
          <Button
            asChild
            data-testid="order-confirmation-view-details"
          >
            <Link href={`/account/orders/${order.id}`}>
              View order details
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
