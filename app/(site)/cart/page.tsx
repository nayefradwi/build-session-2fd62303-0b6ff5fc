import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CartList } from "@/components/cart/cart-list";
import { getCartView } from "@/lib/server/cart";
import { getCurrentUser } from "@/lib/server/auth";
import type {
  CartLineView,
  CartSummaryView,
} from "@/lib/client/cart-types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cart",
  description: "Review the items in your cart and proceed to checkout.",
};

/**
 * /cart — fully-rendered list of every cart line for the signed-in
 * shopper, plus a sticky order summary with subtotal, flat shipping,
 * an optional discount, and the running total.
 *
 * SSR loads the rows directly via the same `getCartView` helper that
 * backs GET /api/cart, so the initial render is fully populated (no
 * skeleton) and stock / line totals stay accurate. Mutations (quantity
 * stepper, remove, promo apply) flow through the API routes from a
 * client child so the optimistic UI is instant and the header cart
 * badge updates without waiting on a refetch.
 *
 * Unauthenticated visitors are redirected to /login with a `next` param
 * so they bounce back to /cart after signing in. Once logged in, the
 * "Proceed to checkout" button surfaces — empty carts and unauth
 * sessions never see it.
 */
export default async function CartPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?next=/cart");
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
  let loadError = false;
  try {
    // Server helper returns the same shape as the JSON response — just
    // without a serialisation round-trip. Cast to the client view types
    // since we're handing the data down to a "use client" component.
    const view = await getCartView(user.id);
    items = view.items as CartLineView[];
    summary = view.summary as CartSummaryView;
  } catch (err) {
    console.error("[cart] failed to load cart", err);
    loadError = true;
  }

  const lineCountLabel =
    items.length === 0
      ? "Nothing in your cart yet."
      : items.length === 1
        ? "1 item in your cart."
        : `${items.length.toLocaleString()} items in your cart.`;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-12">
      <header className="mb-6 space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Your cart</h1>
        <p className="text-sm text-muted-foreground">{lineCountLabel}</p>
      </header>

      {loadError ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/50 bg-destructive/5 p-6 text-sm text-destructive"
        >
          We couldn&apos;t load your cart right now. Please refresh the page or
          try again in a moment.
        </div>
      ) : (
        <CartList initialItems={items} initialSummary={summary} />
      )}
    </main>
  );
}
