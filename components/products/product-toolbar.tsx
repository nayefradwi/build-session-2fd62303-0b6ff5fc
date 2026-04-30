"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { ProductSort } from "./product-sort";

interface ProductToolbarProps {
  basePath: string;
  /** Total result count, displayed alongside the toolbar. */
  total: number;
}

/**
 * Toolbar atop the /products and /search listings.
 *
 * Hosts the search input (form GET) and the sort dropdown. URL query
 * params drive both the toolbar state and the page's data fetch, so
 * navigation history (back/forward, bookmarks, share) "just works".
 *
 * The sort control is delegated to {@link ProductSort}, which keeps
 * every other URL param (filters, query, page) intact when the user
 * picks a new order — sort composes with active filters by design.
 *
 * Submit re-routes to `${basePath}?...` with the new query and resets
 * `page=1` so the user lands on the first page of the new result set.
 */
export function ProductToolbar({ basePath, total }: ProductToolbarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialQuery = searchParams.get("q") ?? "";
  const [query, setQuery] = React.useState(initialQuery);

  // Keep local form state in sync if the URL changes via Back/Forward
  // navigation or programmatic pushes from elsewhere on the page.
  React.useEffect(() => {
    setQuery(searchParams.get("q") ?? "");
  }, [searchParams]);

  function buildHref(nextQuery: string): string {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    if (nextQuery.trim().length > 0) {
      params.set("q", nextQuery.trim());
    } else {
      params.delete("q");
    }
    const qs = params.toString();
    return qs.length > 0 ? `${basePath}?${qs}` : basePath;
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    router.push(buildHref(query));
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:p-4 md:flex-row md:items-end md:justify-between">
      <form
        onSubmit={onSubmit}
        role="search"
        className="flex w-full items-end gap-2 md:max-w-md"
      >
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="product-search" className="text-xs">
            Search
          </Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="product-search"
              name="q"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products"
              className="pl-8"
            />
          </div>
        </div>
        <Button type="submit" variant="outline" className="shrink-0">
          Search
        </Button>
      </form>

      <div className="flex flex-col gap-1.5 md:items-end">
        <Label htmlFor="product-sort-button" className="text-xs">
          Sort by
        </Label>
        <div className="flex items-center gap-3">
          <ProductSort
            basePath={basePath}
            buttonId="product-sort-button"
          />
          <span className="hidden whitespace-nowrap text-xs text-muted-foreground sm:inline">
            {total.toLocaleString()} {total === 1 ? "result" : "results"}
          </span>
        </div>
      </div>
    </div>
  );
}
