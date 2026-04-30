"use client";

import * as React from "react";
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
  ADMIN_DISCOUNT_STATUS_FILTERS,
  type AdminDiscountCode,
  type AdminDiscountCodeApiError,
  type AdminDiscountCodeListResult,
  type AdminDiscountCodeStatus,
  type AdminDiscountStatusFilter,
} from "@/components/admin/types";
import { formatPrice } from "@/lib/client/format";

interface DiscountCodesListProps {
  initialData: AdminDiscountCodeListResult;
  initialQuery: string;
  initialStatus: AdminDiscountStatusFilter;
}

const STATUS_LABELS: Record<AdminDiscountStatusFilter, string> = {
  all: "All",
  active: "Active",
  inactive: "Inactive",
  expired: "Expired",
  exhausted: "Exhausted",
};

const STATUS_BADGE_VARIANT: Record<
  AdminDiscountCodeStatus,
  "success" | "secondary" | "warning" | "destructive"
> = {
  active: "success",
  inactive: "secondary",
  expired: "warning",
  exhausted: "destructive",
};

const STATUS_BADGE_LABEL: Record<AdminDiscountCodeStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  expired: "Expired",
  exhausted: "Exhausted",
};

/**
 * Format a discount value for the table cell. Percentage codes show as
 * "10% off" and fixed codes show as a currency-formatted dollar amount.
 */
function formatDiscountValue(row: AdminDiscountCode): string {
  if (row.type === "percentage") return `${row.value}% off`;
  return `${formatPrice(row.value)} off`;
}

