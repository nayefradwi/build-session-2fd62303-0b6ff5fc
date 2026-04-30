import type { Metadata } from "next";
import Link from "next/link";
import { Search as SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ProductGrid } from "@/components/products/product-grid";
import { ProductPagination } from "@/components/products/product-pagination";
import { ProductToolbar } from "@/components/products/product-toolbar";
import { RecentSearches } from "@/components/site/recent-searches";
import { RecordRecentSearch } from "@/components/site/record-recent-search";
import {
  VALID_SORTS,
  listProducts,
  type SortOption,
} from "@/lib/server/products";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Search",
  description: "Search the catalog for products by name or description.",
};

const PAGE_SIZE = 24;

interface SearchPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function pickString(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[value.length - 1];
  return value;
}

function parseInteger(value: string | undefined): number | undefined {
  if (value == null) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseSort(value: string | undefined): SortOption {
  if (value && (VALID_SORTS as readonly string[]).includes(value)) {
    return value as SortOption;
  }
  return "relevance";
}

/**
 * /search — site-wide product search results.
 *
 * Driven entirely by the `q` URL param so results are bookmarkable
 * and shareable. Calls into the same `listProducts` helper that backs
 * GET /api/products (full-text search via Postgres tsvector — partial
 * stems like "leather" matching "leathers" / "leathered" come for
 * free), so search behaves identically here and on /products.
 *
 * States:
 *   - No `q`           → empty-state with a search prompt + recent
 *                        searches (rendered client-side from
 *                        localStorage; absent on first visit).
 *   - `q` + 0 hits     → "no results" empty state with helpful
 *                        suggestions and a link back to /products.
 *   - `q` + hits       → grid + sort + pagination, identical to
 *                        /products but scoped to the search.
 */
export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = (await searchParams) ?? {};
  const q = pickString(params.q)?.trim() || undefined;
  const sort = parseSort(pickString(params.sort));
  const page = parseInteger(pickString(params.page)) ?? 1;

  // Without a query there's no point hitting the database — render
  // the empty prompt + recents straight away.
  if (!q) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-10">
        <header className="mb-8 space-y-1">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Search
          </h1>
          <p className="text-sm text-muted-foreground">
            Find products by name, description, material, or color.
          </p>
        </header>

        <div className="rounded-lg border border-dashed bg-muted/20 p-10 text-center">
          <SearchIcon
            className="mx-auto mb-3 h-8 w-8 text-muted-foreground"
            aria-hidden="true"
          />
          <p className="text-sm font-medium">Start typing in the search bar above.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Or browse the{" "}
            <Link href="/products" className="font-medium underline-offset-4 hover:underline">
              full catalog
            </Link>
            .
          </p>
        </div>

        <div className="mt-8">
          <RecentSearches />
        </div>
      </main>
    );
  }

  let result;
  let loadError = false;
  try {
    result = await listProducts({
      page,
      pageSize: PAGE_SIZE,
      sort,
      q,
    });
  } catch (err) {
    console.error("[search] failed to load results", err);
    loadError = true;
    result = {
      items: [],
      page,
      pageSize: PAGE_SIZE,
      total: 0,
      totalPages: 0,
      hasMore: false,
      sort,
    };
  }

  // Forward the active query/sort across pagination so back/forward
  // and page-jump links keep the user on the same search.
  const carryParams = new URLSearchParams();
  carryParams.set("q", q);
  carryParams.set("sort", sort);

  const rangeStart =
    result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const rangeEnd = Math.min(result.page * result.pageSize, result.total);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-10">
      <header className="mb-6 space-y-1">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Search results
        </h1>
        <p className="text-sm text-muted-foreground">
          {result.total === 0 ? (
            <>No products match &ldquo;{q}&rdquo;.</>
          ) : (
            <>
              Showing {rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()} of{" "}
              {result.total.toLocaleString()}{" "}
              {result.total === 1 ? "result" : "results"} for{" "}
              <span className="font-medium text-foreground">&ldquo;{q}&rdquo;</span>
              .
            </>
          )}
        </p>
      </header>

      <div className="mb-6">
        <ProductToolbar basePath="/search" total={result.total} />
      </div>

      {loadError ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/50 bg-destructive/5 p-6 text-sm text-destructive"
        >
          We couldn&apos;t run that search right now. Please refresh the page
          or try again in a moment.
        </div>
      ) : result.total === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/20 p-10 text-center">
          <SearchIcon
            className="mx-auto mb-3 h-8 w-8 text-muted-foreground"
            aria-hidden="true"
          />
          <p className="text-base font-medium">
            We couldn&apos;t find anything for &ldquo;{q}&rdquo;.
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Double-check the spelling, try a more general term, or browse the
            full catalog.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/products">Browse all products</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/search">Clear search</Link>
            </Button>
          </div>
          <div className="mt-6">
            <RecentSearches title="Or try one of your recent searches" />
          </div>
        </div>
      ) : (
        <>
          <ProductGrid products={result.items} />
          {result.totalPages > 1 && (
            <div className="mt-8">
              <ProductPagination
                page={result.page}
                totalPages={result.totalPages}
                basePath="/search"
                searchString={carryParams.toString()}
              />
            </div>
          )}
        </>
      )}

      {/* Side-effect-only — pushes successful searches into recents. */}
      <RecordRecentSearch query={q} hadResults={result.total > 0} />
    </main>
  );
}
