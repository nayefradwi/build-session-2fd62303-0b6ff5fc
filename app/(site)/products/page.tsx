import type { Metadata } from "next";

import { ProductGrid } from "@/components/products/product-grid";
import { ProductPagination } from "@/components/products/product-pagination";
import { ProductToolbar } from "@/components/products/product-toolbar";
import {
  VALID_AVAILABILITY,
  VALID_SORTS,
  listProducts,
  type AvailabilityFilter,
  type SortOption,
} from "@/lib/server/products";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Products",
  description: "Browse the full catalog of products.",
};

const PAGE_SIZE = 24;

interface ProductsPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Coerce a single-or-array search param into a single string. Next 15
 * passes repeated query params as `string[]`; we always want the last
 * occurrence so the most recent submission wins (browser-default
 * behaviour for form GET).
 */
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

function parseSort(
  value: string | undefined,
  hasQuery: boolean,
): SortOption {
  if (value && (VALID_SORTS as readonly string[]).includes(value)) {
    return value as SortOption;
  }
  return hasQuery ? "relevance" : "newest";
}

function parseAvailability(
  value: string | undefined,
): AvailabilityFilter | undefined {
  if (value && (VALID_AVAILABILITY as readonly string[]).includes(value)) {
    return value as AvailabilityFilter;
  }
  return undefined;
}

/**
 * /products — paginated, searchable product listing.
 *
 * The URL is the source of truth: search query, sort, page, and the
 * featured/new merchandising flags all live in `searchParams`. The
 * server fetches via `listProducts` (the shared helper that backs
 * GET /api/products), so the API and the SSR view never drift.
 *
 * Layout is mobile-first: 2 columns on phones, 3 on tablets, 4 on
 * desktops (handled by `<ProductGrid />`).
 */
export default async function ProductsListingPage({
  searchParams,
}: ProductsPageProps) {
  const params = (await searchParams) ?? {};

  const q = pickString(params.q)?.trim() || undefined;
  const sort = parseSort(pickString(params.sort), Boolean(q));
  const page = parseInteger(pickString(params.page)) ?? 1;
  const featured = pickString(params.featured) === "true" ? true : undefined;
  const isNew = pickString(params.new) === "true" ? true : undefined;
  const availability = parseAvailability(pickString(params.availability));

  let result;
  let loadError = false;
  try {
    result = await listProducts({
      page,
      pageSize: PAGE_SIZE,
      sort,
      q,
      isFeatured: featured,
      isNew,
      availability,
    });
  } catch (err) {
    console.error("[products] failed to load listing", err);
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

  // Heading and intro copy adapt to which slice of the catalog the
  // user landed on (e.g. /products?featured=true → "Featured products").
  const headlineParts: string[] = [];
  if (featured) headlineParts.push("Featured");
  if (isNew) headlineParts.push("New");
  const headline =
    headlineParts.length > 0
      ? `${headlineParts.join(" · ")} products`
      : "All products";

  // Reassemble the search string the toolbar / pagination should
  // forward, keeping the listing's filters intact across page
  // navigation. We do NOT include `page` here — the paginator manages
  // that itself.
  const carryParams = new URLSearchParams();
  if (q) carryParams.set("q", q);
  carryParams.set("sort", sort);
  if (featured) carryParams.set("featured", "true");
  if (isNew) carryParams.set("new", "true");
  if (availability) carryParams.set("availability", availability);

  const rangeStart =
    result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const rangeEnd = Math.min(result.page * result.pageSize, result.total);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-10">
      <header className="mb-6 space-y-1">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          {headline}
        </h1>
        <p className="text-sm text-muted-foreground">
          {result.total === 0
            ? "No products match your filters yet."
            : `Showing ${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()} of ${result.total.toLocaleString()} ${result.total === 1 ? "product" : "products"}.`}
        </p>
      </header>

      <div className="mb-6">
        <ProductToolbar basePath="/products" total={result.total} />
      </div>

      {loadError ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/50 bg-destructive/5 p-6 text-sm text-destructive"
        >
          We couldn&apos;t load products right now. Please refresh the page or
          try again in a moment.
        </div>
      ) : (
        <ProductGrid
          products={result.items}
          emptyMessage={
            q
              ? `No products match "${q}". Try a different search.`
              : "No products found. Try removing some filters."
          }
        />
      )}

      {result.total > 0 && (
        <div className="mt-8">
          <ProductPagination
            page={result.page}
            totalPages={result.totalPages}
            basePath="/products"
            searchString={carryParams.toString()}
          />
        </div>
      )}
    </main>
  );
}