function formatExpiry(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function formatUsage(row: AdminDiscountCode): string {
  if (row.usageLimit == null) return `${row.usageCount} / ∞`;
  return `${row.usageCount} / ${row.usageLimit}`;
}

interface DeleteState {
  kind: "open";
  row: AdminDiscountCode;
}

/**
 * Build a `?q=…&status=…&page=…` query string for the URL we want the
 * page to live at while honouring the active filters / search / page.
 * Empty values are dropped so the URL stays clean ("/admin/discounts"
 * for the unfiltered first page).
 */
function buildSearchString(
  q: string,
  status: AdminDiscountStatusFilter,
  page: number,
): string {
  const params = new URLSearchParams();
  if (q.trim().length > 0) params.set("q", q.trim());
  if (status !== "all") params.set("status", status);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs.length === 0 ? "" : `?${qs}`;
}

/**
 * Admin discount codes list. Owns the search box, the status filter,
 * delete confirmation dialog, and the network IO that re-fetches the
 * list on filter changes.
 *
 * The server component renders the first page and seeds this component
 * via `initialData`. Subsequent filter / search / pagination interactions
 * update the URL (so the page is bookmarkable) and refetch from the
 * API; the SSR pass on `router.refresh()` will pick up the same data.
 */
export function DiscountCodesList({
  initialData,
  initialQuery,
  initialStatus,
}: DiscountCodesListProps) {
  const router = useRouter();
  const [data, setData] =
    React.useState<AdminDiscountCodeListResult>(initialData);
  const [query, setQuery] = React.useState(initialQuery);
  const [status, setStatus] =
    React.useState<AdminDiscountStatusFilter>(initialStatus);
  const [loading, setLoading] = React.useState(false);
  const [deleteState, setDeleteState] = React.useState<DeleteState | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  // Re-sync if a fresh server snapshot arrives via router.refresh().
  React.useEffect(() => {
    setData(initialData);
  }, [initialData]);
  React.useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);
  React.useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  /**
   * Fetch a fresh page from the API and update both the URL and the
   * local state. Uses the server-snapshot for the first paint; from
   * then on this is the source of updates.
   */
  const fetchPage = React.useCallback(
    async (
      nextQuery: string,
      nextStatus: AdminDiscountStatusFilter,
      nextPage: number,
    ) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (nextQuery.trim().length > 0) params.set("q", nextQuery.trim());
        if (nextStatus !== "all") params.set("status", nextStatus);
        if (nextPage > 1) params.set("page", String(nextPage));
        const url =
          params.toString().length === 0
            ? "/api/admin/discount-codes"
            : `/api/admin/discount-codes?${params.toString()}`;

        const res = await fetch(url, {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
        });

        if (!res.ok) {
          if (res.status === 401) {
            router.replace("/login?next=/admin/discounts");
            return;
          }
          if (res.status === 403) {
            toast.error("Admin access required", {
              description:
                "Your account doesn't have permission to manage discounts.",
            });
            return;
          }
          let body: AdminDiscountCodeApiError | null = null;
          try {
            body = (await res.json()) as AdminDiscountCodeApiError;
          } catch {
            // not JSON
          }
          toast.error("Couldn't load discounts", {
            description:
              body?.error ?? "Something went wrong. Please try again.",
          });
          return;
        }

        const next = (await res.json()) as AdminDiscountCodeListResult;
        setData(next);
        const search = buildSearchString(nextQuery, nextStatus, nextPage);
        // `replace` keeps the URL in sync without polluting browser
        // history with every keystroke.
        router.replace(`/admin/discounts${search}`);
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
  // The status filter and pagination changes are immediate.
  React.useEffect(() => {
    if (query === initialQuery && status === initialStatus) return;
    const timer = setTimeout(() => {
      void fetchPage(query, status, 1);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, status, initialQuery, initialStatus, fetchPage]);

  const handleStatusChange = (next: AdminDiscountStatusFilter) => {
    setStatus(next);
  };

  const handleClearSearch = () => {
    setQuery("");
  };

  const goToPage = (page: number) => {
    void fetchPage(query, status, page);
  };

  const requestDelete = (row: AdminDiscountCode) => {
    setDeleteState({ kind: "open", row });
  };

  const confirmDelete = async () => {
    if (!deleteState) return;
    const { row } = deleteState;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/discount-codes/${row.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        if (res.status === 401) {
          router.replace("/login?next=/admin/discounts");
          return;
        }
        if (res.status === 403) {
          toast.error("Admin access required", {
            description:
              "Your account doesn't have permission to delete discounts.",
          });
          return;
        }
        let body: AdminDiscountCodeApiError | null = null;
        try {
          body = (await res.json()) as AdminDiscountCodeApiError;
        } catch {
          // not JSON
        }
        toast.error("Couldn't delete discount", {
          description: body?.error ?? "Something went wrong. Please try again.",
        });
        return;
      }
      toast.success("Discount deleted", {
        description: `${row.code} has been removed.`,
      });
      setDeleteState(null);
      // Refetch the same page so the row disappears immediately.
      await fetchPage(query, status, data.page);
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
    <Card data-testid="discount-codes-list">
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle className="text-xl">Discount codes</CardTitle>
          <CardDescription>
            Search, create, and manage promo codes used at checkout.
          </CardDescription>
        </div>
        <Button asChild size="sm">
          <Link
            href="/admin/discounts/new"
            data-testid="discount-create-link"
          >
            <Plus className="h-4 w-4" />
            New discount
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="discount-search" className="text-sm">
              Search
            </Label>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="discount-search"
                type="search"
                placeholder="Search by code or description"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
                data-testid="discount-search-input"
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
          <div className="space-y-1.5 sm:w-48">
            <Label htmlFor="discount-status" className="text-sm">
              Status
            </Label>
            <select
              id="discount-status"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={status}
              onChange={(e) =>
                handleStatusChange(
                  e.target.value as AdminDiscountStatusFilter,
                )
              }
              data-testid="discount-status-select"
            >
              {ADMIN_DISCOUNT_STATUS_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {STATUS_LABELS[value]}
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
              {query.trim().length > 0 || status !== "all"
                ? "No discount codes match those filters"
                : "No discount codes yet"}
            </p>
            <p className="mb-4 text-sm text-muted-foreground">
              {query.trim().length > 0 || status !== "all"
                ? "Try clearing the search or status filter."
                : "Create your first promo code to start running campaigns."}
            </p>
            <Button asChild size="sm">
              <Link href="/admin/discounts/new">
                <Plus className="h-4 w-4" />
                New discount
              </Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Code</th>
                    <th className="px-3 py-2 font-medium">Discount</th>
                    <th className="px-3 py-2 font-medium">Min order</th>
                    <th className="px-3 py-2 font-medium">Expires</th>
                    <th className="px-3 py-2 font-medium">Usage</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.items.map((row) => {
                    return (
                      <tr
                        key={row.id}
                        className="bg-card hover:bg-muted/30"
                        data-testid={`discount-row-${row.id}`}
                      >
                        <td className="px-3 py-2 align-top">
                          <div className="font-mono font-semibold">
                            {row.code}
                          </div>
                          {row.description && (
                            <div className="mt-0.5 max-w-xs truncate text-xs text-muted-foreground">
                              {row.description}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top whitespace-nowrap">
                          {formatDiscountValue(row)}
                        </td>
                        <td className="px-3 py-2 align-top whitespace-nowrap">
                          {row.minOrderValue == null
                            ? "—"
                            : formatPrice(row.minOrderValue)}
                        </td>
                        <td className="px-3 py-2 align-top whitespace-nowrap text-muted-foreground">
                          {formatExpiry(row.expiresAt)}
                        </td>
                        <td
                          className="px-3 py-2 align-top whitespace-nowrap font-mono text-xs"
                          data-testid={`discount-usage-${row.id}`}
                        >
                          {formatUsage(row)}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <Badge
                            variant={STATUS_BADGE_VARIANT[row.status]}
                            data-testid={`discount-status-${row.id}`}
                          >
                            {STATUS_BADGE_LABEL[row.status]}
                          </Badge>
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
                                href={`/admin/discounts/${row.id}`}
                                aria-label={`Edit ${row.code}`}
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
                              aria-label={`Delete ${row.code}`}
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete
                            </Button>
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

      <Dialog
        open={deleteState !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteState(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete discount code?</DialogTitle>
            <DialogDescription>
              {deleteState
                ? `This permanently removes ${deleteState.row.code}. Customers using this code at checkout will see "code not found".`
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
              data-testid="discount-delete-confirm"
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
