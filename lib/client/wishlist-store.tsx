"use client";

/**
 * Client-side wishlist store.
 *
 * One source of truth for "is product X currently wishlisted?" across
 * every component on the page (product cards, PDP toggle, wishlist
 * page). Backed by GET/POST/DELETE /api/wishlist.
 *
 * The provider mounts at the root layout and:
 *   - Lazily fetches the wishlist on first mount. The HTTP cookie is
 *     httpOnly, so we can't read it from JS — instead we let the GET
 *     return 401 for guests and treat that as the unauthenticated
 *     signal. One round-trip per page load is acceptable.
 *   - Keeps a `Set<productId>` in state. Toggling is optimistic: the UI
 *     flips immediately and we roll back on a non-2xx response.
 *   - Surfaces success/error toasts so individual buttons don't have to
 *     duplicate that copy.
 *
 * Consumers use `useWishlist()` to read the current state and dispatch
 * `add` / `remove` / `toggle`. The result of those mutations is a
 * discriminated union so the caller (e.g. WishlistButton) can react
 * specifically to a 401 by showing the sign-in prompt.
 */
import * as React from "react";
import { toast } from "sonner";

import type {
  WishlistEntryView,
  WishlistListResponse,
} from "@/lib/client/wishlist-types";

export type WishlistActionResult =
  | { ok: true; action: "added" | "removed" | "kept" }
  | {
      ok: false;
      reason: "unauthenticated" | "network" | "error";
      message?: string;
    };

interface WishlistContextValue {
  /** True once the initial GET has resolved (succeeded or 401'd). */
  loaded: boolean;
  /** True if we know the user is signed in. */
  authenticated: boolean;
  /** Current wishlisted productIds. */
  productIds: ReadonlySet<string>;
  /** Convenience predicate. */
  isInWishlist(productId: string): boolean;
  add(productId: string, productName?: string): Promise<WishlistActionResult>;
  remove(
    productId: string,
    productName?: string,
  ): Promise<WishlistActionResult>;
  toggle(
    productId: string,
    productName?: string,
  ): Promise<WishlistActionResult>;
  /** Force a reload from the server. */
  refresh(): Promise<void>;
}

const WishlistContext = React.createContext<WishlistContextValue | null>(null);

interface ErrorBody {
  error?: string;
  code?: string;
}

interface AddResponseBody {
  alreadyExists?: boolean;
  item?: WishlistEntryView | null;
}

/**
 * Provider that loads wishlist state on mount and exposes mutators.
 * Wrap the whole app in this so any product surface can render a
 * consistent heart toggle without repeating the fetch.
 */
