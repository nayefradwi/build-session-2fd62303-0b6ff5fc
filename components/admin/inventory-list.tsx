"use client";

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  ClipboardList,
  Download,
  History,
  Loader2,
  Pencil,
  Search,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  INVENTORY_STATUS_FILTERS,
  type AdjustmentsListResult,
  type BulkUpdateLine,
  type BulkUpdateResult,
  type InventoryApiError,
  type InventoryCategoryOption,
  type InventoryListResult,
  type InventoryRow,
  type InventoryStatusFilter,
  type PublicStockAdjustment,
} from "@/components/admin/inventory-types";
import { formatPrice } from "@/lib/client/format";

interface InventoryListProps {
  initialData: InventoryListResult;
  initialQuery: string;
  initialStatus: InventoryStatusFilter;
  initialCategoryId: string;
  categories: InventoryCategoryOption[];
  initialThreshold: number;
}

const STATUS_LABELS: Record<InventoryStatusFilter, string> = {
  any: "All stock",
  in: "In stock",
  out: "Out of stock",
  low: "Low stock",
};

/**
 * Build a `?q=…&status=…&category=…&page=…` query string for the URL we
 * want the page to live at. Empty values are dropped so the URL stays
 * clean for the unfiltered first page.
 */
function buildSearchString(
  q: string,
  status: InventoryStatusFilter,
  categoryId: string,
  page: number,
): string {
  const params = new URLSearchParams();
  if (q.trim().length > 0) params.set("q", q.trim());
  if (status !== "any") params.set("status", status);
  if (categoryId.length > 0) params.set("category", categoryId);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs.length === 0 ? "" : `?${qs}`;
}

function buildApiUrl(
  q: string,
  status: InventoryStatusFilter,
  categoryId: string,
  page: number,
): string {
  const params = new URLSearchParams();
  if (q.trim().length > 0) params.set("q", q.trim());
  if (status !== "any") params.set("status", status);
  if (categoryId.length > 0) params.set("categoryId", categoryId);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs.length === 0
    ? "/api/admin/inventory"
    : `/api/admin/inventory?${qs}`;
}

/** Best-effort error extractor: tolerates non-JSON 5xx bodies. */
async function readApiError(res: Response): Promise<InventoryApiError | null> {
  try {
    return (await res.json()) as InventoryApiError;
  } catch {
    return null;
  }
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  return String(delta);
}

interface InlineEditState {
  productId: string;
  draft: string;
  reason: string;
  saving: boolean;
}

interface HistoryState {
  product: InventoryRow;
  loading: boolean;
  data: AdjustmentsListResult | null;
  error: string | null;
}

interface BulkRowState {
  productId: string;
  name: string;
  sku: string;
  currentStock: number;
  draft: string;
}

interface BulkResultLine {
  productId: string;
  name: string;
  sku: string;
  ok: boolean;
  message: string;
}

/**
 * Admin > Inventory list. Owns:
 *
 *   - search / status / category filters with debounced refetch
 *   - inline stock edit (PATCH /api/admin/inventory/products/{id})
 *   - history modal (GET /api/admin/inventory/adjustments?productId=…)
 *   - bulk update modal: paste/upload a CSV (productId,stock[,reason])
 *     OR multi-row form, applied via POST /api/admin/inventory/bulk
 *   - low-stock threshold editor (PUT /api/admin/inventory/threshold)
 *   - CSV export of the current view
 */
