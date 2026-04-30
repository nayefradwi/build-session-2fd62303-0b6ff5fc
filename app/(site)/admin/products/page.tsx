import type { Metadata } from "next";

import { ProductsList } from "@/components/admin/products-list";
import {
  ADMIN_PRODUCT_FLAG_FILTERS,
  type AdminProduct,
  type AdminProductCategoryOption,
  type AdminProductFlagFilter,
  type AdminProductListResult,
} from "@/components/admin/product-types";
import { listAdminProducts } from "@/lib/server/admin-products";
import { listCategories } from "@/lib/server/admin-categories";

export const metadata: Metadata = {
  title: "Products",
  description:
    "Search the catalog, edit product attributes, and manage merchandising flags.",
};

export const dynamic = "force-dynamic";

interface ProductsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function pickString(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const raw = params[key];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function parseFlag(raw: string | undefined): AdminProductFlagFilter {
  if (!raw) return "all";
  return (ADMIN_PRODUCT_FLAG_FILTERS as readonly string[]).includes(raw)
    ? (raw as AdminProductFlagFilter)
    : "all";
}

function parsePage(raw: string | undefined): number {
  if (!raw) return 1;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseCategoryId(raw: string | undefined): string {
  if (!raw) return "";
  return UUID_RE.test(raw) ? raw : "";
}

/**
 * Admin > Products list page.
 *
 * Server component — fetches the first page directly via the shared
 * helper (the same code path the API route uses) and seeds the client
 * list, plus a fresh categories roster for the filter / form selects.
 */
export default async function AdminProductsPage({
  searchParams,
}: ProductsPageProps) {
  const resolved = await searchParams;
  const q = pickString(resolved, "q") ?? "";
  const flag = parseFlag(pickString(resolved, "flag"));
  const categoryId = parseCategoryId(pickString(resolved, "category"));
  const page = parsePage(pickString(resolved, "page"));

  const [productsResult, categoriesResult] = await Promise.all([
    listAdminProducts({
      q: q.length > 0 ? q : undefined,
      isFeatured: flag === "featured" ? true : undefined,
      isNew: flag === "new" ? true : undefined,
      categoryId: categoryId.length > 0 ? categoryId : undefined,
      page,
    }),
    listCategories(),
  ]);

  // Filter out-of-stock client-side hint at SSR too so the first paint
  // matches the post-fetch view when ?flag=out_of_stock is in the URL.
  const items: AdminProduct[] =
    flag === "out_of_stock"
      ? productsResult.items.filter((p) => p.stock <= 0)
      : productsResult.items;

  const initialData: AdminProductListResult = {
    ...productsResult,
    items,
  };

  const categoryOptions: AdminProductCategoryOption[] =
    categoriesResult.items.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      parentId: c.parentId,
    }));

  return (
    <ProductsList
      initialData={initialData}
      initialQuery={q}
      initialFlag={flag}
      initialCategoryId={categoryId}
      categories={categoryOptions}
    />
  );
}
