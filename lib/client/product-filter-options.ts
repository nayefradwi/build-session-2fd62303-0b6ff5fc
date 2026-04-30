/**
 * Static facet option lists for the /products filter UI.
 *
 * The catalog seed uses a fixed vocabulary of sizes, materials, and
 * colors (see `lib/db/seed.ts`). Mirroring that vocabulary client-side
 * lets the filter panel render every realistic facet without an extra
 * round-trip to the API for distinct values. If the backend ever
 * introduces a "facet counts" endpoint, this file is the only place we
 * need to swap.
 *
 * The lists are intentionally `as const` so consumers get strict union
 * types where useful (e.g. for active-chip lookups by value).
 */

/** Apparel sizes (XS–XXL) used by tops/bottoms/outerwear. */
export const APPAREL_SIZES = [
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "XXL",
] as const;

/** Numeric shoe sizes used by footwear SKUs. */
export const SHOE_SIZES = ["7", "8", "9", "10", "11", "12"] as const;

/** Catch-all for accessories with no size variation. */
export const ONE_SIZE = ["One Size"] as const;

/**
 * Grouped size options shown as a single facet in the filter panel.
 * Groups keep apparel / shoe / one-size visually separated without
 * forcing the user to switch tabs.
 */
export const SIZE_GROUPS: ReadonlyArray<{
  label: string;
  options: readonly string[];
}> = [
  { label: "Apparel", options: APPAREL_SIZES },
  { label: "Footwear", options: SHOE_SIZES },
  { label: "Accessories", options: ONE_SIZE },
];

/** Flat list of every valid size value (used to validate URL params). */
export const ALL_SIZES: readonly string[] = [
  ...APPAREL_SIZES,
  ...SHOE_SIZES,
  ...ONE_SIZE,
];

export const MATERIAL_OPTIONS: readonly string[] = [
  "Cotton",
  "Linen",
  "Wool",
  "Leather",
  "Denim",
  "Polyester",
  "Recycled Polyester",
  "Cashmere",
  "Canvas",
  "Suede",
] as const;

/**
 * Color options paired with a CSS-friendly swatch. The hex codes are
 * approximations chosen so the swatch reads correctly on light or dark
 * backgrounds — they are not used anywhere else in the catalog.
 */
export const COLOR_OPTIONS: ReadonlyArray<{
  name: string;
  swatch: string;
}> = [
  { name: "Black", swatch: "#111111" },
  { name: "White", swatch: "#f5f5f5" },
  { name: "Charcoal", swatch: "#3a3a3a" },
  { name: "Heather Grey", swatch: "#9aa0a6" },
  { name: "Navy", swatch: "#1f2a44" },
  { name: "Olive", swatch: "#5b6e3b" },
  { name: "Sand", swatch: "#d8c79b" },
  { name: "Burgundy", swatch: "#6e1f2e" },
  { name: "Rust", swatch: "#a3502a" },
  { name: "Cream", swatch: "#f1e7d0" },
  { name: "Forest", swatch: "#2c4a35" },
  { name: "Cobalt", swatch: "#1f4fa3" },
];

/**
 * Default price-range bounds used to seed the slider/inputs when the
 * URL has no `priceMin`/`priceMax` set. Values are in CENTS (matching
 * the API contract). The seed catalog tops out below $400, so $500
 * gives a comfortable headroom without making the slider feel sparse.
 */
export const PRICE_RANGE_DEFAULT_MIN_CENTS = 0;
export const PRICE_RANGE_DEFAULT_MAX_CENTS = 50_000;
/** Slider step in cents — $5 keeps the handle responsive without overshooting. */
export const PRICE_RANGE_STEP_CENTS = 500;

/**
 * Parsed view of the filter portion of the /products URL. Used by both
 * the filter panel and the applied-chip bar so they stay in lockstep
 * with the listing's data fetch.
 */
export interface ParsedProductFilters {
  priceMinCents: number | null;
  priceMaxCents: number | null;
  sizes: string[];
  materials: string[];
  colors: string[];
  inStockOnly: boolean;
}

/** Pull a multi-value query param ("?size=S&size=M" or "?size=S,M"). */
function readListParam(
  searchParams: URLSearchParams,
  key: string,
): string[] {
  const values = searchParams.getAll(key);
  const out: string[] = [];
  for (const value of values) {
    for (const part of value.split(",")) {
      const trimmed = part.trim();
      if (trimmed.length > 0) out.push(trimmed);
    }
  }
  // Preserve insertion order while dropping duplicates.
  return Array.from(new Set(out));
}

function readIntParam(
  searchParams: URLSearchParams,
  key: string,
): number | null {
  const raw = searchParams.get(key);
  if (raw == null) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Read every filter param the listing UI cares about into one
 * structure. Unknown values are coerced or dropped — the caller can
 * trust the result shape.
 */
export function parseProductFilters(
  searchParams: URLSearchParams,
): ParsedProductFilters {
  const validSizes = new Set<string>(ALL_SIZES);
  const validMaterials = new Set<string>(MATERIAL_OPTIONS);
  const validColors = new Set<string>(COLOR_OPTIONS.map((c) => c.name));

  return {
    priceMinCents: readIntParam(searchParams, "priceMin"),
    priceMaxCents: readIntParam(searchParams, "priceMax"),
    sizes: readListParam(searchParams, "size").filter((v) =>
      validSizes.has(v),
    ),
    materials: readListParam(searchParams, "material").filter((v) =>
      validMaterials.has(v),
    ),
    colors: readListParam(searchParams, "color").filter((v) =>
      validColors.has(v),
    ),
    inStockOnly: searchParams.get("availability") === "in_stock",
  };
}

/** Total count of active filter "tokens" — used for the chip count badge. */
export function countActiveFilters(filters: ParsedProductFilters): number {
  return (
    (filters.priceMinCents != null ? 1 : 0) +
    (filters.priceMaxCents != null ? 1 : 0) +
    filters.sizes.length +
    filters.materials.length +
    filters.colors.length +
    (filters.inStockOnly ? 1 : 0)
  );
}

/**
 * Apply the supplied filters to a copy of `base`, returning a new
 * URLSearchParams ready to stringify. Resets pagination so the user
 * lands on page 1 of the new result set.
 *
 * Pass `null` for any field to clear it.
 */
export function applyFiltersToParams(
  base: URLSearchParams,
  filters: ParsedProductFilters,
): URLSearchParams {
  const next = new URLSearchParams(base.toString());

  // Reset every key we manage so we never carry stale values.
  next.delete("priceMin");
  next.delete("priceMax");
  next.delete("size");
  next.delete("material");
  next.delete("color");
  next.delete("availability");
  next.delete("page");

  if (filters.priceMinCents != null) {
    next.set("priceMin", String(filters.priceMinCents));
  }
  if (filters.priceMaxCents != null) {
    next.set("priceMax", String(filters.priceMaxCents));
  }
  for (const size of filters.sizes) {
    next.append("size", size);
  }
  for (const material of filters.materials) {
    next.append("material", material);
  }
  for (const color of filters.colors) {
    next.append("color", color);
  }
  if (filters.inStockOnly) {
    next.set("availability", "in_stock");
  }
  return next;
}

/**
 * Build a "cleared" filter state — used by the panel's reset button and
 * the chip bar's clear-all action.
 */
export function emptyFilters(): ParsedProductFilters {
  return {
    priceMinCents: null,
    priceMaxCents: null,
    sizes: [],
    materials: [],
    colors: [],
    inStockOnly: false,
  };
}
