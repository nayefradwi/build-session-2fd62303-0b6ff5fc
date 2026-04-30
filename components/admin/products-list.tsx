"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";
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
  ADMIN_PRODUCT_FLAG_FILTERS,
  type AdminProduct,
  type AdminProductApiError,
  type AdminProductCategoryOption,
  type AdminProductFlagFilter,
  type AdminProductListResult,
} from "@/components/admin/product-types";
import { formatPrice } from "@/lib/client/format";

interface ProductsListProps {
  initialData: AdminProductListResult;
  initialQuery: string;
  initialFlag: AdminProductFlagFilter;
  initialCategoryId: string;
  categories: AdminProductCategoryOption[];
}

const FLAG_LABELS: Record<AdminProductFlagFilter, string> = {
  all: "All",
  featured: "Featured",
  new: "New arrivals",
  out_of_stock: "Out of stock",
};

interface DeleteState {
  kind: "open";
  row: AdminProduct;
}

/**
 * Build a `?q=…&flag=…&category=…&page=…` query string for the URL we want
 * the page to live at while honouring the active filters / search / page.
 * Empty values are dropped so the URL stays clean.
 */
function buildSearchString(
  q: string,
  flag: AdminProductFlagFilter,
  categoryId: string,
  page: number,
): string {
  const params = new URLSearchParams();
  if (q.trim().length > 0) params.set("q", q.trim());
  if (flag !== "all") params.set("flag", flag);
  if (categoryId.length > 0) params.set("category", categoryId);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs.length === 0 ? "" : `?${qs}`;
}

function buildApiUrl(
  q: string,
  flag: AdminProductFlagFilter,
  categoryId: string,
  page: number,
): string {
  const params = new URLSearchParams();
  if (q.trim().length > 0) params.set("q", q.trim());
  if (flag === "featured") params.set("featured", "true");
  if (flag === "new") params.set("new", "true");
  if (categoryId.length > 0) params.set("categoryId", categoryId);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs.length === 0
    ? "/api/admin/products"
    : `/api/admin/products?${qs}`;
}

/**
 * Admin products list. Owns search, flag/category filters, the delete
 * confirmation dialog, and the refresh path (which also calls
 * `router.refresh()` so the storefront's server-rendered pages pick up
 * any edits on the next paint).
 *
 * The server component renders the first page and seeds this component
 * via `initialData`. Subsequent filter / search / pagination interactions
 * update the URL (so the page is bookmarkable) and refetch from the API.
 */
