"use client";

/**
 * Client-side cart store.
 *
 * Mirrors `lib/client/wishlist-store.tsx` in spirit: a single React
 * context that tracks "how many items does the signed-in user have in
 * their cart?" so the header badge, the PDP confirmation chrome and any
 * future cart surfaces can share one source of truth without each one
 * having to refetch /api/cart on its own.
 *
 * The provider is mounted at the root layout. On first paint it lazily
 * fetches /api/cart — the cookie is httpOnly so we use a 401 response as
 * the unauthenticated signal — and re-fetches on tab focus so the badge
 * stays consistent if the cart was mutated in another tab.
 *
 * Mutators (Add to Cart, wishlist → cart move, etc.) use the optimistic
 * helpers (`incrementCount`, `setCount`) for an instant badge bump and
 * then call `refresh()` to reconcile against the server's view.
 */
import * as React from "react";

interface CartSummaryShape {
  itemCount?: number;
}

interface CartViewShape {
  summary?: CartSummaryShape;
}

interface CartContextValue {
  /** True once the initial GET has resolved (succeeded or 401'd). */
  loaded: boolean;
  /** True if we know the user is signed in. */
  authenticated: boolean;
  /** Total quantity across every cart line. */
  itemCount: number;
  /** Re-fetch /api/cart and update `itemCount` / `authenticated`. */
  refresh(): Promise<void>;
  /** Optimistically bump the count by `delta`. */
  incrementCount(delta: number): void;
  /** Optimistically replace the count with `next`. */
  setCount(next: number): void;
}

const CartContext = React.createContext<CartContextValue | null>(null);

/**
 * Provider that loads cart state on mount and exposes the count + a few
 * thin mutators. Wrap the whole app in this so the header badge and PDP
 * "added to cart" affordances stay in sync without each surface
 * re-fetching for itself.
 */
export function CartProvider({ children }: { children: React.ReactNode }) {
  const [loaded, setLoaded] = React.useState(false);
  const [authenticated, setAuthenticated] = React.useState(false);
  const [itemCount, setItemCount] = React.useState(0);

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch("/api/cart", {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (res.status === 401) {
        setAuthenticated(false);
        setItemCount(0);
        return;
      }
      if (!res.ok) {
        // Don't clobber state on a transient 5xx — leave whatever was
        // there in place so the badge doesn't blink to zero.
        return;
      }
      const body = (await res.json()) as CartViewShape;
      const next = Math.max(0, body.summary?.itemCount ?? 0);
      setItemCount(next);
      setAuthenticated(true);
    } catch (err) {
      // Network failure — leave state alone.
      console.warn("[cart] failed to refresh", err);
    } finally {
      setLoaded(true);
    }
  }, []);

  // Initial load + refresh on tab focus so the badge stays in sync if
  // the cart is mutated from another tab.
  React.useEffect(() => {
    void refresh();
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const incrementCount = React.useCallback((delta: number) => {
    if (!Number.isFinite(delta) || delta === 0) return;
    setItemCount((prev) => Math.max(0, prev + delta));
  }, []);

  const setCount = React.useCallback((next: number) => {
    if (!Number.isFinite(next)) return;
    setItemCount(Math.max(0, Math.trunc(next)));
  }, []);

  const value = React.useMemo<CartContextValue>(
    () => ({
      loaded,
      authenticated,
      itemCount,
      refresh,
      incrementCount,
      setCount,
    }),
    [loaded, authenticated, itemCount, refresh, incrementCount, setCount],
  );

  return (
    <CartContext.Provider value={value}>{children}</CartContext.Provider>
  );
}

/**
 * Read the cart context. Falls back to an inert no-op shape if no
 * provider is mounted, so a stray render outside the layout doesn't
 * throw — it just won't reflect any cart state.
 */
export function useCart(): CartContextValue {
  const ctx = React.useContext(CartContext);
  if (ctx) return ctx;
  return INERT_VALUE;
}

const INERT_VALUE: CartContextValue = {
  loaded: false,
  authenticated: false,
  itemCount: 0,
  refresh: async () => {
    /* no-op */
  },
  incrementCount: () => {
    /* no-op */
  },
  setCount: () => {
    /* no-op */
  },
};
