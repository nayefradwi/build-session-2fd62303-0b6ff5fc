"use client";

import * as React from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/client/utils";
import { pushRecentSearch } from "@/lib/client/recent-searches";

interface HeaderSearchProps {
  className?: string;
}

/**
 * Search input rendered inside the site header.
 *
 * Submitting routes to `/search?q=<term>` (matching the task contract)
 * and pushes the query into the localStorage-backed "recent searches"
 * list so the search page can surface it for one-tap repeat searches.
 *
 * The input keeps itself in sync with the `q` URL parameter when the
 * user is *already* on `/search` (so refreshing or following a recent
 * search link doesn't strand the input out of sync). On other pages
 * the field stays empty so the header doesn't leak previous queries
 * after the user has navigated away.
 */
export function HeaderSearch({ className }: HeaderSearchProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const onSearchPage = pathname === "/search";
  const urlQuery = onSearchPage ? (searchParams.get("q") ?? "") : "";

  const [value, setValue] = React.useState(urlQuery);

  // Pull from the URL when navigating between pages — e.g. clicking a
  // recent-search link should populate the header with that term.
  React.useEffect(() => {
    setValue(urlQuery);
  }, [urlQuery]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      // Empty submit → still take the user to /search so they see the
      // empty-state UI (with recents) rather than silently no-op.
      router.push("/search");
      return;
    }
    pushRecentSearch(trimmed);
    const params = new URLSearchParams();
    params.set("q", trimmed);
    router.push(`/search?${params.toString()}`);
  }

  return (
    <form
      onSubmit={onSubmit}
      role="search"
      aria-label="Site search"
      className={cn("relative w-full max-w-sm", className)}
      // Native form submit fallback — if JS hasn't hydrated yet, the
      // browser still gets the user to /search?q=...
      action="/search"
      method="get"
    >
      <label htmlFor="site-header-search" className="sr-only">
        Search products
      </label>
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        id="site-header-search"
        name="q"
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search products"
        autoComplete="off"
        className="h-9 pl-8"
      />
    </form>
  );
}
