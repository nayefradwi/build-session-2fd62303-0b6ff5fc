/**
 * GET /api/products
 *
 * Browse / search / filter / sort the catalog.
 *
 * Query parameters (all optional):
 *   - q                full-text query against product name + description
 *   - category         category slug (repeatable, also accepts comma list)
 *   - priceMin         minimum price in CENTS (integer)
 *   - priceMax         maximum price in CENTS (integer)
 *   - size             repeatable, also accepts comma list
 *   - material         repeatable, also accepts comma list
 *   - color            repeatable, also accepts comma list
 *   - availability     in_stock | out_of_stock | all (default: all)
 *   - featured         "true" to limit to merchandised SKUs
 *   - new              "true" to limit to new arrivals
 *   - sort             price_asc | price_desc | newest | popularity
 *                      | rating | relevance (default: relevance if `q`,
 *                      otherwise newest)
 *   - page             1-indexed page number (default 1)
 *   - pageSize         items per page (default 24, max 100)
 *
 * Returns 200 with `{ items, page, pageSize, total, totalPages, hasMore, sort }`.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  VALID_AVAILABILITY,
  VALID_SORTS,
  listProducts,
  type AvailabilityFilter,
  type SortOption,
} from "@/lib/server/products";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ErrorBody {
  error: string;
  code: string;
  fieldErrors?: Record<string, string[]>;
}

function errorResponse(status: number, body: ErrorBody) {
  return NextResponse.json(body, { status });
}

/**
 * Pull a query parameter as a list. Accepts:
 *   ?size=S&size=M  → ["S", "M"]
 *   ?size=S,M       → ["S", "M"]
 */
function getList(params: URLSearchParams, key: string): string[] {
  const all = params.getAll(key);
  const out: string[] = [];
  for (const value of all) {
    for (const part of value.split(",")) {
      const trimmed = part.trim();
      if (trimmed.length > 0) out.push(trimmed);
    }
  }
  return out;
}

const intString = z
  .string()
  .regex(/^-?\d+$/, "Expected an integer")
  .transform((s) => parseInt(s, 10));

const querySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  priceMin: intString.optional(),
  priceMax: intString.optional(),
  availability: z.enum(VALID_AVAILABILITY as readonly [
    AvailabilityFilter,
    ...AvailabilityFilter[],
  ]).optional(),
  sort: z
    .enum(VALID_SORTS as readonly [SortOption, ...SortOption[]])
    .optional(),
  page: intString.optional(),
  pageSize: intString.optional(),
  featured: z.enum(["true", "false"]).optional(),
  new: z.enum(["true", "false"]).optional(),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const params = url.searchParams;

  const flat: Record<string, string> = {};
  for (const key of [
    "q",
    "priceMin",
    "priceMax",
    "availability",
    "sort",
    "page",
    "pageSize",
    "featured",
    "new",
  ]) {
    const v = params.get(key);
    if (v !== null) flat[key] = v;
  }

  const parsed = querySchema.safeParse(flat);
  if (!parsed.success) {
    return errorResponse(400, {
      error: "Invalid query parameters",
      code: "validation_failed",
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  const data = parsed.data;

  if (
    typeof data.priceMin === "number" &&
    typeof data.priceMax === "number" &&
    data.priceMin > data.priceMax
  ) {
    return errorResponse(400, {
      error: "priceMin must be less than or equal to priceMax",
      code: "invalid_price_range",
      fieldErrors: { priceMin: ["priceMin > priceMax"] },
    });
  }

  const sort: SortOption =
    data.sort ?? (data.q && data.q.length > 0 ? "relevance" : "newest");

  try {
    const result = await listProducts({
      page: data.page ?? 1,
      pageSize: data.pageSize ?? 24,
      sort,
      q: data.q,
      categorySlugs: getList(params, "category"),
      priceMinCents: data.priceMin,
      priceMaxCents: data.priceMax,
      sizes: getList(params, "size"),
      materials: getList(params, "material"),
      colors: getList(params, "color"),
      availability: data.availability,
      isFeatured: data.featured === "true" ? true : undefined,
      isNew: data.new === "true" ? true : undefined,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[GET /api/products] failed", err);
    return errorResponse(500, {
      error: "Failed to load products",
      code: "internal_error",
    });
  }
}
