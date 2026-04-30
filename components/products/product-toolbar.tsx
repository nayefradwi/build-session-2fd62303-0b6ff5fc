"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ProductToolbarProps {
  basePath: string;
  /** Total result count, displayed alongside the toolbar. */
  total: number;
}

interface SortOption {
  value: string;
  label: string;
}

const SORT_OPTIONS: ReadonlyArray<SortOption> = [
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "popularity", label: "Most popular" },
  { value: "rating", label: "Highest rated" },
  { value: "relevance", label: "Most relevant" },
];

/**
 * Toolbar atop the /products listing page.
 *
 * Hosts the search input (form GET) and the sort selector. URL query
 * parameters drive both the toolbar state and the page's data fetch,
 * so navigation history (back/forward, bookmarks, share) "just works".
 *
 * Submit re-routes to `${basePath}?...` with the new query and resets
 * `page=1` so the user lands on the first page of the new result set.
 */
export function ProductToolbar({ basePath, total }: ProductToolbarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialQuery = searchParams.get("q") ?? "";
  const initialSort =
    searchParams.get("sort") ?? (initialQuery ? "relevance" : "newest");

  const [query, setQuery] = React.useState(initialQuery);
  const [sort, setSort] = React.useState(initialSort);

  // Keep local form state in sync if the URL changes via Back/Forward
  // navigation or programmatic pushes from elsewhere on the page.
  React.useEffect(() => {
    setQuery(searchParams.get("q") ?? "");
    setSort(
      searchParams.get("sort") ??
        (searchParams.get("q") ? "relevance" : "newest"),
    );
  }, [searchParams]);

  function buildHref(nextQuery: string, nextSort: string): string {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    if (nextQuery.trim().length > 0) {
      params.set("q", nextQuery.trim());
    } else {
      params.delete("q");
    }
    params.set("sort", nextSort);
    const qs = params.toString();
    return qs.length > 0 ? `${basePath}?${qs}` : basePath;
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    router.push(buildHref(query, sort));
  }

  function onSortChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    setSort(next);
    router.push(buildHref(query, next));
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
        <Label htmlFor="product-sort" className="text-xs">
          Sort by
        </Label>
        <div className="flex items-center gap-3">
          <select
            id="product-sort"
            value={sort}
            onChange={onSortChange}
            className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="hidden whitespace-nowrap text-xs text-muted-foreground sm:inline">
            {total.toLocaleString()} {total === 1 ? "result" : "results"}
          </span>
        </div>
      </div>
    </div>
  );
}