export function InventoryList({
  initialData,
  initialQuery,
  initialStatus,
  initialCategoryId,
  categories,
  initialThreshold,
}: InventoryListProps) {
  const router = useRouter();
  const [data, setData] = React.useState<InventoryListResult>(initialData);
  const [query, setQuery] = React.useState(initialQuery);
  const [status, setStatus] =
    React.useState<InventoryStatusFilter>(initialStatus);
  const [categoryId, setCategoryId] = React.useState(initialCategoryId);
  const [loading, setLoading] = React.useState(false);
  const [threshold, setThreshold] = React.useState(initialThreshold);
  const [edit, setEdit] = React.useState<InlineEditState | null>(null);
  const [history, setHistory] = React.useState<HistoryState | null>(null);
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [thresholdOpen, setThresholdOpen] = React.useState(false);

  React.useEffect(() => setData(initialData), [initialData]);
  React.useEffect(() => setQuery(initialQuery), [initialQuery]);
  React.useEffect(() => setStatus(initialStatus), [initialStatus]);
  React.useEffect(
    () => setCategoryId(initialCategoryId),
    [initialCategoryId],
  );
  React.useEffect(() => setThreshold(initialThreshold), [initialThreshold]);

  /**
   * Fetch a fresh page from the API and update both the URL and the
   * local state.
   */
  const fetchPage = React.useCallback(
    async (
      nextQuery: string,
      nextStatus: InventoryStatusFilter,
      nextCategoryId: string,
      nextPage: number,
    ) => {
      setLoading(true);
      try {
        const res = await fetch(
          buildApiUrl(nextQuery, nextStatus, nextCategoryId, nextPage),
          {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store",
          },
        );

        if (!res.ok) {
          if (res.status === 401) {
            router.replace("/login?next=/admin/inventory");
            return;
          }
          if (res.status === 403) {
            toast.error("Admin access required", {
              description:
                "Your account doesn't have permission to view inventory.",
            });
            return;
          }
          const body = await readApiError(res);
          toast.error("Couldn't load inventory", {
            description:
              body?.error ?? "Something went wrong. Please try again.",
          });
          return;
        }

        let next: InventoryListResult;
        try {
          next = (await res.json()) as InventoryListResult;
        } catch {
          toast.error("Unexpected response", {
            description: "Could not parse the inventory list response.",
          });
          return;
        }

        setData(next);
        setThreshold(next.lowStockThreshold);
        const search = buildSearchString(
          nextQuery,
          nextStatus,
          nextCategoryId,
          nextPage,
        );
        router.replace(`/admin/inventory${search}`);
      } catch (err) {
        toast.error("Network error", {
          description:
            err instanceof Error
              ? err.message
              : "Could not reach the server. Please try again.",
        });
      } finally {
        setLoading(false);
      }
    },
    [router],
  );

  // Debounce search-box typing so we don't fire a request per keystroke.
  // Status / category / pagination changes trigger immediately via
  // explicit handlers below.
  React.useEffect(() => {
    if (
      query === initialQuery &&
      status === initialStatus &&
      categoryId === initialCategoryId
    ) {
      return;
    }
    const timer = setTimeout(() => {
      void fetchPage(query, status, categoryId, 1);
    }, 250);
    return () => clearTimeout(timer);
  }, [
    query,
    status,
    categoryId,
    initialQuery,
    initialStatus,
    initialCategoryId,
    fetchPage,
  ]);

  const goToPage = (page: number) => {
    void fetchPage(query, status, categoryId, page);
  };

  const refresh = React.useCallback(
    () => fetchPage(query, status, categoryId, data.page),
    [fetchPage, query, status, categoryId, data.page],
  );

  /* ------------------------------------------------------------------ */
  /* Inline edit                                                        */
  /* ------------------------------------------------------------------ */

  const startEdit = (row: InventoryRow) => {
    setEdit({
      productId: row.productId,
      draft: String(row.stock),
      reason: "",
      saving: false,
    });
  };

  const cancelEdit = () => setEdit(null);

  const saveEdit = async () => {
    if (!edit) return;
    const trimmed = edit.draft.trim();
    if (!/^\d+$/.test(trimmed)) {
      toast.error("Enter a non-negative whole number for stock");
      return;
    }
    const nextStock = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(nextStock) || nextStock < 0) {
      toast.error("Stock must be 0 or higher");
      return;
    }

    setEdit((prev) => (prev ? { ...prev, saving: true } : prev));
    try {
      const res = await fetch(
        `/api/admin/inventory/products/${edit.productId}`,
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stock: nextStock,
            reason: edit.reason.trim().length > 0 ? edit.reason.trim() : null,
          }),
        },
      );
      if (!res.ok) {
        if (res.status === 409) {
          toast.info("Stock is already at that value", {
            description: "No adjustment was logged.",
          });
          setEdit(null);
          return;
        }
        if (res.status === 401) {
          router.replace("/login?next=/admin/inventory");
          return;
        }
        if (res.status === 403) {
          toast.error("Admin access required");
          return;
        }
        const body = await readApiError(res);
        toast.error("Couldn't update stock", {
          description: body?.error ?? "Something went wrong. Please try again.",
        });
        return;
      }
      toast.success("Stock updated");
      setEdit(null);
      await refresh();
      // Storefront SSR pages may rely on stock — refresh server data.
      router.refresh();
    } catch (err) {
      toast.error("Network error", {
        description:
          err instanceof Error
            ? err.message
            : "Could not reach the server. Please try again.",
      });
    } finally {
      setEdit((prev) => (prev ? { ...prev, saving: false } : prev));
    }
  };

  /* ------------------------------------------------------------------ */
  /* History modal                                                      */
  /* ------------------------------------------------------------------ */

  const openHistory = async (row: InventoryRow) => {
    setHistory({ product: row, loading: true, data: null, error: null });
    try {
      const res = await fetch(
        `/api/admin/inventory/adjustments?productId=${row.productId}&pageSize=50`,
        {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
        },
      );
      if (!res.ok) {
        const body = await readApiError(res);
        setHistory({
          product: row,
          loading: false,
          data: null,
          error: body?.error ?? "Failed to load history",
        });
        return;
      }
      const json = (await res.json()) as AdjustmentsListResult;
      setHistory({ product: row, loading: false, data: json, error: null });
    } catch (err) {
      setHistory({
        product: row,
        loading: false,
        data: null,
        error: err instanceof Error ? err.message : "Network error",
      });
    }
  };

  const closeHistory = () => setHistory(null);

  /* ------------------------------------------------------------------ */
  /* CSV export of the current view                                     */
  /* ------------------------------------------------------------------ */

  const exportCsv = () => {
    if (data.items.length === 0) return;
    const header = [
      "productId",
      "sku",
      "name",
      "stock",
      "lowStock",
      "outOfStock",
      "lowStockThreshold",
    ].join(",");
    const rows = data.items.map((row) =>
      [
        row.productId,
        csvField(row.sku),
        csvField(row.name),
        String(row.stock),
        row.lowStock ? "true" : "false",
        row.outOfStock ? "true" : "false",
        String(row.lowStockThreshold),
      ].join(","),
    );
    const blob = new Blob([`${header}\n${rows.join("\n")}\n`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  /* ------------------------------------------------------------------ */
  /* Render                                                             */
  /* ------------------------------------------------------------------ */

  const isEmpty = data.items.length === 0;
  const showingFrom =
    data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
  const showingTo = Math.min(data.total, data.page * data.pageSize);

  return (
    <Card data-testid="admin-inventory-list">
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle className="text-xl">Inventory</CardTitle>
          <CardDescription>
            Track product stock, fix discrepancies inline, and run bulk
            updates from a CSV. Low-stock threshold:{" "}
            <button
              type="button"
              onClick={() => setThresholdOpen(true)}
              className="font-medium text-foreground underline-offset-2 hover:underline"
              data-testid="threshold-edit-trigger"
            >
              {threshold}
            </button>
            .
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={exportCsv}
            disabled={data.items.length === 0}
            data-testid="inventory-export-csv"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => setBulkOpen(true)}
            data-testid="inventory-bulk-trigger"
          >
            <Upload className="h-4 w-4" />
            Bulk update
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 md:grid-cols-[1fr_200px_200px] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="inventory-search" className="text-sm">
              Search
            </Label>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="inventory-search"
                type="search"
                placeholder="Search by name, SKU, or slug"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
                data-testid="inventory-search-input"
              />
              {query.length > 0 && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-xs text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inventory-status" className="text-sm">
              Stock status
            </Label>
            <select
              id="inventory-status"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as InventoryStatusFilter)
              }
              data-testid="inventory-status-select"
            >
              {INVENTORY_STATUS_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inventory-category" className="text-sm">
              Category
            </Label>
            <select
              id="inventory-category"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              data-testid="inventory-category-select"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading…
          </div>
        )}

        {isEmpty && !loading ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 p-8 text-center">
            <p className="text-sm font-medium">
              {query.trim().length > 0 ||
              status !== "any" ||
              categoryId.length > 0
                ? "No products match those filters"
                : "No products yet"}
            </p>
            <p className="text-sm text-muted-foreground">
              {query.trim().length > 0 ||
              status !== "any" ||
              categoryId.length > 0
                ? "Try clearing the search, status, or category filter."
                : "Create products in the catalog before tracking stock here."}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Product</th>
                    <th className="px-3 py-2 font-medium">SKU</th>
                    <th className="px-3 py-2 font-medium">Category</th>
                    <th className="px-3 py-2 font-medium">Price</th>
                    <th className="px-3 py-2 font-medium">Stock</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.items.map((row) => {
                    const isEditing = edit?.productId === row.productId;
                    return (
                      <tr
                        key={row.productId}
                        className="bg-card hover:bg-muted/30"
                        data-testid={`inventory-row-${row.productId}`}
                      >
                        <td className="px-3 py-2 align-top">
                          <div className="flex items-center gap-3">
                            <div className="relative h-12 w-12 flex-none overflow-hidden rounded border bg-muted">
                              {row.primaryImageUrl ? (
                                <Image
                                  src={row.primaryImageUrl}
                                  alt=""
                                  fill
                                  sizes="48px"
                                  className="object-cover"
                                  unoptimized
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-wide text-muted-foreground">
                                  No image
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate font-medium">
                                {row.name}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">
                                /{row.slug}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 align-top font-mono text-xs">
                          {row.sku}
                        </td>
                        <td className="px-3 py-2 align-top">
                          {row.category ? (
                            <span className="text-sm">
                              {row.category.name}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top whitespace-nowrap">
                          {formatPrice(row.priceCents, row.currency)}
                        </td>
                        <td
                          className="px-3 py-2 align-top whitespace-nowrap"
                          data-testid={`inventory-stock-${row.productId}`}
                        >
                          {isEditing ? (
                            <div className="flex flex-col gap-1.5">
                              <Input
                                value={edit!.draft}
                                onChange={(e) =>
                                  setEdit((prev) =>
                                    prev
                                      ? { ...prev, draft: e.target.value }
                                      : prev,
                                  )
                                }
                                inputMode="numeric"
                                pattern="\\d*"
                                className="h-8 w-24"
                                disabled={edit!.saving}
                                aria-label={`Stock for ${row.name}`}
                                data-testid={`inventory-stock-input-${row.productId}`}
                              />
                              <Input
                                value={edit!.reason}
                                onChange={(e) =>
                                  setEdit((prev) =>
                                    prev
                                      ? { ...prev, reason: e.target.value }
                                      : prev,
                                  )
                                }
                                placeholder="Reason (optional)"
                                className="h-8"
                                disabled={edit!.saving}
                                maxLength={500}
                              />
                            </div>
                          ) : (
                            <span className="font-medium">{row.stock}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="flex flex-wrap gap-1">
                            {row.outOfStock ? (
                              <Badge
                                variant="destructive"
                                data-testid={`inventory-badge-out-${row.productId}`}
                              >
                                Out of stock
                              </Badge>
                            ) : row.lowStock ? (
                              <Badge
                                variant="warning"
                                className="inline-flex items-center gap-1"
                                data-testid={`inventory-badge-low-${row.productId}`}
                              >
                                <AlertTriangle className="h-3 w-3" />
                                Low stock
                              </Badge>
                            ) : (
                              <Badge variant="success">In stock</Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 align-top text-right">
                          <div className="inline-flex flex-wrap justify-end gap-2">
                            {isEditing ? (
                              <>
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => void saveEdit()}
                                  disabled={edit!.saving}
                                  data-testid={`inventory-save-${row.productId}`}
                                >
                                  {edit!.saving ? (
                                    <>
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                      Saving…
                                    </>
                                  ) : (
                                    <>
                                      <Check className="h-4 w-4" />
                                      Save
                                    </>
                                  )}
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={cancelEdit}
                                  disabled={edit!.saving}
                                >
                                  <X className="h-4 w-4" />
                                  Cancel
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => startEdit(row)}
                                  aria-label={`Edit stock for ${row.name}`}
                                  data-testid={`inventory-edit-${row.productId}`}
                                >
                                  <Pencil className="h-4 w-4" />
                                  Edit
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => void openHistory(row)}
                                  aria-label={`History for ${row.name}`}
                                  data-testid={`inventory-history-${row.productId}`}
                                >
                                  <History className="h-4 w-4" />
                                  History
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>
                Showing {showingFrom}-{showingTo} of {data.total}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => goToPage(Math.max(1, data.page - 1))}
                  disabled={loading || data.page <= 1}
                >
                  Previous
                </Button>
                <span className="text-xs">
                  Page {data.page} of {Math.max(1, data.totalPages)}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => goToPage(data.page + 1)}
                  disabled={loading || !data.hasMore}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>

      <HistoryModal state={history} onClose={closeHistory} />

      <BulkUpdateModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        rows={data.items}
        onApplied={async () => {
          await refresh();
          router.refresh();
        }}
      />

      <ThresholdModal
        open={thresholdOpen}
        currentValue={threshold}
        onClose={() => setThresholdOpen(false)}
        onSaved={(value) => {
          setThreshold(value);
          void refresh();
        }}
      />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* History modal                                                      */
/* ------------------------------------------------------------------ */

function HistoryModal({
  state,
  onClose,
}: {
  state: HistoryState | null;
  onClose: () => void;
}) {
  const open = state !== null;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Stock history</DialogTitle>
          <DialogDescription>
            {state
              ? `${state.product.name} (${state.product.sku}) — current stock ${state.product.stock}.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto">
          {!state ? null : state.loading ? (
            <div className="flex items-center gap-2 px-1 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading adjustments…
            </div>
          ) : state.error ? (
            <p className="px-1 py-4 text-sm text-destructive">{state.error}</p>
          ) : state.data && state.data.items.length === 0 ? (
            <p className="px-1 py-4 text-sm text-muted-foreground">
              No adjustments recorded yet for this product.
            </p>
          ) : state.data ? (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">By</th>
                  <th className="px-3 py-2 font-medium">Δ</th>
                  <th className="px-3 py-2 font-medium">Before</th>
                  <th className="px-3 py-2 font-medium">After</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {state.data.items.map((adj: PublicStockAdjustment) => (
                  <tr key={adj.id}>
                    <td className="px-3 py-2 align-top whitespace-nowrap text-xs">
                      {formatDateTime(adj.createdAt)}
                    </td>
                    <td className="px-3 py-2 align-top text-xs">
                      {adj.userEmail ?? "—"}
                    </td>
                    <td
                      className={
                        "px-3 py-2 align-top whitespace-nowrap font-medium " +
                        (adj.delta > 0
                          ? "text-emerald-700 dark:text-emerald-300"
                          : adj.delta < 0
                            ? "text-destructive"
                            : "")
                      }
                    >
                      {formatDelta(adj.delta)}
                    </td>
                    <td className="px-3 py-2 align-top">{adj.previousStock}</td>
                    <td className="px-3 py-2 align-top">{adj.newStock}</td>
                    <td className="px-3 py-2 align-top text-xs">
                      {adj.reason ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Bulk-update modal                                                  */
/* ------------------------------------------------------------------ */

function BulkUpdateModal({
  open,
  onClose,
  rows,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  rows: InventoryRow[];
  onApplied: () => Promise<void> | void;
}) {
  const [mode, setMode] = React.useState<"multi" | "csv">("multi");
  const [csvText, setCsvText] = React.useState("");
  const [defaultReason, setDefaultReason] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [results, setResults] = React.useState<BulkResultLine[] | null>(null);
  const [editRows, setEditRows] = React.useState<BulkRowState[]>([]);

  // Re-seed the multi-edit table whenever the modal opens or the
  // visible rows change. Any draft edits get reset on close, which
  // matches user expectations for a transient modal.
  React.useEffect(() => {
    if (!open) return;
    setEditRows(
      rows.map((row) => ({
        productId: row.productId,
        name: row.name,
        sku: row.sku,
        currentStock: row.stock,
        draft: String(row.stock),
      })),
    );
    setResults(null);
    setCsvText("");
    setDefaultReason("");
  }, [open, rows]);

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const handleFile = async (file: File) => {
    try {
      const text = await file.text();
      setCsvText(text);
    } catch {
      toast.error("Could not read file");
    }
  };

  const collectUpdates = (): {
    updates: BulkUpdateLine[];
    parseErrors: BulkResultLine[];
  } => {
    if (mode === "multi") {
      const updates: BulkUpdateLine[] = [];
      for (const r of editRows) {
        const trimmed = r.draft.trim();
        if (trimmed.length === 0) continue;
        if (!/^\d+$/.test(trimmed)) continue;
        const next = Number.parseInt(trimmed, 10);
        if (!Number.isFinite(next) || next < 0) continue;
        if (next === r.currentStock) continue;
        updates.push({ productId: r.productId, stock: next });
      }
      return { updates, parseErrors: [] };
    }

    // CSV mode. Header is optional; we accept any of:
    //   productId,stock                (recommended)
    //   productId,stock,reason
    //   productId,delta
    //   productId,delta,reason
    // SKU is a fine alternative key for productId — we resolve it
    // against the visible rows. Anything we can't resolve becomes a
    // parse error rendered in the result list.
    const parseErrors: BulkResultLine[] = [];
    const updates: BulkUpdateLine[] = [];
    const skuToId = new Map<string, string>();
    const idSet = new Set<string>();
    for (const row of rows) {
      skuToId.set(row.sku.toLowerCase(), row.productId);
      idSet.add(row.productId);
    }

    const lines = csvText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) {
      return { updates, parseErrors };
    }

    let startIdx = 0;
    const headerCells = lines[0].split(",").map((c) => c.trim().toLowerCase());
    const isHeader =
      headerCells.includes("productid") ||
      headerCells.includes("sku") ||
      headerCells.includes("stock") ||
      headerCells.includes("delta");
    let columns: string[];
    if (isHeader) {
      columns = headerCells;
      startIdx = 1;
    } else {
      // Default schema when the CSV starts with data: productId,stock[,reason]
      columns = ["productid", "stock", "reason"];
    }

    const idIdx = columns.indexOf("productid");
    const skuIdx = columns.indexOf("sku");
    const stockIdx = columns.indexOf("stock");
    const deltaIdx = columns.indexOf("delta");
    const reasonIdx = columns.indexOf("reason");

    for (let i = startIdx; i < lines.length; i++) {
      const cells = parseCsvLine(lines[i]);
      const idCell = idIdx >= 0 ? cells[idIdx]?.trim() : "";
      const skuCell = skuIdx >= 0 ? cells[skuIdx]?.trim() : "";
      let resolvedId = idCell ?? "";
      if (!resolvedId && skuCell) {
        resolvedId = skuToId.get(skuCell.toLowerCase()) ?? "";
      }
      if (!resolvedId) {
        parseErrors.push({
          productId: "",
          name: skuCell || idCell || "(line " + (i + 1) + ")",
          sku: skuCell || "",
          ok: false,
          message:
            "Couldn't find a productId or matching SKU on line " + (i + 1),
        });
        continue;
      }
      const stockRaw = stockIdx >= 0 ? cells[stockIdx]?.trim() : "";
      const deltaRaw = deltaIdx >= 0 ? cells[deltaIdx]?.trim() : "";
      let stock: number | undefined;
      let delta: number | undefined;
      if (stockRaw && /^-?\d+$/.test(stockRaw)) {
        const v = Number.parseInt(stockRaw, 10);
        if (Number.isFinite(v) && v >= 0) stock = v;
      }
      if (deltaRaw && /^-?\d+$/.test(deltaRaw)) {
        const v = Number.parseInt(deltaRaw, 10);
        if (Number.isFinite(v)) delta = v;
      }
      if (stock === undefined && delta === undefined) {
        parseErrors.push({
          productId: resolvedId,
          name: skuCell || resolvedId,
          sku: skuCell || "",
          ok: false,
          message: "Line " + (i + 1) + " has no valid stock or delta",
        });
        continue;
      }
      const reason =
        reasonIdx >= 0 && cells[reasonIdx]
          ? cells[reasonIdx].trim() || undefined
          : undefined;
      updates.push({ productId: resolvedId, stock, delta, reason });
    }

    return { updates, parseErrors };
  };

  const apply = async () => {
    const { updates, parseErrors } = collectUpdates();
    if (updates.length === 0 && parseErrors.length === 0) {
      toast.info("Nothing to apply", {
        description: "Edit a stock value first or paste a CSV with changes.",
      });
      return;
    }

    setSubmitting(true);
    try {
      let lineResults: BulkResultLine[] = [...parseErrors];
      let applied = 0;
      let failed = parseErrors.length;
      if (updates.length > 0) {
        const res = await fetch("/api/admin/inventory/bulk", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            updates,
            defaultReason:
              defaultReason.trim().length > 0
                ? defaultReason.trim()
                : undefined,
          }),
        });
        if (!res.ok) {
          const body = await readApiError(res);
          toast.error("Bulk update failed", {
            description:
              body?.error ?? "Something went wrong. Please try again.",
          });
          return;
        }
        const json = (await res.json()) as BulkUpdateResult;
        applied = json.applied;
        failed += json.failed;
        const idToMeta = new Map<string, { name: string; sku: string }>();
        for (const r of rows) {
          idToMeta.set(r.productId, { name: r.name, sku: r.sku });
        }
        for (const line of json.results) {
          const meta = idToMeta.get(line.productId);
          lineResults.push({
            productId: line.productId,
            name: line.product?.name ?? meta?.name ?? line.productId,
            sku: line.product?.sku ?? meta?.sku ?? "",
            ok: line.ok,
            message: line.ok
              ? line.product
                ? "Stock now " + line.product.stock
                : "Updated"
              : line.error?.code === "no_change"
                ? "No change"
                : line.error?.code === "not_found"
                  ? "Not found"
                  : line.error?.message ?? "Failed",
          });
        }
      }
      setResults(lineResults);
      if (applied > 0) {
        toast.success(
          `Applied ${applied} update${applied === 1 ? "" : "s"}` +
            (failed > 0 ? `, ${failed} failed` : ""),
        );
        await onApplied();
      } else if (failed > 0) {
        toast.error("No updates were applied");
      }
    } catch (err) {
      toast.error("Network error", {
        description:
          err instanceof Error
            ? err.message
            : "Could not reach the server. Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Bulk update stock</DialogTitle>
          <DialogDescription>
            Edit the visible rows in place, or paste a CSV (columns:{" "}
            <code>productId,stock</code> or <code>sku,delta,reason</code>)
            and apply many changes at once. Up to 500 rows per call.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2" role="tablist" aria-label="Bulk update mode">
          <Button
            type="button"
            size="sm"
            variant={mode === "multi" ? "default" : "outline"}
            onClick={() => setMode("multi")}
            data-testid="bulk-mode-multi"
          >
            <ClipboardList className="h-4 w-4" />
            Multi-edit
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "csv" ? "default" : "outline"}
            onClick={() => setMode("csv")}
            data-testid="bulk-mode-csv"
          >
            <Upload className="h-4 w-4" />
            CSV
          </Button>
        </div>

        <div className="max-h-[50vh] overflow-auto rounded-md border">
          {mode === "multi" ? (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Product</th>
                  <th className="px-3 py-2 font-medium">SKU</th>
                  <th className="px-3 py-2 font-medium">Current</th>
                  <th className="px-3 py-2 font-medium">New</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {editRows.map((row, idx) => (
                  <tr key={row.productId}>
                    <td className="px-3 py-2 align-top">{row.name}</td>
                    <td className="px-3 py-2 align-top font-mono text-xs">
                      {row.sku}
                    </td>
                    <td className="px-3 py-2 align-top">{row.currentStock}</td>
                    <td className="px-3 py-2 align-top">
                      <Input
                        value={row.draft}
                        onChange={(e) => {
                          const next = e.target.value;
                          setEditRows((prev) => {
                            const copy = prev.slice();
                            copy[idx] = { ...copy[idx], draft: next };
                            return copy;
                          });
                        }}
                        inputMode="numeric"
                        className="h-8 w-24"
                        disabled={submitting}
                        aria-label={`New stock for ${row.name}`}
                        data-testid={`bulk-multi-input-${row.productId}`}
                      />
                    </td>
                  </tr>
                ))}
                {editRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-6 text-center text-sm text-muted-foreground"
                    >
                      No rows on this page. Adjust filters and try again.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <div className="space-y-3 p-3">
              <Label
                htmlFor="bulk-csv-textarea"
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                Paste CSV
              </Label>
              <textarea
                id="bulk-csv-textarea"
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                className="min-h-[12rem] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder={`productId,stock,reason\n00000000-0000-0000-0000-000000000000,42,restock`}
                spellCheck={false}
                disabled={submitting}
                data-testid="bulk-csv-textarea"
              />
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <Label
                  htmlFor="bulk-csv-file"
                  className="cursor-pointer rounded-md border border-input bg-background px-3 py-1.5 hover:bg-muted"
                >
                  <input
                    id="bulk-csv-file"
                    type="file"
                    accept=".csv,text/csv"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleFile(file);
                    }}
                    disabled={submitting}
                  />
                  Upload .csv
                </Label>
                <span className="text-muted-foreground">
                  Headers optional. Allowed columns: productId, sku, stock,
                  delta, reason.
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor="bulk-default-reason"
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Default reason (optional)
          </Label>
          <Input
            id="bulk-default-reason"
            value={defaultReason}
            onChange={(e) => setDefaultReason(e.target.value)}
            placeholder="Used when a line doesn't carry its own reason"
            disabled={submitting}
            maxLength={500}
          />
        </div>

        {results && results.length > 0 && (
          <div className="max-h-48 overflow-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-left uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Product</th>
                  <th className="px-3 py-2 font-medium">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {results.map((line, i) => (
                  <tr key={`${line.productId}-${i}`}>
                    <td className="px-3 py-2">
                      <span
                        className={
                          "mr-2 inline-block h-2 w-2 rounded-full " +
                          (line.ok ? "bg-emerald-500" : "bg-destructive")
                        }
                        aria-hidden="true"
                      />
                      {line.name || line.productId || "(unknown)"}
                    </td>
                    <td className="px-3 py-2">{line.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={handleClose}
            disabled={submitting}
          >
            Close
          </Button>
          <Button
            type="button"
            onClick={() => void apply()}
            disabled={submitting}
            data-testid="bulk-apply-button"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Applying…
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                Apply updates
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Threshold modal                                                    */
/* ------------------------------------------------------------------ */

function ThresholdModal({
  open,
  onClose,
  currentValue,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  currentValue: number;
  onSaved: (value: number) => void;
}) {
  const [draft, setDraft] = React.useState(String(currentValue));
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) setDraft(String(currentValue));
  }, [open, currentValue]);

  const save = async () => {
    const trimmed = draft.trim();
    if (!/^\d+$/.test(trimmed)) {
      toast.error("Threshold must be a non-negative integer");
      return;
    }
    const value = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(value) || value < 0) {
      toast.error("Threshold must be 0 or higher");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/inventory/threshold", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) {
        const body = await readApiError(res);
        toast.error("Couldn't save threshold", {
          description:
            body?.error ?? "Something went wrong. Please try again.",
        });
        return;
      }
      const json = (await res.json()) as { value: number };
      toast.success(`Low-stock threshold set to ${json.value}`);
      onSaved(json.value);
      onClose();
    } catch (err) {
      toast.error("Network error", {
        description:
          err instanceof Error
            ? err.message
            : "Could not reach the server. Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Low-stock threshold</DialogTitle>
          <DialogDescription>
            Products at or below this stock level are flagged as low-stock
            in the table.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="threshold-input">Threshold</Label>
          <Input
            id="threshold-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            inputMode="numeric"
            disabled={saving}
            data-testid="threshold-input"
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            data-testid="threshold-save"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Quote a CSV cell. Wraps in double-quotes whenever the value contains
 *  a comma, quote, or newline. */
function csvField(raw: string): string {
  if (raw.includes(",") || raw.includes('"') || raw.includes("\n")) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

/** Minimal CSV row parser — supports double-quoted cells with embedded
 *  commas and escaped quotes. Good enough for admin-entered CSVs. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === ",") {
      out.push(cell);
      cell = "";
    } else if (ch === '"' && cell.length === 0) {
      inQuotes = true;
    } else {
      cell += ch;
    }
  }
  out.push(cell);
  return out;
}
