import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { WishlistList } from "@/components/products/wishlist-list";
import { getCurrentUser } from "@/lib/server/auth";
import { listWishlistForUser } from "@/lib/server/wishlist";
import type { WishlistEntryView } from "@/lib/client/wishlist-types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Wishlist",
  description: "Items you've saved for later.",
};

/**
 * /wishlist — paginated-feel list of every product the signed-in user
 * has saved.
 *
 * SSR loads the rows directly via the same `listWishlistForUser`
 * helper that backs GET /api/wishlist, so the initial render is fully
 * populated (no skeleton) and stock/price stay accurate.
 *
 * Mutations (remove) go through the shared `WishlistProvider` from the
 * client component below, which:
 *   - Optimistically hides the row.
 *   - Calls DELETE /api/wishlist/{productId}.
 *   - Triggers `router.refresh()` on success so the SSR snapshot
 *     re-runs and the totals stay in sync.
 *
 * Unauthenticated visitors are redirected to /login with a `next`
 * param so they bounce back to the wishlist after signing in.
 */
export default async function WishlistPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?next=/wishlist");
  }

  let items: WishlistEntryView[] = [];
  let loadError = false;
  try {
    // The server helper returns the same shape as the API response — just
    // without the JSON serialization round-trip. Cast to the client view
    // type since we're handing it to a "use client" component.
    items = (await listWishlistForUser(user.id)) as WishlistEntryView[];
  } catch (err) {
    console.error("[wishlist] failed to load items", err);
    loadError = true;
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-12">
      <header className="mb-6 space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Your wishlist</h1>
        <p className="text-sm text-muted-foreground">
          {items.length === 0
            ? "Nothing saved yet."
            : items.length === 1
              ? "1 item saved for later."
              : `${items.length.toLocaleString()} items saved for later.`}
        </p>
      </header>

      {loadError ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/50 bg-destructive/5 p-6 text-sm text-destructive"
        >
          We couldn&apos;t load your wishlist right now. Please refresh the
          page or try again in a moment.
        </div>
      ) : (
        <WishlistList items={items} />
      )}
    </main>
  );
}
