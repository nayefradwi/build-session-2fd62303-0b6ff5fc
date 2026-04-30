"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Banknote,
  CheckCircle2,
  Loader2,
  Lock,
  MapPin,
  ShoppingBag,
  Tag,
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
import type { Address } from "@/components/account/types";
import {
  addressFormSchema,
  emptyAddressFormValues,
  toAddressApiPayload,
  type AddressFormValues,
} from "@/lib/client/address-schema";
import { formatPrice } from "@/lib/client/format";
import { cn } from "@/lib/client/utils";

/**
 * Sentinel value used in `selectedAddressId` to signal "the shopper is
 * filling in a brand-new address inline" rather than picking a saved
 * row. The `__` prefix guarantees no collision with a real UUID.
 */
const NEW_ADDRESS_SENTINEL = "__new__";

/**
 * Mirror of `FLAT_SHIPPING_CENTS` and `FREE_SHIPPING_THRESHOLD_CENTS`
 * from `lib/server/orders`. Duplicated here so this client component
 * doesn't pull a server-only module — the server still recomputes both
 * on commit and is the authoritative source.
 */
const FLAT_SHIPPING_CENTS = 599;
const FREE_SHIPPING_THRESHOLD_CENTS = 10_000;

interface DiscountErrorBody {
  error?: string;
  code?: string;
  details?: { minOrderValue?: number; subtotalCents?: number };
}

interface DiscountSuccessBody {
  discount: NormalizedDiscountView;
}

interface OrderErrorBody {
  error?: string;
  code?: string;
  fieldErrors?: Record<string, string[]>;
  details?: {
    productId?: string;
    sku?: string;
    requested?: number;
    available?: number;
    reason?: string;
  };
}

interface OrderSuccessBody {
  order: {
    id: string;
    status: string;
    totalCents: number;
    currency: string;
    discountCode: string | null;
  };
}

interface CheckoutFormProps {
  initialItems: ReadonlyArray<CartLineView>;
  initialSummary: CartSummaryView;
  initialAddresses: ReadonlyArray<Address>;
  userEmail: string;
}

interface ComputedTotals {
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
  shippingFree: boolean;
  currency: string;
}

/**
 * Mirror of the cart's totals math, kept in sync with `lib/server/orders`.
 * The displayed numbers must match what the server will charge when it
 * re-runs the same computation under transaction.
 */