export function WishlistProvider({ children }: { children: React.ReactNode }) {
  const [loaded, setLoaded] = React.useState(false);
  const [authenticated, setAuthenticated] = React.useState(false);
  const [productIds, setProductIds] = React.useState<Set<string>>(
    () => new Set(),
  );

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch("/api/wishlist", {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (res.status === 401) {
        setAuthenticated(false);
        setProductIds(new Set());
        return;
      }
      if (!res.ok) {
        // Don't clobber state on a transient 5xx — leave whatever was
        // there in place.
        return;
      }
      const body = (await res.json()) as WishlistListResponse;
      const next = new Set<string>();
      for (const item of body.items ?? []) {
        if (item?.productId) next.add(item.productId);
      }
      setProductIds(next);
      setAuthenticated(true);
    } catch (err) {
      // Network failure — leave state alone.
      console.warn("[wishlist] failed to refresh", err);
    } finally {
      setLoaded(true);
    }
  }, []);

  // Initial load + refresh on tab focus so the wishlist page and other
  // surfaces stay in sync if the user mutates from another tab.
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

  const add = React.useCallback(
    async (
      productId: string,
      productName?: string,
    ): Promise<WishlistActionResult> => {
      // Optimistic insert.
      let alreadyHad = false;
      setProductIds((prev) => {
        if (prev.has(productId)) {
          alreadyHad = true;
          return prev;
        }
        const next = new Set(prev);
        next.add(productId);
        return next;
      });
      try {
        const res = await fetch("/api/wishlist", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId }),
        });
        if (res.status === 401) {
          if (!alreadyHad) {
            setProductIds((prev) => {
              if (!prev.has(productId)) return prev;
              const next = new Set(prev);
              next.delete(productId);
              return next;
            });
          }
          setAuthenticated(false);
          return { ok: false, reason: "unauthenticated" };
        }
        if (!res.ok) {
          if (!alreadyHad) {
            setProductIds((prev) => {
              if (!prev.has(productId)) return prev;
              const next = new Set(prev);
              next.delete(productId);
              return next;
            });
          }
          let body: ErrorBody = {};
          try {
            body = (await res.json()) as ErrorBody;
          } catch {
            // ignore
          }
          toast.error("Couldn't save to wishlist", {
            description: body.error ?? "Please try again in a moment.",
          });
          return { ok: false, reason: "error", message: body.error };
        }
        setAuthenticated(true);
        const body = (await res
          .json()
          .catch(() => ({}))) as AddResponseBody;
        if (body.alreadyExists) {
          toast.info("Already in your wishlist", {
            description: productName
              ? `${productName} is already saved to your wishlist.`
              : "This item is already saved.",
          });
          return { ok: true, action: "kept" };
        }
        toast.success("Added to wishlist", {
          description: productName
            ? `${productName} saved to your wishlist.`
            : "Saved to your wishlist.",
        });
        return { ok: true, action: "added" };
      } catch (err) {
        if (!alreadyHad) {
          setProductIds((prev) => {
            if (!prev.has(productId)) return prev;
            const next = new Set(prev);
            next.delete(productId);
            return next;
          });
        }
        const message =
          err instanceof Error
            ? err.message
            : "Could not reach the server. Please try again.";
        toast.error("Network error", { description: message });
        return { ok: false, reason: "network", message };
      }
    },
    [],
  );

  const remove = React.useCallback(
    async (
      productId: string,
      productName?: string,
    ): Promise<WishlistActionResult> => {
      // Optimistic delete.
      let didHave = false;
      setProductIds((prev) => {
        if (!prev.has(productId)) return prev;
        didHave = true;
        const next = new Set(prev);
        next.delete(productId);
        return next;
      });
      try {
        const res = await fetch(
          `/api/wishlist/${encodeURIComponent(productId)}`,
          {
            method: "DELETE",
            credentials: "same-origin",
            headers: { Accept: "application/json" },
          },
        );
        if (res.status === 401) {
          if (didHave) {
            setProductIds((prev) => {
              if (prev.has(productId)) return prev;
              const next = new Set(prev);
              next.add(productId);
              return next;
            });
          }
          setAuthenticated(false);
          return { ok: false, reason: "unauthenticated" };
        }
        // 404 means the row was already gone — that matches our optimistic
        // intent, so treat it as success.
        if (!res.ok && res.status !== 404) {
          if (didHave) {
            setProductIds((prev) => {
              if (prev.has(productId)) return prev;
              const next = new Set(prev);
              next.add(productId);
              return next;
            });
          }
          let body: ErrorBody = {};
          try {
            body = (await res.json()) as ErrorBody;
          } catch {
            // ignore
          }
          toast.error("Couldn't remove from wishlist", {
            description: body.error ?? "Please try again in a moment.",
          });
          return { ok: false, reason: "error", message: body.error };
        }
        setAuthenticated(true);
        toast.success("Removed from wishlist", {
          description: productName
            ? `${productName} removed from your wishlist.`
            : "Removed from your wishlist.",
        });
        return { ok: true, action: "removed" };
      } catch (err) {
        if (didHave) {
          setProductIds((prev) => {
            if (prev.has(productId)) return prev;
            const next = new Set(prev);
            next.add(productId);
            return next;
          });
        }
        const message =
          err instanceof Error
            ? err.message
            : "Could not reach the server. Please try again.";
        toast.error("Network error", { description: message });
        return { ok: false, reason: "network", message };
      }
    },
    [],
  );

  const toggle = React.useCallback(
    async (
      productId: string,
      productName?: string,
    ): Promise<WishlistActionResult> => {
      // Read latest synchronously via setState callback to avoid a stale
      // closure when toggles fire faster than React commits.
      let isCurrentlyIn = false;
      setProductIds((prev) => {
        isCurrentlyIn = prev.has(productId);
        return prev;
      });
      return isCurrentlyIn
        ? remove(productId, productName)
        : add(productId, productName);
    },
    [add, remove],
  );

  const isInWishlist = React.useCallback(
    (productId: string) => productIds.has(productId),
    [productIds],
  );

  const value = React.useMemo<WishlistContextValue>(
    () => ({
      loaded,
      authenticated,
      productIds,
      isInWishlist,
      add,
      remove,
      toggle,
      refresh,
    }),
    [
      loaded,
      authenticated,
      productIds,
      isInWishlist,
      add,
      remove,
      toggle,
      refresh,
    ],
  );

  return (
    <WishlistContext.Provider value={value}>
      {children}
    </WishlistContext.Provider>
  );
}

/**
 * Read the wishlist context. Falls back to an inert no-op shape if no
 * provider is mounted, so a stray render outside the layout doesn't
 * throw — it just won't reflect any wishlist state.
 */
export function useWishlist(): WishlistContextValue {
  const ctx = React.useContext(WishlistContext);
  if (ctx) return ctx;
  return INERT_VALUE;
}

const INERT_IDS: ReadonlySet<string> = new Set();
const INERT_VALUE: WishlistContextValue = {
  loaded: false,
  authenticated: false,
  productIds: INERT_IDS,
  isInWishlist: () => false,
  add: async () => ({
    ok: false,
    reason: "error",
    message: "Wishlist provider not mounted",
  }),
  remove: async () => ({
    ok: false,
    reason: "error",
    message: "Wishlist provider not mounted",
  }),
  toggle: async () => ({
    ok: false,
    reason: "error",
    message: "Wishlist provider not mounted",
  }),
  refresh: async () => {
    /* no-op */
  },
};
