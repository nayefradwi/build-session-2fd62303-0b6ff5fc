import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CheckoutForm } from "@/components/cart/checkout-form";
import { getCartView } from "@/lib/server/cart";
import { listAddressesForUser } from "@/lib/server/addresses";
import { getCurrentUser } from "@/lib/server/auth";
import type {
  CartLineView,
  CartSummaryView,
} from "@/lib/client/cart-types";
import type { Address } from "@/components/account/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Checkout",
  description: "Review your order and apply a promo code before placing it.",
};

/**
 * /checkout — review-and-confirm step that sits between the cart and
 * the order-creation API.
 *
 * The page is auth-gated (anonymous visitors bounce to /login?next=/checkout).
 * SSR loads:
 *
 *   1. The shopper's cart via the same `getCartView` helper that backs
 *      GET /api/cart, so we get the authoritative subtotal + line list
 *      without a roundtrip;
 *   2. Their saved addresses so the checkout form can default to the
 *      preferred shipping address.
 *
 * If the cart is empty we redirect back to /cart — there's nothing to
 * commit, and showing a "Place order" CTA on an empty page would confuse.
 *
 * The discount code input + Apply button live inside <CheckoutForm />
 * (a "use client" component). The single-code-per-order rule is
 * enforced by:
 *
 *   - the request shape (one `discountCode` per POST /api/orders),
 *   - the form's UI (a single "applied" pill that must be removed
 *     before a different code can be applied),
 *   - the server's transactional re-validation in `createOrderFromCart`.
 */
export default async function CheckoutPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?next=/checkout");
  }

  let items: CartLineView[] = [];
  let summary: CartSummaryView = {
    itemCount: 0,
    subtotalCents: 0,
    shippingCents: 0,
    discountCents: 0,
    totalCents: 0,
    currency: "USD",
  };
  let addresses: Address[] = [];
  let loadError = false;

  try {
    const view = await getCartView(user.id);
    items = view.items as CartLineView[];
    summary = view.summary as CartSummaryView;
  } catch (err) {
    console.error("[checkout] failed to load cart", err);
    loadError = true;
  }

  if (!loadError && items.length === 0) {
    // Nothing to commit. Bounce back to /cart so the shopper isn't
    // staring at an empty Place-Order CTA.
    redirect("/cart");
  }

  try {
    const rows = await listAddressesForUser(user.id);
    // Drizzle returns Date columns that need to be ISO-stringified before
    // we hand them down to a "use client" boundary.
    addresses = rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })) as Address[];
  } catch (err) {
    // Addresses are surfaced as a "use the inline form" fallback in the
    // client; a hard error doesn't block the rest of the page.
    console.error("[checkout] failed to load addresses", err);
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-12">
      <header className="mb-6 space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Checkout</h1>
        <p className="text-sm text-muted-foreground">
          Review your order, apply any promo code, and confirm to place it.
        </p>
      </header>

      {loadError ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/50 bg-destructive/5 p-6 text-sm text-destructive"
        >
          We couldn&apos;t load your cart right now. Please refresh the page
          or try again in a moment.
        </div>
      ) : (
        <CheckoutForm
          initialItems={items}
          initialSummary={summary}
          initialAddresses={addresses}
          userEmail={user.email}
        />
      )}
    </main>
  );
}
