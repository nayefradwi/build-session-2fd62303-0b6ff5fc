"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Loader2,
  Lock,
  Minus,
  Plus,
  ShoppingBag,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCart } from "@/lib/client/cart-store";
import type {
  CartLineView,
  CartSummaryView,
  NormalizedDiscountView,
} from "@/lib/client/cart-types";
import { formatPrice } from "@/lib/client/format";
import { cn } from "@/lib/client/utils";

/**
 * Per-line cart cap mirrored from `lib/server/cart`. Kept inline so this
 * client component does not pull a server-only module.
 */
const MAX_QUANTITY_PER_LINE = 99;

/**
 * Flat-rate shipping fee (cents). Mirrored from `lib/server/orders`'s
 * `FLAT_SHIPPING_CENTS`. The cart's `summary.shippingCents` is a
 * placeholder (always 0) until checkout commits — we surface the
 * estimated fee here so shoppers can see the running total before they
 * proceed. The server is authoritative on the final number at order
 * commit time.
 */
const FLAT_SHIPPING_CENTS = 599;

/**
 * Free-shipping threshold (subtotal AFTER discount, in cents). Mirrors
 * `FREE_SHIPPING_THRESHOLD_CENTS` in `lib/server/orders` so the running
 * total the shopper sees here matches what the order-commit step will
 * charge.
 */
const FREE_SHIPPING_THRESHOLD_CENTS = 10_000;

interface CartErrorBody {
  error?: string;
  code?: string;
  details?: { available?: number; requested?: number; max?: number };
}

interface CartMutationBody {
  item?: CartLineView | null;
  summary?: CartSummaryView;
}

interface DiscountErrorBody {
  error?: string;
  code?: string;
  details?: { minOrderValue?: number; subtotalCents?: number };
}

interface DiscountSuccessBody {
  discount: NormalizedDiscountView;
}

interface CartListProps {
  initialItems: ReadonlyArray<CartLineView>;
  initialSummary: CartSummaryView;
}

/**
 * Compute the running totals shown on the cart page.
 *
 *  - subtotalCents:          sum of line totals (server-authoritative).
 *  - discountCents:          0 unless the shopper has applied a promo.
 *  - shippingCents:          flat rate, waived once the discounted
 *                            subtotal crosses the free-shipping threshold,
 *                            and waived for an empty cart.
 *  - totalCents:             subtotal - discount + shipping (clamped >= 0).
 *
 * The server will recompute these at checkout commit; this is just a
 * faithful preview of what that recomputation will produce given the
 * current cart + applied discount.
 */
function computeTotals(
  summary: CartSummaryView,
  discount: NormalizedDiscountView | null,
): {
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
  shippingFree: boolean;
  currency: string;
} {
  const subtotalCents = Math.max(0, summary.subtotalCents);
  const discountCents = discount
    ? Math.min(discount.amountCents, subtotalCents)
    : 0;
  const subtotalAfterDiscount = Math.max(0, subtotalCents - discountCents);
  const shippingFree =
    subtotalCents === 0 || subtotalAfterDiscount >= FREE_SHIPPING_THRESHOLD_CENTS;
  const shippingCents =
    subtotalCents === 0 ? 0 : shippingFree ? 0 : FLAT_SHIPPING_CENTS;
  const totalCents = Math.max(0, subtotalAfterDiscount + shippingCents);
  return {
    subtotalCents,
    discountCents,
    shippingCents,
    totalCents,
    shippingFree,
    currency: summary.currency,
  };
}

/**
 * Client renderer for /cart.
 *
 * Mounts with the SSR-loaded items + summary, then layers interactive
 * mutations on top:
 *
 *   1. Quantity steppers — PUT /api/cart/{itemId} with the absolute
 *      quantity. We optimistically update the line and the header badge,
 *      then reconcile against the server's response (which is the
 *      authoritative source for stock-clamped values).
 *
 *   2. Remove — DELETE /api/cart/{itemId}. Optimistically hides the row
 *      and decrements the badge by the removed quantity; rolls back on
 *      failure.
 *
 *   3. Promo code — POST /api/discount-codes/validate. The discount is
 *      held in client state only (the API is stateless by design); the
 *      cart summary, header badge, and totals all stay in sync.
 *
 * After every successful mutation we call `router.refresh()` so the
 * server-rendered snapshot catches up — that keeps the cart consistent
 * if the shopper navigates away and back.
 */
