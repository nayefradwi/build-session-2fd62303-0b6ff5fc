import type { Metadata } from "next";

import { InventoryList } from "@/components/admin/inventory-list";
import {
  INVENTORY_STATUS_FILTERS,
  type InventoryCategoryOption,
  type InventoryListResult,
  type InventoryStatusFilter,
} from "@/components/admin/inventory-types";
import { listCategories } from "@/lib/server/admin-categories";
import {
  getLowStockThreshold,
  listInventory,
} from "@/lib/server/inventory";

export const metadata: Metadata = {
  title: "Inventory",
  description:
    "Monitor stock, edit quantities, run bulk updates, and audit historical adjustments.",
};

export const dynamic = "force-dynamic";

interface InventoryPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pickString(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const raw = params[key];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function parseStatus(raw: string | undefined): InventoryStatusFilter {
  if (!raw) return "any";
  return (INVENTORY_STATUS_FILTERS as readonly string[]).includes(raw)
    ? (raw as InventoryStatusFilter)
    : "any";
}

function parsePage(raw: string | undefined): number {
  if (!raw) return 1;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

function parseCategoryId(raw: string | undefined): string {
  if (!raw) return "";
  return UUID_RE.test(raw) ? raw : "";
}

/**
 * Admin > Inventory list page.
 *
 * Server component — fetches the first page directly via the shared
 * service helper (the same code path the API route uses) so the initial
 * paint is fully populated. The categories roster powers the filter
 * select; subsequent filter / search / pagination interactions are
 * driven by the client component.
 */
export default async function AdminInventoryPage({
  searchParams,
}: InventoryPageProps) {
  const resolved = await searchParams;
  const q = pickString(resolved, "q") ?? "";
  const status = parseStatus(pickString(resolved, "status"));
  const categoryId = parseCategoryId(pickString(resolved, "category"));
  const page = parsePage(pickString(resolved, "page"));

  const [inventoryResult, categoriesResult, lowStockThreshold] =
    await Promise.all([
      listInventory({
        q: q.length > 0 ? q : undefined,
        status,
        categoryId: categoryId.length > 0 ? categoryId : undefined,
        page,
      }),
      listCategories(),
      getLowStockThreshold(),
    ]);

  const initialData: InventoryListResult = inventoryResult;

  const categoryOptions: InventoryCategoryOption[] =
    categoriesResult.items.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      parentId: c.parentId,
    }));

  return (
    <InventoryList
      initialData={initialData}
      initialQuery={q}
      initialStatus={status}
      initialCategoryId={categoryId}
      categories={categoryOptions}
      initialThreshold={lowStockThreshold}
    />
  );
}
