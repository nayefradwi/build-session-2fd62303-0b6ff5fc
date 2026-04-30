import type { Metadata } from "next";

import { ProductFilterChips } from "@/components/products/product-filter-chips";
import { ProductFilters } from "@/components/products/product-filters";
import { ProductGrid } from "@/components/products/product-grid";
import { ProductPagination } from "@/components/products/product-pagination";
import { ProductToolbar } from "@/components/products/product-toolbar";
import {
  ALL_SIZES,
  COLOR_OPTIONS,
  MATERIAL_OPTIONS,
} from "@/lib/client/product-filter-options";
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

/**
 * Coerce a repeatable param into a flat string array. Accepts both
 * `?size=S&size=M` and `?size=S,M` shapes (matching the API contract
 * in `/api/products`).
 */
function pickList(
  value: string | string[] | undefined,
): string[] {
  if (value == null) return [];
  const all = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const entry of all) {
    for (const part of entry.split(",")) {
      const trimmed = part.trim();
      if (trimmed.length > 0) out.push(trimmed);
    }
  }
  // De-dupe while preserving order.
  return Array.from(new Set(out));
}

function parseInteger(value: string | undefined): number | undefined {
  if (value == null) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseNonNegativeInteger(value: string | undefined): number | undefined {
  if (value == null) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
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
 * /products — paginated, searchable, filterable product listing.
 *
 * The URL is the source of truth: search query, sort, page, the
 * featured/new merchandising flags AND every filter facet (price
 * range, size, material, color, availability) live in `searchParams`.
 * The server fetches via `listProducts` (the shared helper that backs
 * GET /api/products), so the API and the SSR view never drift.
 *
 * Layout:
 *   - Mobile/tablet: filter trigger button opens a slide-in drawer
 *   - Desktop (lg+): filters render inline as a left rail
 *   - Grid stays responsive: 2 cols on phones, 3 on tablets, 4 on
 *     desktops (the sidebar takes ~260px so card sizing still works)
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

  // Whitelist filter values against the known facet vocabulary so a
  // bookmarked URL with a stale or junk value doesn't leak into the
  // query (and so the UI's chip bar stays in sync with what's actually
  // applied).
  const validSizes = new Set<string>(ALL_SIZES);
  const validMaterials = new Set<string>(MATERIAL_OPTIONS);
  const validColors = new Set<string>(COLOR_OPTIONS.map((c) => c.name));

  const sizes = pickList(params.size).filter((v) => validSizes.has(v));
  const materials = pickList(params.material).filter((v) =>
    validMaterials.has(v),
  );
  const colors = pickList(params.color).filter((v) => validColors.has(v));

  const priceMinCents = parseNonNegativeInteger(pickString(params.priceMin));
  const priceMaxCents = parseNonNegativeInteger(pickString(params.priceMax));

  // Skip swapped ranges silently — the chip/panel UI will still show
  // both values and the user can correct them. The API path returns a
  // 400 in this case but we'd rather not fail the page render.
  const safePriceMin =
    priceMinCents != null &&
    priceMaxCents != null &&
    priceMinCents > priceMaxCents
      ? undefined
      : priceMinCents;
  const safePriceMax =
    priceMinCents != null &&
    priceMaxCents != null &&
    priceMinCents > priceMaxCents
      ? undefined
      : priceMaxCents;

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
      sizes: sizes.length > 0 ? sizes : undefined,
      materials: materials.length > 0 ? materials : undefined,
      colors: colors.length > 0 ? colors : undefined,
      priceMinCents: safePriceMin,
      priceMaxCents: safePriceMax,
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
  if (safePriceMin != null) carryParams.set("priceMin", String(safePriceMin));
  if (safePriceMax != null) carryParams.set("priceMax", String(safePriceMax));
  for (const size of sizes) carryParams.append("size", size);
  for (const material of materials) carryParams.append("material", material);
  for (const color of colors) carryParams.append("color", color);

  const rangeStart =
    result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const rangeEnd = Math.min(result.page * result.pageSize, result.total);

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:py-10">
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

      <div className="mb-4">
        <ProductToolbar basePath="/products" total={result.total} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <ProductFilters basePath="/products" />

        <div className="min-w-0 space-y-4">
          <ProductFilterChips basePath="/products" total={result.total} />

          {loadError ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/50 bg-destructive/5 p-6 text-sm text-destructive"
            >
              We couldn&apos;t load products right now. Please refresh the page
              or try again in a moment.
            </div>
          ) : (
            <ProductGrid
              products={result.items}
              emptyMessage={
                q
                  ? `No products match "${q}". Try a different search.`
                  : "No products match your filters. Try removing one to see more."
              }
            />
          )}

          {result.total > 0 && (
            <div className="pt-4">
              <ProductPagination
                page={result.page}
                totalPages={result.totalPages}
                basePath="/products"
                searchString={carryParams.toString()}
              />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