export function CartList({ initialItems, initialSummary }: CartListProps) {
  const router = useRouter();
  const cart = useCart();

  const [items, setItems] = React.useState<CartLineView[]>(() => [
    ...initialItems,
  ]);
  const [summary, setSummary] =
    React.useState<CartSummaryView>(initialSummary);

  // Re-seed local state when the SSR snapshot changes (e.g. after a
  // `router.refresh()` triggered by a successful mutation).
  React.useEffect(() => {
    setItems([...initialItems]);
  }, [initialItems]);
  React.useEffect(() => {
    setSummary(initialSummary);
  }, [initialSummary]);

  const [busyItemId, setBusyItemId] = React.useState<string | null>(null);
  const [busyAction, setBusyAction] = React.useState<
    "quantity" | "remove" | null
  >(null);

  // Promo code state. The validation API is stateless — we hold the
  // applied discount entirely on the client and re-validate every time
  // the subtotal changes.
  const [promoInput, setPromoInput] = React.useState("");
  const [promoError, setPromoError] = React.useState<string | null>(null);
  const [promoPending, setPromoPending] = React.useState(false);
  const [appliedDiscount, setAppliedDiscount] =
    React.useState<NormalizedDiscountView | null>(null);

  /**
   * Re-validate the applied promo whenever the subtotal moves so the
   * displayed amount stays in sync with the cart. If the recomputed
   * amount is the same (within rounding) we leave it alone; if the code
   * has since become invalid (min-order shrank past, expired, etc.) we
   * drop it with an explanatory toast.
   */
  React.useEffect(() => {
    if (!appliedDiscount) return;
    if (appliedDiscount.subtotalCents === summary.subtotalCents) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/discount-codes/validate", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: appliedDiscount.code,
            subtotalCents: summary.subtotalCents,
          }),
        });
        if (cancelled) return;
        if (!res.ok) {
          // Drop the now-invalid code silently rather than yelling at
          // the user — they'll see the line disappear from the totals.
          setAppliedDiscount(null);
          return;
        }
        const body = (await res.json()) as DiscountSuccessBody;
        if (!cancelled) setAppliedDiscount(body.discount);
      } catch {
        if (!cancelled) setAppliedDiscount(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appliedDiscount, summary.subtotalCents]);

  // Drop the applied discount if the cart becomes empty.
  React.useEffect(() => {
    if (items.length === 0 && appliedDiscount) {
      setAppliedDiscount(null);
    }
  }, [items.length, appliedDiscount]);

  const totals = React.useMemo(
    () => computeTotals(summary, appliedDiscount),
    [summary, appliedDiscount],
  );

  const applyMutationResponse = React.useCallback(
    (
      itemId: string,
      body: CartMutationBody,
      removed: boolean,
    ) => {
      setSummary((prev) => body.summary ?? prev);
      setItems((prev) => {
        if (removed) return prev.filter((line) => line.id !== itemId);
        if (!body.item) return prev;
        const next = body.item;
        const exists = prev.some((line) => line.id === itemId);
        return exists
          ? prev.map((line) => (line.id === itemId ? next : line))
          : [next, ...prev];
      });
      if (body.summary) cart.setCount(body.summary.itemCount);
    },
    [cart],
  );

  const explainQuantityError = React.useCallback(
    (status: number, body: CartErrorBody, fallbackName: string) => {
      if (status === 401) {
        toast.error("Sign in to update your cart", {
          description:
            "Your session has expired. Sign in again to keep shopping.",
        });
        return;
      }
      if (status === 404) {
        toast.error("Item not found", {
          description: `${fallbackName} is no longer in your cart.`,
        });
        return;
      }
      if (status === 409 && body.code === "out_of_stock") {
        toast.error("Out of stock", {
          description: `${fallbackName} is currently unavailable.`,
        });
        return;
      }
      if (status === 409 && body.code === "exceeds_stock") {
        const available = body.details?.available;
        toast.error("Not enough stock", {
          description:
            typeof available === "number"
              ? `Only ${available} left in stock for ${fallbackName}.`
              : `We don't have that many of ${fallbackName} in stock.`,
        });
        return;
      }
      if (status === 400 && body.code === "exceeds_max_quantity") {
        const max = body.details?.max ?? MAX_QUANTITY_PER_LINE;
        toast.error("Quantity too high", {
          description: `Maximum is ${max} per item.`,
        });
        return;
      }
      toast.error("Couldn't update cart", {
        description: body.error ?? "Please try again in a moment.",
      });
    },
    [],
  );

  const updateQuantity = React.useCallback(
    async (line: CartLineView, nextQuantity: number) => {
      if (busyItemId) return;
      const productName = line.product?.name ?? "Item";
      if (
        !Number.isFinite(nextQuantity) ||
        !Number.isInteger(nextQuantity) ||
        nextQuantity < 1
      ) {
        return;
      }
      const cap = Math.min(
        MAX_QUANTITY_PER_LINE,
        Math.max(1, line.product?.stock ?? MAX_QUANTITY_PER_LINE),
      );
      const clamped = Math.min(cap, nextQuantity);
      if (clamped === line.quantity) return;

      setBusyItemId(line.id);
      setBusyAction("quantity");

      // Optimistic patch — bump the badge in the right direction so the
      // header reflects the change immediately.
      const delta = clamped - line.quantity;
      cart.incrementCount(delta);
      setItems((prev) =>
        prev.map((row) =>
          row.id === line.id
            ? {
                ...row,
                quantity: clamped,
                lineTotalCents: row.unitPriceCents * clamped,
              }
            : row,
        ),
      );

      try {
        const res = await fetch(`/api/cart/${line.id}`, {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quantity: clamped }),
        });
        if (!res.ok) {
          let body: CartErrorBody = {};
          try {
            body = (await res.json()) as CartErrorBody;
          } catch {
            // ignore parse errors
          }
          explainQuantityError(res.status, body, productName);
          // Reconcile with the server in case our optimistic state has
          // drifted.
          void cart.refresh();
          router.refresh();
          return;
        }
        const body = (await res.json()) as CartMutationBody;
        applyMutationResponse(line.id, body, false);
        router.refresh();
      } catch (err) {
        toast.error("Network error", {
          description:
            err instanceof Error
              ? err.message
              : "Could not reach the server. Please try again.",
        });
        // Roll back the optimistic badge bump and re-fetch the truth.
        cart.incrementCount(-delta);
        void cart.refresh();
        router.refresh();
      } finally {
        setBusyItemId(null);
        setBusyAction(null);
      }
    },
    [busyItemId, cart, applyMutationResponse, explainQuantityError, router],
  );

  const removeLine = React.useCallback(
    async (line: CartLineView) => {
      if (busyItemId) return;
      const productName = line.product?.name ?? "Item";

      setBusyItemId(line.id);
      setBusyAction("remove");

      // Optimistic hide. We hold a snapshot so we can roll back on
      // failure.
      const removedQuantity = line.quantity;
      cart.incrementCount(-removedQuantity);
      setItems((prev) => prev.filter((row) => row.id !== line.id));

      try {
        const res = await fetch(`/api/cart/${line.id}`, {
          method: "DELETE",
          credentials: "same-origin",
        });
        if (!res.ok) {
          let body: CartErrorBody = {};
          try {
            body = (await res.json()) as CartErrorBody;
          } catch {
            // ignore parse errors
          }
          if (res.status === 401) {
            toast.error("Sign in to update your cart", {
              description:
                "Your session has expired. Sign in again to keep shopping.",
            });
          } else if (res.status === 404) {
            // The row was already gone — accept the optimistic hide and
            // sync the badge against the server's view.
            void cart.refresh();
            router.refresh();
            return;
          } else {
            toast.error("Couldn't remove item", {
              description: body.error ?? "Please try again in a moment.",
            });
          }
          // Roll the optimistic state back.
          setItems((prev) =>
            prev.some((row) => row.id === line.id) ? prev : [line, ...prev],
          );
          cart.incrementCount(removedQuantity);
          void cart.refresh();
          router.refresh();
          return;
        }
        // Success — surface a toast that lets the user know what just
        // happened, then sync against the server's authoritative summary.
        let body: { summary?: CartSummaryView } = {};
        try {
          body = (await res.json()) as { summary?: CartSummaryView };
        } catch {
          // The route should always return JSON; ignore parse errors.
        }
        if (body.summary) {
          setSummary(body.summary);
          cart.setCount(body.summary.itemCount);
        }
        toast.success("Removed from cart", {
          description: `${productName} is no longer in your cart.`,
        });
        router.refresh();
      } catch (err) {
        toast.error("Network error", {
          description:
            err instanceof Error
              ? err.message
              : "Could not reach the server. Please try again.",
        });
        setItems((prev) =>
          prev.some((row) => row.id === line.id) ? prev : [line, ...prev],
        );
        cart.incrementCount(removedQuantity);
        void cart.refresh();
        router.refresh();
      } finally {
        setBusyItemId(null);
        setBusyAction(null);
      }
    },
    [busyItemId, cart, router],
  );

  const handlePromoSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const code = promoInput.trim();
      if (!code || promoPending) return;
      setPromoPending(true);
      setPromoError(null);
      try {
        const res = await fetch("/api/discount-codes/validate", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            subtotalCents: summary.subtotalCents,
          }),
        });
        if (!res.ok) {
          let body: DiscountErrorBody = {};
          try {
            body = (await res.json()) as DiscountErrorBody;
          } catch {
            // ignore
          }
          if (res.status === 404) {
            setPromoError("That promo code isn't valid.");
          } else if (res.status === 409 && body.code === "expired") {
            setPromoError("This promo code has expired.");
          } else if (res.status === 409 && body.code === "inactive") {
            setPromoError("This promo code is no longer active.");
          } else if (res.status === 409 && body.code === "exhausted") {
            setPromoError("This promo code has been fully redeemed.");
          } else if (res.status === 409 && body.code === "min_order_not_met") {
            const min = body.details?.minOrderValue;
            setPromoError(
              typeof min === "number"
                ? `Spend at least ${formatPrice(min, summary.currency)} to use this code.`
                : "Your cart doesn't meet the minimum for this code.",
            );
          } else if (res.status === 401) {
            setPromoError("Sign in to apply a promo code.");
          } else {
            setPromoError(
              body.error ?? "Couldn't apply that promo. Please try again.",
            );
          }
          return;
        }
        const body = (await res.json()) as DiscountSuccessBody;
        setAppliedDiscount(body.discount);
        setPromoInput("");
        toast.success("Promo applied", {
          description: `${body.discount.code} saved you ${formatPrice(
            body.discount.amountCents,
            body.discount.currency,
          )}.`,
        });
      } catch (err) {
        setPromoError(
          err instanceof Error
            ? err.message
            : "Couldn't reach the server. Please try again.",
        );
      } finally {
        setPromoPending(false);
      }
    },
    [promoInput, promoPending, summary.subtotalCents, summary.currency],
  );

  const removeDiscount = React.useCallback(() => {
    setAppliedDiscount(null);
    setPromoError(null);
  }, []);

  // ─── Empty state ────────────────────────────────────────────────────
  if (items.length === 0) {
    return (
      <div
        data-testid="cart-empty"
        className="rounded-lg border border-dashed p-10 text-center"
      >
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <ShoppingBag
            className="h-6 w-6 text-muted-foreground"
            aria-hidden="true"
          />
        </div>
        <h2 className="text-lg font-semibold">Your cart is empty</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Looks like you haven&apos;t added anything yet. Find something you
          love and it&apos;ll show up here.
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button asChild>
            <Link href="/products" data-testid="cart-empty-continue">
              Continue shopping
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  // ─── Populated cart ────────────────────────────────────────────────
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <ul className="space-y-3" data-testid="cart-items">
        {items.map((line) => {
          const product = line.product;
          const isBusy = busyItemId === line.id;
          const updating = isBusy && busyAction === "quantity";
          const removing = isBusy && busyAction === "remove";

          // Defensive fallback: the server filters orphan rows but if a
          // product was deleted between read and render we still want a
          // useful row.
          if (!product) {
            return (
              <li key={line.id}>
                <Card>
                  <CardContent className="flex items-center justify-between gap-4 p-4">
                    <div className="text-sm text-muted-foreground">
                      This product is no longer available.
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeLine(line)}
                      disabled={isBusy}
                    >
                      {removing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      Remove
                    </Button>
                  </CardContent>
                </Card>
              </li>
            );
          }

          const cap = Math.min(
            MAX_QUANTITY_PER_LINE,
            Math.max(1, product.stock || MAX_QUANTITY_PER_LINE),
          );
          const outOfStock =
            product.stockStatus === "out_of_stock" || product.stock <= 0;
          const overStock = !outOfStock && line.quantity > product.stock;
          const lowStock =
            !outOfStock && !overStock && product.stockStatus === "low_stock";

          const price = formatPrice(product.priceCents, product.currency);
          const lineTotal = formatPrice(line.lineTotalCents, line.currency);
          const compareAt =
            product.compareAtPriceCents != null &&
            product.compareAtPriceCents > product.priceCents
              ? formatPrice(product.compareAtPriceCents, product.currency)
              : null;

          const pdpHref = `/products/${product.slug}`;

          return (
            <li key={line.id}>
              <Card
                className={cn(
                  "transition-opacity",
                  isBusy && "opacity-60",
                )}
                data-testid={`cart-line-${line.id}`}
              >
                <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-stretch">
                  <Link
                    href={pdpHref}
                    aria-label={product.name}
                    className="block w-full shrink-0 overflow-hidden rounded-md bg-muted sm:h-32 sm:w-32"
                  >
                    <div className="aspect-[4/5] sm:h-full sm:w-full">
                      {product.primaryImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={product.primaryImageUrl}
                          alt={product.name}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                          No image
                        </div>
                      )}
                    </div>
                  </Link>

                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    {product.category && (
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        {product.category.name}
                      </p>
                    )}
                    <h3 className="text-base font-semibold leading-tight">
                      <Link
                        href={pdpHref}
                        className="hover:underline focus-visible:underline focus-visible:outline-none"
                      >
                        {product.name}
                      </Link>
                    </h3>

                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-sm font-semibold">{price}</span>
                      {compareAt && (
                        <span className="text-xs text-muted-foreground line-through">
                          {compareAt}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {outOfStock ? (
                        <Badge variant="destructive">Out of stock</Badge>
                      ) : lowStock ? (
                        <Badge variant="warning">
                          Low stock
                          {product.stock > 0 ? ` · only ${product.stock} left` : ""}
                        </Badge>
                      ) : (
                        <Badge variant="success">In stock</Badge>
                      )}
                      {(product.size || product.color || product.material) && (
                        <span className="text-xs text-muted-foreground">
                          {[product.size, product.color, product.material]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      )}
                    </div>

                    {overStock && (
                      <p
                        className="text-xs text-destructive"
                        data-testid={`cart-overstock-${line.id}`}
                      >
                        Only {product.stock} left — adjust the quantity below
                        to proceed to checkout.
                      </p>
                    )}

                    <div className="mt-1 flex flex-wrap items-center gap-3">
                      <div
                        className="inline-flex items-center rounded-md border bg-background"
                        aria-label={`Quantity for ${product.name}`}
                      >
                        <button
                          type="button"
                          aria-label={`Decrease quantity of ${product.name}`}
                          onClick={() =>
                            updateQuantity(line, line.quantity - 1)
                          }
                          disabled={
                            isBusy ||
                            outOfStock ||
                            line.quantity <= 1
                          }
                          className="flex h-9 w-9 items-center justify-center text-muted-foreground transition hover:text-foreground disabled:opacity-40"
                          data-testid={`cart-qty-decrease-${line.id}`}
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={cap}
                          value={line.quantity}
                          aria-label={`Quantity for ${product.name}`}
                          onChange={(event) => {
                            const raw = event.target.value.trim();
                            if (raw === "") return;
                            const parsed = Number.parseInt(raw, 10);
                            if (!Number.isFinite(parsed) || parsed <= 0) return;
                            const clamped = Math.min(cap, Math.max(1, parsed));
                            updateQuantity(line, clamped);
                          }}
                          disabled={isBusy || outOfStock}
                          className="h-9 w-14 border-0 px-0 text-center focus-visible:ring-0 focus-visible:ring-offset-0"
                          data-testid={`cart-qty-input-${line.id}`}
                        />
                        <button
                          type="button"
                          aria-label={`Increase quantity of ${product.name}`}
                          onClick={() =>
                            updateQuantity(line, line.quantity + 1)
                          }
                          disabled={
                            isBusy ||
                            outOfStock ||
                            line.quantity >= cap
                          }
                          className="flex h-9 w-9 items-center justify-center text-muted-foreground transition hover:text-foreground disabled:opacity-40"
                          data-testid={`cart-qty-increase-${line.id}`}
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                      {updating && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Updating…
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2 sm:items-end sm:justify-between">
                    <div className="text-right">
                      <div
                        className="text-base font-semibold"
                        data-testid={`cart-line-total-${line.id}`}
                      >
                        {lineTotal}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {line.quantity} × {price}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeLine(line)}
                      disabled={isBusy}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Remove ${product.name} from cart`}
                      data-testid={`cart-remove-${line.id}`}
                    >
                      {removing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      Remove
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>

      <aside
        aria-label="Order summary"
        className="lg:sticky lg:top-20 lg:self-start"
      >
        <Card>
          <CardContent className="space-y-4 p-5">
            <h2 className="text-base font-semibold">Order summary</h2>

            {/* Promo code */}
            <form
              className="space-y-1.5"
              onSubmit={handlePromoSubmit}
              data-testid="cart-promo-form"
            >
              <Label htmlFor="cart-promo" className="text-xs font-medium">
                Promo code
              </Label>
              <div className="flex gap-2">
                <Input
                  id="cart-promo"
                  name="code"
                  value={promoInput}
                  onChange={(event) => {
                    setPromoInput(event.target.value);
                    if (promoError) setPromoError(null);
                  }}
                  placeholder="Enter code"
                  autoComplete="off"
                  disabled={promoPending}
                  data-testid="cart-promo-input"
                />
                <Button
                  type="submit"
                  variant="outline"
                  disabled={promoPending || promoInput.trim().length === 0}
                  data-testid="cart-promo-apply"
                >
                  {promoPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Tag className="h-4 w-4" />
                  )}
                  Apply
                </Button>
              </div>
              {promoError && (
                <p
                  role="alert"
                  className="text-xs text-destructive"
                  data-testid="cart-promo-error"
                >
                  {promoError}
                </p>
              )}
              {appliedDiscount && (
                <div
                  className="mt-1 flex items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-200"
                  data-testid="cart-promo-applied"
                >
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {appliedDiscount.code} applied
                    </p>
                    {appliedDiscount.description && (
                      <p className="truncate text-emerald-800/80 dark:text-emerald-300/80">
                        {appliedDiscount.description}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={removeDiscount}
                    aria-label="Remove promo code"
                    className="rounded p-1 text-emerald-900 hover:bg-emerald-100 dark:text-emerald-200 dark:hover:bg-emerald-900/40"
                    data-testid="cart-promo-remove"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </form>

            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd
                  className="font-medium"
                  data-testid="cart-summary-subtotal"
                >
                  {formatPrice(totals.subtotalCents, totals.currency)}
                </dd>
              </div>
              {totals.discountCents > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">
                    Discount
                    {appliedDiscount && (
                      <span className="ml-1 text-xs uppercase tracking-wide">
                        ({appliedDiscount.code})
                      </span>
                    )}
                  </dt>
                  <dd
                    className="font-medium text-emerald-600 dark:text-emerald-400"
                    data-testid="cart-summary-discount"
                  >
                    −{formatPrice(totals.discountCents, totals.currency)}
                  </dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Shipping</dt>
                <dd
                  className="font-medium"
                  data-testid="cart-summary-shipping"
                >
                  {totals.shippingFree ? (
                    <span className="text-emerald-600 dark:text-emerald-400">
                      Free
                    </span>
                  ) : (
                    formatPrice(totals.shippingCents, totals.currency)
                  )}
                </dd>
              </div>
              {!totals.shippingFree && (
                <p className="text-xs text-muted-foreground">
                  Spend{" "}
                  {formatPrice(
                    Math.max(
                      0,
                      FREE_SHIPPING_THRESHOLD_CENTS -
                        Math.max(
                          0,
                          totals.subtotalCents - totals.discountCents,
                        ),
                    ),
                    totals.currency,
                  )}{" "}
                  more for free shipping.
                </p>
              )}
              <div className="border-t pt-2">
                <div className="flex items-baseline justify-between">
                  <dt className="text-base font-semibold">Total</dt>
                  <dd
                    className="text-base font-semibold"
                    data-testid="cart-summary-total"
                  >
                    {formatPrice(totals.totalCents, totals.currency)}
                  </dd>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Taxes calculated at checkout.
                </p>
              </div>
            </dl>

            <Button
              asChild
              className="w-full"
              size="lg"
              data-testid="cart-checkout"
            >
              <Link href="/checkout">
                <Lock className="h-4 w-4" aria-hidden="true" />
                Proceed to checkout
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>

            <Button
              asChild
              variant="ghost"
              size="sm"
              className="w-full"
              data-testid="cart-continue-shopping"
            >
              <Link href="/products">Continue shopping</Link>
            </Button>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