export function ProductsList({
  initialData,
  initialQuery,
  initialFlag,
  initialCategoryId,
  categories,
}: ProductsListProps) {
  const router = useRouter();
  const [data, setData] = React.useState<AdminProductListResult>(initialData);
  const [query, setQuery] = React.useState(initialQuery);
  const [flag, setFlag] = React.useState<AdminProductFlagFilter>(initialFlag);
  const [categoryId, setCategoryId] = React.useState(initialCategoryId);
  const [loading, setLoading] = React.useState(false);
  const [deleteState, setDeleteState] = React.useState<DeleteState | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  React.useEffect(() => {
    setData(initialData);
  }, [initialData]);
  React.useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);
  React.useEffect(() => {
    setFlag(initialFlag);
  }, [initialFlag]);
  React.useEffect(() => {
    setCategoryId(initialCategoryId);
  }, [initialCategoryId]);

  /**
   * Fetch a fresh page from the API and update both the URL and the
   * local state.
   */
  const fetchPage = React.useCallback(
    async (
      nextQuery: string,
      nextFlag: AdminProductFlagFilter,
      nextCategoryId: string,
      nextPage: number,
    ) => {
      setLoading(true);
      try {
        const res = await fetch(
          buildApiUrl(nextQuery, nextFlag, nextCategoryId, nextPage),
          {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store",
          },
        );

        if (!res.ok) {
          if (res.status === 401) {
            router.replace("/login?next=/admin/products");
            return;
          }
          if (res.status === 403) {
            toast.error("Admin access required", {
              description:
                "Your account doesn't have permission to manage products.",
            });
            return;
          }
          let body: AdminProductApiError | null = null;
          try {
            body = (await res.json()) as AdminProductApiError;
          } catch {
            // not JSON
          }
          toast.error("Couldn't load products", {
            description:
              body?.error ?? "Something went wrong. Please try again.",
          });
          return;
        }

        let next: AdminProductListResult;
        try {
          next = (await res.json()) as AdminProductListResult;
        } catch {
          toast.error("Unexpected response", {
            description: "Could not parse the products list response.",
          });
          return;
        }

        // Filter client-side for "out of stock" because the API doesn't
        // expose a dedicated query param. Filtering after fetch is fine
        // for the admin's small page size; the rest of the filters are
        // server-side.
        if (nextFlag === "out_of_stock") {
          next = {
            ...next,
            items: next.items.filter((p) => p.stock <= 0),
          };
        }

        setData(next);
        const search = buildSearchString(
          nextQuery,
          nextFlag,
          nextCategoryId,
          nextPage,
        );
        router.replace(`/admin/products${search}`);
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
      flag === initialFlag &&
      categoryId === initialCategoryId
    ) {
      return;
    }
    const timer = setTimeout(() => {
      void fetchPage(query, flag, categoryId, 1);
    }, 250);
    return () => clearTimeout(timer);
  }, [
    query,
    flag,
    categoryId,
    initialQuery,
    initialFlag,
    initialCategoryId,
    fetchPage,
  ]);

  const handleClearSearch = () => setQuery("");
  const goToPage = (page: number) => {
    void fetchPage(query, flag, categoryId, page);
  };

  const requestDelete = (row: AdminProduct) =>
    setDeleteState({ kind: "open", row });

  const confirmDelete = async () => {
    if (!deleteState) return;
    const { row } = deleteState;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/products/${row.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        if (res.status === 401) {
          router.replace("/login?next=/admin/products");
          return;
        }
        if (res.status === 403) {
          toast.error("Admin access required", {
            description:
              "Your account doesn't have permission to delete products.",
          });
          return;
        }
        let body: AdminProductApiError | null = null;
        try {
          body = (await res.json()) as AdminProductApiError;
        } catch {
          // not JSON
        }
        toast.error("Couldn't delete product", {
          description: body?.error ?? "Something went wrong. Please try again.",
        });
        return;
      }
      toast.success("Product deleted", {
        description: `${row.name} has been removed.`,
      });
      setDeleteState(null);

      // Optimistic update — drop the row immediately, then refetch the
      // server snapshot to confirm and refresh storefront SSR.
      setData((current) => {
        if (!current) return current;
        const remaining = current.items.filter((p) => p.id !== row.id);
        return {
          ...current,
          items: remaining,
          total: Math.max(0, current.total - 1),
        };
      });
      await fetchPage(query, flag, categoryId, data.page);
      router.refresh();
    } catch (err) {
      toast.error("Network error", {
        description:
          err instanceof Error
            ? err.message
            : "Could not reach the server. Please try again.",
      });
    } finally {
      setDeleting(false);
    }
  };

  const isEmpty = data.items.length === 0;
  const showingFrom =
    data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
  const showingTo = Math.min(data.total, data.page * data.pageSize);

  return (
    <Card data-testid="admin-products-list">
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle className="text-xl">Products</CardTitle>
          <CardDescription>
            Search the catalog, edit attributes, and toggle merchandising
            flags. Changes propagate to the storefront on save.
          </CardDescription>
        </div>
        <Button asChild size="sm">
          <Link
            href="/admin/products/new"
            data-testid="product-create-link"
          >
            <Plus className="h-4 w-4" />
            New product
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 md:grid-cols-[1fr_200px_200px] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="product-search" className="text-sm">
              Search
            </Label>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="product-search"
                type="search"
                placeholder="Search by name, SKU, or slug"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
                data-testid="product-search-input"
              />
              {query.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-xs text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="product-flag" className="text-sm">
              Filter
            </Label>
            <select
              id="product-flag"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={flag}
              onChange={(e) =>
                setFlag(e.target.value as AdminProductFlagFilter)
              }
              data-testid="product-flag-select"
            >
              {ADMIN_PRODUCT_FLAG_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {FLAG_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="product-category" className="text-sm">
              Category
            </Label>
            <select
              id="product-category"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              data-testid="product-category-select"
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
              flag !== "all" ||
              categoryId.length > 0
                ? "No products match those filters"
                : "No products yet"}
            </p>
            <p className="mb-4 text-sm text-muted-foreground">
              {query.trim().length > 0 ||
              flag !== "all" ||
              categoryId.length > 0
                ? "Try clearing the search, flag, or category filter."
                : "Create your first product to start populating the storefront."}
            </p>
            <Button asChild size="sm">
              <Link href="/admin/products/new">
                <Plus className="h-4 w-4" />
                New product
              </Link>
            </Button>
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
                    <th className="px-3 py-2 font-medium">Flags</th>
                    <th className="px-3 py-2 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.items.map((row) => (
                    <tr
                      key={row.id}
                      className="bg-card hover:bg-muted/30"
                      data-testid={`product-row-${row.id}`}
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
                          <span className="text-sm">{row.category.name}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top whitespace-nowrap">
                        <div>{formatPrice(row.priceCents, row.currency)}</div>
                        {row.compareAtPriceCents != null && (
                          <div className="text-xs text-muted-foreground line-through">
                            {formatPrice(row.compareAtPriceCents, row.currency)}
                          </div>
                        )}
                      </td>
                      <td
                        className="px-3 py-2 align-top whitespace-nowrap"
                        data-testid={`product-stock-${row.id}`}
                      >
                        {row.stock <= 0 ? (
                          <Badge variant="destructive">Out of stock</Badge>
                        ) : (
                          <span>{row.stock}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="flex flex-wrap gap-1">
                          {row.isFeatured && (
                            <Badge variant="success">Featured</Badge>
                          )}
                          {row.isNew && (
                            <Badge variant="secondary">New</Badge>
                          )}
                          {!row.isFeatured && !row.isNew && (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top text-right">
                        <div className="inline-flex flex-wrap justify-end gap-2">
                          <Button
                            asChild
                            type="button"
                            variant="outline"
                            size="sm"
                          >
                            <Link
                              href={`/admin/products/${row.id}`}
                              aria-label={`Edit ${row.name}`}
                            >
                              <Pencil className="h-4 w-4" />
                              Edit
                            </Link>
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => requestDelete(row)}
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            aria-label={`Delete ${row.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
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

      <Dialog
        open={deleteState !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteState(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete product?</DialogTitle>
            <DialogDescription>
              {deleteState
                ? `This permanently removes ${deleteState.row.name} (${deleteState.row.sku}). Customers will see a 404 on its page; orders that already include it stay intact.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDeleteState(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
              data-testid="product-delete-confirm"
            >
              {deleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  Delete
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
