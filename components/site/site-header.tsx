import Link from "next/link";
import { Heart } from "lucide-react";

import { Button } from "@/components/ui/button";
import { HeaderSearch } from "@/components/site/header-search";
import { LogoutButton } from "@/components/site/logout-button";
import { getCurrentUser } from "@/lib/server/auth";

/**
 * Top-of-app header. Server component, so it re-renders on every
 * `router.refresh()` — that's how the auth state stays in sync after
 * login / logout / register without us having to ferry user state
 * through a client-side context.
 *
 * Logged out  → "Sign in" + "Create account" CTAs
 * Logged in   → greeting + sign-out button
 *
 * The cookie is httpOnly + SameSite=Lax + path=/, so this header
 * naturally reflects the right state in every tab on the same origin
 * once that tab issues its next request.
 */
export async function SiteHeader() {
  // `getCurrentUser` reads the session cookie via `next/headers` and
  // looks the row up in Postgres. Returns `null` for anonymous users.
  const user = await getCurrentUser();

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:gap-4">
        <Link
          href="/"
          className="shrink-0 text-sm font-semibold tracking-tight hover:text-primary"
        >
          Build Session
        </Link>
        {/* Site-wide search — submits to /search. Hidden on the very
            narrowest screens (where it gets its own row below) so the
            auth nav still has room to breathe. */}
        <div className="hidden flex-1 justify-center sm:flex">
          <HeaderSearch />
        </div>
        <nav
          className="ml-auto flex items-center gap-2 sm:ml-0"
          aria-label="Account navigation"
        >
          {user ? (
            <>
              <span
                className="hidden text-sm text-muted-foreground sm:inline"
                data-testid="site-header-user"
              >
                Signed in as{" "}
                <span className="font-medium text-foreground">
                  {user.name?.trim() ? user.name : user.email}
                </span>
              </span>
              <Button
                asChild
                variant="ghost"
                size="sm"
                aria-label="View wishlist"
                title="Wishlist"
              >
                <Link href="/wishlist" data-testid="header-wishlist-link">
                  <Heart className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only sm:not-sr-only">Wishlist</span>
                </Link>
              </Button>
              <LogoutButton />
            </>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/register">Create account</Link>
              </Button>
            </>
          )}
        </nav>
      </div>
      {/* Mobile search row — shown only when the inline header search
          is hidden so /search is always one tap away. */}
      <div className="border-t px-4 py-2 sm:hidden">
        <HeaderSearch className="max-w-none" />
      </div>
    </header>
  );
}