function computeTotals(
  summary: CartSummaryView,
  discount: NormalizedDiscountView | null,
): ComputedTotals {
  const subtotalCents = Math.max(0, summary.subtotalCents);
  const discountCents = discount
    ? Math.min(discount.amountCents, subtotalCents)
    : 0;
  const subtotalAfterDiscount = Math.max(0, subtotalCents - discountCents);
  const shippingFree =
    subtotalCents === 0 ||
    subtotalAfterDiscount >= FREE_SHIPPING_THRESHOLD_CENTS;
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
 * Pick the address that should be selected on first paint. Defaults to
 * the user's `isDefault` address; falls back to the first row in the
 * list. Returns the `NEW_ADDRESS_SENTINEL` when the user has no saved
 * addresses so the inline new-address form is shown immediately.
 */
function pickInitialAddressId(
  addresses: ReadonlyArray<Address>,
): string {
  if (addresses.length === 0) return NEW_ADDRESS_SENTINEL;
  const defaultRow = addresses.find((a) => a.isDefault);
  return (defaultRow ?? addresses[0]).id;
}

function formatAddressLines(a: Address): string[] {
  const cityLine = [a.city, a.state, a.postalCode].filter(Boolean).join(", ");
  return [
    a.recipient ?? null,
    a.line1,
    a.line2,
    cityLine,
    a.country,
  ].filter((l): l is string => Boolean(l && l.length > 0));
}

/**
 * /checkout client surface.
 *
 * Everything below the page header lives here:
 *
 *   1. Order summary — read-only line items + a totals box that mirrors
 *      the cart's. The discount line and the running total update live
 *      whenever a promo is applied or removed.
 *
 *   2. Shipping address picker. The default-flagged saved address is
 *      pre-selected. Users without any saved addresses (or who pick the
 *      "Use a new address" radio) get an inline address form they can
 *      fill in without leaving checkout, plus a "Save this address to
 *      my account" toggle that promotes the new address to the user's
 *      default. The order API persists every inline address regardless
 *      so a one-off ship-to is still recorded against the order, but
 *      the toggle controls whether it becomes the auto-selected default
 *      next time.
 *
 *   3. Promo code input + Apply button. Calls
 *      POST /api/discount-codes/validate. Inline error states cover the
 *      full vocabulary the API returns (not_found / inactive / expired
 *      / exhausted / min_order_not_met / 401 / network). The applied
 *      code is held in client state only; the API is stateless. Single
 *      code per order is enforced visually (the input/Apply button is
 *      replaced with the applied pill — the user must remove the code
 *      before applying a different one) and on the server (one
 *      `discountCode` field on POST /api/orders).
 *
 *   4. Cash on Delivery payment method. The only payment rail this
 *      storefront supports is COD; the shopper must explicitly tick a
 *      confirmation checkbox acknowledging they will pay cash on
 *      delivery before the Place Order CTA enables.
 *
 *   5. Place Order CTA. Submits the chosen address (id OR inline
 *      payload) and the active discount code (when present) to
 *      POST /api/orders. The route transactionally commits the order
 *      and clears the cart. We refresh the cart store and route to
 *      /checkout/confirmation/{orderId} on success so the user lands
 *      on a dedicated thank-you screen.
 */
export function CheckoutForm({
  initialItems,
  initialSummary,
  initialAddresses,
  userEmail,
}: CheckoutFormProps) {
  const router = useRouter();
  const cart = useCart();

  const items = initialItems;
  const summary = initialSummary;
  const addresses = initialAddresses;

  // ─── Promo code ─────────────────────────────────────────────────────
  const [promoInput, setPromoInput] = React.useState("");
  const [promoError, setPromoError] = React.useState<string | null>(null);
  const [promoPending, setPromoPending] = React.useState(false);
  const [appliedDiscount, setAppliedDiscount] =
    React.useState<NormalizedDiscountView | null>(null);

  // Re-validate the applied promo whenever the subtotal moves so the
  // displayed amount stays in sync. If the recomputed amount is the
  // same we leave it alone; if the code has since become invalid we
  // drop it silently — the user will see the discount line disappear.
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

  const totals = React.useMemo(
    () => computeTotals(summary, appliedDiscount),
    [summary, appliedDiscount],
  );

  const handlePromoSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const code = promoInput.trim();
      if (!code || promoPending) return;
      // Single-code-per-order: refuse to apply a second promo while one
      // is already active. The UI hides the input in this state, but the
      // belt-and-braces guard catches a programmatic submit too.
      if (appliedDiscount) {
        setPromoError(
          "Only one promo code can be applied per order. Remove the active code first.",
        );
        return;
      }
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
            // ignore parse errors
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
    [appliedDiscount, promoInput, promoPending, summary.subtotalCents, summary.currency],
  );

  const removeDiscount = React.useCallback(() => {
    setAppliedDiscount(null);
    setPromoError(null);
  }, []);

  // ─── Address selection ─────────────────────────────────────────────
  // `selectedAddressId` is either an `addresses[i].id`, or the
  // `NEW_ADDRESS_SENTINEL` string meaning "use the inline new-address
  // form below". We never carry `null` — when the user has no saved
  // addresses we default straight into new-address mode so they see the
  // form right away.
  const [selectedAddressId, setSelectedAddressId] = React.useState<string>(
    () => pickInitialAddressId(addresses),
  );

  const [newAddress, setNewAddress] = React.useState<AddressFormValues>(
    emptyAddressFormValues,
  );
  // When ON we pass `isDefault: true` to the order API so the address
  // becomes the auto-selected option for next checkout. The order
  // endpoint always persists the inline row in `addresses`; this toggle
  // is purely about whether it should win the "default" flag.
  const [saveNewAddress, setSaveNewAddress] = React.useState(true);
  const [newAddressErrors, setNewAddressErrors] = React.useState<
    Partial<Record<keyof AddressFormValues, string>>
  >({});

  const updateNewAddressField = React.useCallback(
    <K extends keyof AddressFormValues>(
      field: K,
      value: AddressFormValues[K],
    ) => {
      setNewAddress((prev) => ({ ...prev, [field]: value }));
      setNewAddressErrors((prev) => {
        if (!prev[field]) return prev;
        const next = { ...prev };
        delete next[field];
        return next;
      });
    },
    [],
  );

  const usingNewAddress = selectedAddressId === NEW_ADDRESS_SENTINEL;

  // ─── Payment method (Cash on Delivery) ─────────────────────────────
  // The storefront only supports COD; we still require an explicit
  // confirmation tick so the shopper knows what they're committing to.
  const [codConfirmed, setCodConfirmed] = React.useState(false);

  // ─── Place order ───────────────────────────────────────────────────
  const [placing, setPlacing] = React.useState(false);
  const [placeError, setPlaceError] = React.useState<string | null>(null);

  const explainPlaceError = React.useCallback(
    (status: number, body: OrderErrorBody): string => {
      if (status === 401) {
        router.replace("/login?next=/checkout");
        return "Your session has expired. Sign in again to place this order.";
      }
      if (status === 404 && body.code === "address_not_found") {
        return "The selected shipping address could not be found. Pick a different one.";
      }
      if (status === 409 && body.code === "cart_empty") {
        return "Your cart is empty. Add an item before placing an order.";
      }
      if (status === 409 && body.code === "stock_conflict") {
        const sku = body.details?.sku;
        const available = body.details?.available;
        const requested = body.details?.requested;
        if (typeof available === "number" && typeof requested === "number") {
          return sku
            ? `Only ${available} of ${sku} left (you have ${requested} in your cart). Update your cart and try again.`
            : `One of the items in your cart has insufficient stock (only ${available} left). Update your cart and try again.`;
        }
        return "One of the items in your cart is no longer in stock. Update your cart and try again.";
      }
      if (status === 409 && body.code === "product_unavailable") {
        return "An item in your cart is no longer available. Remove it and try again.";
      }
      if (status === 409 && body.code === "discount_invalid") {
        const reason = body.details?.reason;
        if (reason === "expired") return "Your promo code expired. Remove it and try again.";
        if (reason === "exhausted") return "Your promo code is fully redeemed. Remove it and try again.";
        if (reason === "inactive") return "Your promo code is no longer active. Remove it and try again.";
        if (reason === "min_order_not_met") {
          return "Your cart no longer meets the minimum for the applied promo. Remove it and try again.";
        }
        return "The promo code can't be applied to this order. Remove it and try again.";
      }
      if (status === 400 && body.code === "address_required") {
        return "Add a shipping address to your account before placing the order.";
      }
      return body.error ?? "We couldn't place your order. Please try again.";
    },
    [router],
  );

  const handlePlaceOrder = React.useCallback(async () => {
    if (placing) return;
    if (items.length === 0) {
      setPlaceError("Your cart is empty.");
      return;
    }
    if (!codConfirmed) {
      setPlaceError(
        "Please confirm Cash on Delivery before placing your order.",
      );
      return;
    }

    // Build the addressId / inline-address branch of the request body.
    // Exactly one of the two fields is sent — the server's Zod schema
    // refuses payloads carrying both.
    let addressBody:
      | { addressId: string }
      | { address: ReturnType<typeof toAddressApiPayload> };
    if (selectedAddressId === NEW_ADDRESS_SENTINEL) {
      const parsed = addressFormSchema.safeParse(newAddress);
      if (!parsed.success) {
        const fieldErrors: Partial<Record<keyof AddressFormValues, string>> =
          {};
        for (const issue of parsed.error.issues) {
          const key = issue.path[0] as keyof AddressFormValues | undefined;
          if (key && !fieldErrors[key]) {
            fieldErrors[key] = issue.message;
          }
        }
        setNewAddressErrors(fieldErrors);
        setPlaceError(
          "Please fix the highlighted fields in your shipping address.",
        );
        return;
      }
      const payload = toAddressApiPayload({
        ...parsed.data,
        // The save toggle drives the `isDefault` flag — when ON, the
        // backend demotes any prior default and promotes this one.
        isDefault: saveNewAddress,
      });
      addressBody = { address: payload };
    } else {
      addressBody = { addressId: selectedAddressId };
    }

    setPlacing(true);
    setPlaceError(null);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...addressBody,
          // Single-code-per-order: at most one `discountCode` value here.
          // Server re-validates inside the SERIALIZABLE order transaction.
          discountCode: appliedDiscount?.code ?? null,
        }),
      });
      if (!res.ok) {
        let body: OrderErrorBody = {};
        try {
          body = (await res.json()) as OrderErrorBody;
        } catch {
          // ignore parse errors
        }
        const message = explainPlaceError(res.status, body);
        setPlaceError(message);
        toast.error("Couldn't place order", { description: message });
        // If the discount became invalid, drop it so a retry doesn't
        // trip the same 409 again.
        if (
          res.status === 409 &&
          body.code === "discount_invalid" &&
          appliedDiscount
        ) {
          setAppliedDiscount(null);
        }
        return;
      }
      const body = (await res.json()) as OrderSuccessBody;
      // Cart was cleared server-side — sync the client store so the
      // header badge updates instantly.
      cart.setCount(0);
      void cart.refresh();
      toast.success("Order placed", {
        description: `Thanks! We've sent a confirmation to ${userEmail}.`,
      });
      // Drop the user on the dedicated confirmation page so they get a
      // proper "thank you" view of the order they just committed.
      router.push(`/checkout/confirmation/${encodeURIComponent(body.order.id)}`);
      router.refresh();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Couldn't reach the server. Please try again.";
      setPlaceError(message);
      toast.error("Network error", { description: message });
    } finally {
      setPlacing(false);
    }
  }, [
    placing,
    selectedAddressId,
    newAddress,
    saveNewAddress,
    codConfirmed,
    items.length,
    appliedDiscount,
    cart,
    explainPlaceError,
    router,
    userEmail,
  ]);

  // ─── Render ─────────────────────────────────────────────────────────
  const hasAddresses = addresses.length > 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      {/* ─── Left column: address picker + line items ──────────────── */}
      <div className="space-y-6">
        <Card data-testid="checkout-address">
          <CardContent className="space-y-4 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <h2 className="text-base font-semibold">
                  Shipping address
                </h2>
                <p className="text-xs text-muted-foreground">
                  Pick where we should ship this order.
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href="/account/addresses">
                  <MapPin className="h-4 w-4" aria-hidden="true" />
                  Manage
                </Link>
              </Button>
            </div>

            <ul
              className="space-y-2"
              role="radiogroup"
              aria-label="Shipping address"
              data-testid="checkout-address-options"
            >
              {addresses.map((address) => {
                const id = `checkout-address-${address.id}`;
                const selected = selectedAddressId === address.id;
                const lines = formatAddressLines(address);
                return (
                  <li key={address.id}>
                    <label
                      htmlFor={id}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-4 transition",
                        selected
                          ? "border-primary ring-2 ring-primary/30"
                          : "hover:border-foreground/30",
                      )}
                      data-testid={`checkout-address-${address.id}`}
                    >
                      <input
                        id={id}
                        type="radio"
                        name="checkout-address"
                        value={address.id}
                        checked={selected}
                        onChange={() => setSelectedAddressId(address.id)}
                        className="mt-1 h-4 w-4 cursor-pointer accent-primary"
                        aria-label={address.label ?? "Address"}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">
                            {address.label ?? "Address"}
                          </span>
                          {address.isDefault && (
                            <Badge variant="success" className="text-[10px] uppercase">
                              Default
                            </Badge>
                          )}
                        </div>
                        <address className="mt-1 space-y-0.5 text-xs not-italic text-muted-foreground">
                          {lines.map((line, i) => (
                            <div key={i}>{line}</div>
                          ))}
                          {address.phone && (
                            <div className="pt-0.5">{address.phone}</div>
                          )}
                        </address>
                      </div>
                    </label>
                  </li>
                );
              })}

              {/* "Use a new address" radio always lives at the bottom of
                  the list so shoppers without saved addresses (and
                  shoppers shipping to a one-off destination) can fill in
                  a fresh address without leaving checkout. */}
              <li>
                <label
                  htmlFor="checkout-address-new"
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border border-dashed bg-card p-4 transition",
                    usingNewAddress
                      ? "border-primary ring-2 ring-primary/30"
                      : "hover:border-foreground/30",
                  )}
                  data-testid="checkout-address-new-toggle"
                >
                  <input
                    id="checkout-address-new"
                    type="radio"
                    name="checkout-address"
                    value={NEW_ADDRESS_SENTINEL}
                    checked={usingNewAddress}
                    onChange={() =>
                      setSelectedAddressId(NEW_ADDRESS_SENTINEL)
                    }
                    className="mt-1 h-4 w-4 cursor-pointer accent-primary"
                    aria-label="Use a new address"
                  />
                  <div className="min-w-0 flex-1">
                    <span className="font-medium">
                      {hasAddresses ? "Use a new address" : "Add a shipping address"}
                    </span>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {hasAddresses
                        ? "Ship this order to a different address."
                        : "Enter where we should send this order."}
                    </p>
                  </div>
                </label>
              </li>
            </ul>

            {usingNewAddress && (
              <div
                className="space-y-3 rounded-lg border bg-muted/10 p-4"
                data-testid="checkout-new-address-form"
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="new-addr-label" className="text-xs">
                      Label{" "}
                      <span className="text-muted-foreground">(optional)</span>
                    </Label>
                    <Input
                      id="new-addr-label"
                      value={newAddress.label ?? ""}
                      onChange={(e) =>
                        updateNewAddressField("label", e.target.value)
                      }
                      placeholder="Home, Work, …"
                      autoComplete="off"
                      disabled={placing}
                    />
                    {newAddressErrors.label && (
                      <p className="text-xs text-destructive">
                        {newAddressErrors.label}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-addr-recipient" className="text-xs">
                      Recipient{" "}
                      <span className="text-muted-foreground">(optional)</span>
                    </Label>
                    <Input
                      id="new-addr-recipient"
                      value={newAddress.recipient ?? ""}
                      onChange={(e) =>
                        updateNewAddressField("recipient", e.target.value)
                      }
                      placeholder="Full name (if different)"
                      autoComplete="name"
                      disabled={placing}
                    />
                    {newAddressErrors.recipient && (
                      <p className="text-xs text-destructive">
                        {newAddressErrors.recipient}
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="new-addr-phone" className="text-xs">
                    Phone{" "}
                    <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    id="new-addr-phone"
                    type="tel"
                    autoComplete="tel"
                    value={newAddress.phone ?? ""}
                    onChange={(e) =>
                      updateNewAddressField("phone", e.target.value)
                    }
                    placeholder="Contact number for delivery"
                    disabled={placing}
                  />
                  {newAddressErrors.phone && (
                    <p className="text-xs text-destructive">
                      {newAddressErrors.phone}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="new-addr-line1" className="text-xs">
                    Address line 1
                  </Label>
                  <Input
                    id="new-addr-line1"
                    value={newAddress.line1}
                    onChange={(e) =>
                      updateNewAddressField("line1", e.target.value)
                    }
                    placeholder="Street address"
                    autoComplete="address-line1"
                    disabled={placing}
                    aria-invalid={!!newAddressErrors.line1}
                  />
                  {newAddressErrors.line1 && (
                    <p className="text-xs text-destructive">
                      {newAddressErrors.line1}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="new-addr-line2" className="text-xs">
                    Address line 2{" "}
                    <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    id="new-addr-line2"
                    value={newAddress.line2 ?? ""}
                    onChange={(e) =>
                      updateNewAddressField("line2", e.target.value)
                    }
                    placeholder="Apartment, suite, unit"
                    autoComplete="address-line2"
                    disabled={placing}
                  />
                  {newAddressErrors.line2 && (
                    <p className="text-xs text-destructive">
                      {newAddressErrors.line2}
                    </p>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="new-addr-city" className="text-xs">
                      City
                    </Label>
                    <Input
                      id="new-addr-city"
                      value={newAddress.city}
                      onChange={(e) =>
                        updateNewAddressField("city", e.target.value)
                      }
                      autoComplete="address-level2"
                      disabled={placing}
                      aria-invalid={!!newAddressErrors.city}
                    />
                    {newAddressErrors.city && (
                      <p className="text-xs text-destructive">
                        {newAddressErrors.city}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-addr-state" className="text-xs">
                      State / region{" "}
                      <span className="text-muted-foreground">(optional)</span>
                    </Label>
                    <Input
                      id="new-addr-state"
                      value={newAddress.state ?? ""}
                      onChange={(e) =>
                        updateNewAddressField("state", e.target.value)
                      }
                      autoComplete="address-level1"
                      disabled={placing}
                    />
                    {newAddressErrors.state && (
                      <p className="text-xs text-destructive">
                        {newAddressErrors.state}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="new-addr-postal" className="text-xs">
                      Postal code
                    </Label>
                    <Input
                      id="new-addr-postal"
                      value={newAddress.postalCode}
                      onChange={(e) =>
                        updateNewAddressField("postalCode", e.target.value)
                      }
                      autoComplete="postal-code"
                      disabled={placing}
                      aria-invalid={!!newAddressErrors.postalCode}
                    />
                    {newAddressErrors.postalCode && (
                      <p className="text-xs text-destructive">
                        {newAddressErrors.postalCode}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-addr-country" className="text-xs">
                      Country
                    </Label>
                    <Input
                      id="new-addr-country"
                      value={newAddress.country}
                      onChange={(e) =>
                        updateNewAddressField(
                          "country",
                          e.target.value.toUpperCase(),
                        )
                      }
                      autoComplete="country"
                      placeholder="US"
                      maxLength={2}
                      disabled={placing}
                      aria-invalid={!!newAddressErrors.country}
                    />
                    {newAddressErrors.country ? (
                      <p className="text-xs text-destructive">
                        {newAddressErrors.country}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Two-letter ISO code (e.g. US).
                      </p>
                    )}
                  </div>
                </div>

                <label
                  htmlFor="new-addr-save"
                  className="flex cursor-pointer items-start gap-3 rounded-md border bg-card p-3"
                  data-testid="checkout-new-address-save"
                >
                  <input
                    id="new-addr-save"
                    type="checkbox"
                    checked={saveNewAddress}
                    onChange={(e) => setSaveNewAddress(e.target.checked)}
                    disabled={placing}
                    className="mt-0.5 h-4 w-4 cursor-pointer accent-primary"
                  />
                  <div className="space-y-0.5 text-xs">
                    <p className="font-medium">
                      Save this address to my account
                    </p>
                    <p className="text-muted-foreground">
                      We&apos;ll keep it on file as your default so it&apos;s
                      pre-selected next checkout.
                    </p>
                  </div>
                </label>
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="checkout-items">
          <CardContent className="space-y-3 p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold">
                {items.length === 1
                  ? "1 item"
                  : `${items.length.toLocaleString()} items`}
              </h2>
              <Button asChild variant="ghost" size="sm">
                <Link href="/cart">
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  Edit cart
                </Link>
              </Button>
            </div>

            <ul className="space-y-3">
              {items.map((line) => {
                const product = line.product;
                if (!product) {
                  return (
                    <li
                      key={line.id}
                      className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground"
                    >
                      A product in your cart is no longer available. Update
                      your cart before placing the order.
                    </li>
                  );
                }
                const lineTotal = formatPrice(
                  line.lineTotalCents,
                  line.currency,
                );
                const unit = formatPrice(
                  product.priceCents,
                  product.currency,
                );
                const overStock =
                  product.stockStatus !== "out_of_stock" &&
                  line.quantity > product.stock;
                const outOfStock =
                  product.stockStatus === "out_of_stock" || product.stock <= 0;
                return (
                  <li
                    key={line.id}
                    className="flex items-start gap-3"
                    data-testid={`checkout-line-${line.id}`}
                  >
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
                      {product.primaryImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={product.primaryImageUrl}
                          alt={product.name}
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
                        {product.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {line.quantity} × {unit}
                      </p>
                      {(outOfStock || overStock) && (
                        <p className="mt-1 text-xs text-destructive">
                          {outOfStock
                            ? "Out of stock — remove this item or restore stock before placing the order."
                            : `Only ${product.stock} left — adjust quantity in your cart.`}
                        </p>
                      )}
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
      </div>

      {/* ─── Right column: promo code + totals + Place order ─────── */}
      <aside
        aria-label="Order summary"
        className="lg:sticky lg:top-20 lg:self-start"
      >
        <Card>
          <CardContent className="space-y-4 p-5">
            <h2 className="text-base font-semibold">Order summary</h2>

            {/* Promo code form. Hidden once a code is applied — the
                applied pill takes its place to make the
                single-code-per-order constraint obvious. */}
            <div className="space-y-1.5" data-testid="checkout-promo-section">
              <Label
                htmlFor="checkout-promo"
                className="text-xs font-medium"
              >
                Promo code
              </Label>
              {appliedDiscount ? (
                <div
                  className="flex items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-200"
                  data-testid="checkout-promo-applied"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 font-semibold">
                      <CheckCircle2
                        className="h-3.5 w-3.5"
                        aria-hidden="true"
                      />
                      {appliedDiscount.code} applied
                    </p>
                    {appliedDiscount.description && (
                      <p className="truncate text-emerald-800/80 dark:text-emerald-300/80">
                        {appliedDiscount.description}
                      </p>
                    )}
                    <p className="mt-0.5 text-[11px] text-emerald-800/80 dark:text-emerald-300/80">
                      Only one promo can be applied per order.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={removeDiscount}
                    aria-label="Remove promo code"
                    className="rounded p-1 text-emerald-900 hover:bg-emerald-100 dark:text-emerald-200 dark:hover:bg-emerald-900/40"
                    data-testid="checkout-promo-remove"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <form
                  className="flex gap-2"
                  onSubmit={handlePromoSubmit}
                  data-testid="checkout-promo-form"
                >
                  <Input
                    id="checkout-promo"
                    name="code"
                    value={promoInput}
                    onChange={(event) => {
                      setPromoInput(event.target.value);
                      if (promoError) setPromoError(null);
                    }}
                    placeholder="Enter code"
                    autoComplete="off"
                    disabled={promoPending || placing}
                    data-testid="checkout-promo-input"
                  />
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={
                      promoPending ||
                      placing ||
                      promoInput.trim().length === 0
                    }
                    data-testid="checkout-promo-apply"
                  >
                    {promoPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Tag className="h-4 w-4" />
                    )}
                    Apply
                  </Button>
                </form>
              )}
              {promoError && (
                <p
                  role="alert"
                  className="text-xs text-destructive"
                  data-testid="checkout-promo-error"
                >
                  {promoError}
                </p>
              )}
            </div>

            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd
                  className="font-medium"
                  data-testid="checkout-summary-subtotal"
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
                    data-testid="checkout-summary-discount"
                  >
                    −{formatPrice(totals.discountCents, totals.currency)}
                  </dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Shipping</dt>
                <dd
                  className="font-medium"
                  data-testid="checkout-summary-shipping"
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
                    data-testid="checkout-summary-total"
                  >
                    {formatPrice(totals.totalCents, totals.currency)}
                  </dd>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Taxes calculated at fulfillment.
                </p>
              </div>
            </dl>

            {/* Cash on Delivery is the only payment rail we support. The
                shopper still has to explicitly tick the confirmation
                checkbox so there's an unambiguous "I will pay on
                delivery" gesture before Place Order enables. */}
            <div
              className="space-y-2 rounded-md border bg-muted/10 p-3"
              data-testid="checkout-payment-method"
            >
              <div className="flex items-start gap-2">
                <Banknote
                  className="mt-0.5 h-4 w-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">Cash on Delivery</p>
                  <p className="text-xs text-muted-foreground">
                    Pay in cash when your order arrives. No card needed.
                  </p>
                </div>
              </div>
              <label
                htmlFor="checkout-cod-confirm"
                className="flex cursor-pointer items-start gap-2 rounded-md border bg-card p-2.5"
              >
                <input
                  id="checkout-cod-confirm"
                  type="checkbox"
                  checked={codConfirmed}
                  onChange={(e) => {
                    setCodConfirmed(e.target.checked);
                    if (e.target.checked && placeError) setPlaceError(null);
                  }}
                  disabled={placing}
                  className="mt-0.5 h-4 w-4 cursor-pointer accent-primary"
                  data-testid="checkout-cod-checkbox"
                  aria-describedby="checkout-cod-confirm-help"
                />
                <div className="space-y-0.5 text-xs">
                  <p className="font-medium">
                    I confirm I will pay cash on delivery.
                  </p>
                  <p
                    id="checkout-cod-confirm-help"
                    className="text-muted-foreground"
                  >
                    The driver will collect the total at the door.
                  </p>
                </div>
              </label>
            </div>

            {placeError && (
              <div
                role="alert"
                className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-xs text-destructive"
                data-testid="checkout-place-error"
              >
                {placeError}
              </div>
            )}

            <Button
              type="button"
              className="w-full"
              size="lg"
              disabled={
                placing ||
                items.length === 0 ||
                !codConfirmed ||
                (!usingNewAddress && !hasAddresses)
              }
              onClick={handlePlaceOrder}
              data-testid="checkout-place-order"
            >
              {placing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Lock className="h-4 w-4" aria-hidden="true" />
              )}
              {placing
                ? "Placing order…"
                : `Place order — ${formatPrice(totals.totalCents, totals.currency)}`}
            </Button>

            <Button
              asChild
              variant="ghost"
              size="sm"
              className="w-full"
              data-testid="checkout-back-to-cart"
            >
              <Link href="/cart">
                <ShoppingBag className="h-4 w-4" aria-hidden="true" />
                Back to cart
              </Link>
            </Button>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
