"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, ShieldCheck, UserCircle2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserDetailDrawer } from "@/components/admin/user-detail-drawer";
import { UserStatusBadge } from "@/components/admin/user-status-badge";
import {
  ADMIN_USER_ROLE_FILTER_OPTIONS,
  ADMIN_USER_STATUS_FILTER_OPTIONS,
  type AdminUserApiError,
  type AdminUserDetail,
  type AdminUserListEntry,
  type AdminUserRoleFilter,
  type AdminUserStatusFilter,
  type AdminUsersListResult,
} from "@/components/admin/users-types";
import { formatPrice } from "@/lib/client/format";

interface UsersListProps {
  initialData: AdminUsersListResult;
  initialQuery: string;
  initialRole: AdminUserRoleFilter;
  initialStatus: AdminUserStatusFilter;
  initialUserId: string | null;
  /** Acting admin's id — used to disable destructive controls on self-row. */
  actorUserId: string | null;
}

interface FetchArgs {
  q: string;
  role: AdminUserRoleFilter;
  status: AdminUserStatusFilter;
  page: number;
}

function buildSearchString(args: FetchArgs & { selected?: string | null }): string {
  const params = new URLSearchParams();
  if (args.q.trim().length > 0) params.set("q", args.q.trim());
  if (args.role !== "all") params.set("role", args.role);
  if (args.status !== "all") params.set("status", args.status);
  if (args.page > 1) params.set("page", String(args.page));
  if (args.selected) params.set("selected", args.selected);
  const qs = params.toString();
  return qs.length === 0 ? "" : `?${qs}`;
}

function buildApiUrl(args: FetchArgs): string {
  const params = new URLSearchParams();
  if (args.q.trim().length > 0) params.set("q", args.q.trim());
  if (args.role !== "all") params.set("role", args.role);
  if (args.status !== "all") params.set("status", args.status);
  if (args.page > 1) params.set("page", String(args.page));
  const qs = params.toString();
  return qs.length === 0 ? "/api/admin/users" : `/api/admin/users?${qs}`;
}

async function readApiError(res: Response): Promise<AdminUserApiError | null> {
  try {
    return (await res.json()) as AdminUserApiError;
  } catch {
    return null;
  }
}

function formatDate(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Admin > Users list.
 *
 * Owns the table view, q + role + status filters, pagination, and the
 * row → detail drawer interaction. Detail (profile / addresses / order
 * history) and write actions (enable / disable) live inside the drawer
 * so the operator can stay on the list while triaging.
 */
export function UsersList({
  initialData,
  initialQuery,
  initialRole,
  initialStatus,
  initialUserId,
  actorUserId,
}: UsersListProps) {
  const router = useRouter();
  const [data, setData] = React.useState<AdminUsersListResult>(initialData);
  const [query, setQuery] = React.useState(initialQuery);
  const [role, setRole] = React.useState<AdminUserRoleFilter>(initialRole);
  const [status, setStatus] =
    React.useState<AdminUserStatusFilter>(initialStatus);
  const [loading, setLoading] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(
    initialUserId,
  );

  React.useEffect(() => setData(initialData), [initialData]);
  React.useEffect(() => setQuery(initialQuery), [initialQuery]);
  React.useEffect(() => setRole(initialRole), [initialRole]);
  React.useEffect(() => setStatus(initialStatus), [initialStatus]);
  React.useEffect(() => setSelectedId(initialUserId), [initialUserId]);

  const fetchPage = React.useCallback(
    async (args: FetchArgs) => {
      setLoading(true);
      try {
        const res = await fetch(buildApiUrl(args), {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!res.ok) {
          if (res.status === 401) {
            router.replace("/login?next=/admin/users");
            return;
          }
          if (res.status === 403) {
            toast.error("Admin access required", {
              description:
                "Your account doesn't have permission to view users.",
            });
            return;
          }
          const body = await readApiError(res);
          toast.error("Couldn't load users", {
            description:
              body?.error ?? "Something went wrong. Please try again.",
          });
          return;
        }
        let next: AdminUsersListResult;
        try {
          next = (await res.json()) as AdminUsersListResult;
        } catch {
          toast.error("Unexpected response", {
            description: "Could not parse the users list response.",
          });
          return;
        }
        setData(next);
        const search = buildSearchString({
          ...args,
          selected: selectedId,
        });
        router.replace(`/admin/users${search}`);
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
    [router, selectedId],
  );

  // Debounce search-box typing. Role and status selects fire immediately
  // via their own handlers so users get instant feedback when toggling.
  React.useEffect(() => {
    if (
      query === initialQuery &&
      role === initialRole &&
      status === initialStatus
    ) {
      return;
    }
    const timer = setTimeout(() => {
      void fetchPage({ q: query, role, status, page: 1 });
    }, 300);
    return () => clearTimeout(timer);
  }, [
    query,
    role,
    status,
    initialQuery,
    initialRole,
    initialStatus,
    fetchPage,
  ]);

  const goToPage = (page: number) => {
    void fetchPage({ q: query, role, status, page });
  };

  const refresh = React.useCallback(
    () => fetchPage({ q: query, role, status, page: data.page }),
    [fetchPage, query, role, status, data.page],
  );

  /* ------------------------------------------------------------------ */
  /* Drawer hooks                                                       */
  /* ------------------------------------------------------------------ */

  const openUser = (userId: string) => {
    setSelectedId(userId);
    const search = buildSearchString({
      q: query,
      role,
      status,
      page: data.page,
      selected: userId,
    });
    router.replace(`/admin/users${search}`);
  };

  const closeDrawer = () => {
    setSelectedId(null);
    const search = buildSearchString({
      q: query,
      role,
      status,
      page: data.page,
      selected: null,
    });
    router.replace(`/admin/users${search}`);
  };

  /**
   * After a write inside the drawer (enable / disable) we patch the
   * matching row in the list locally so the badge flips immediately,
   * then schedule a refetch in the background to pick up any concurrent
   * changes (e.g. another admin moved the same user too).
   */
  const onUserUpdated = (updated: AdminUserDetail) => {
    setData((prev) => ({
      ...prev,
      items: prev.items.map((row) =>
        row.id === updated.id
          ? {
              ...row,
              status: updated.status,
              disabledAt: updated.disabledAt,
              disabledReason: updated.disabledReason,
              disabledByUserId: updated.disabledByUserId,
              role: updated.role,
              email: updated.email,
              name: updated.name,
              orderCount: updated.orderCount,
              totalSpentCents: updated.totalSpentCents,
              updatedAt: updated.updatedAt,
            }
          : row,
      ),
    }));
    void refresh();
  };

  /* ------------------------------------------------------------------ */
  /* Render                                                             */
  /* ------------------------------------------------------------------ */

  const isEmpty = data.items.length === 0;
  const showingFrom =
    data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
  const showingTo = Math.min(data.total, data.page * data.pageSize);

  const filtersActive =
    query.trim().length > 0 || role !== "all" || status !== "all";

  return (
    <Card data-testid="admin-users-list">
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle className="text-xl">Users</CardTitle>
          <CardDescription>
            Search customers and admins, inspect profile / addresses /
            order history, and enable or disable accounts.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 md:grid-cols-[1.6fr_180px_180px] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="users-search" className="text-sm">
              Search
            </Label>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="users-search"
                type="search"
                placeholder="Email, name, or user id"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
                data-testid="admin-users-search"
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
            <Label htmlFor="users-role" className="text-sm">
              Role
            </Label>
            <select
              id="users-role"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={role}
              onChange={(e) => setRole(e.target.value as AdminUserRoleFilter)}
              data-testid="admin-users-role"
            >
              {ADMIN_USER_ROLE_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="users-status" className="text-sm">
              Status
            </Label>
            <select
              id="users-status"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as AdminUserStatusFilter)
              }
              data-testid="admin-users-status"
            >
              {ADMIN_USER_STATUS_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {filtersActive && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Filters applied.</span>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setRole("all");
                setStatus("all");
              }}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
            >
              Clear all
            </button>
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading…
          </div>
        )}

        {isEmpty && !loading ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 p-8 text-center">
            <p className="text-sm font-medium">
              {filtersActive ? "No users match those filters" : "No users yet"}
            </p>
            <p className="text-sm text-muted-foreground">
              {filtersActive
                ? "Try clearing the search, role, or status filter."
                : "When customers register, they'll show up here."}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">User</th>
                    <th className="px-3 py-2 font-medium">Role</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Orders</th>
                    <th className="px-3 py-2 font-medium">Spent</th>
                    <th className="px-3 py-2 font-medium">Joined</th>
                    <th className="px-3 py-2 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.items.map((row) => (
                    <tr
                      key={row.id}
                      className="cursor-pointer bg-card transition-colors hover:bg-muted/40 data-[selected=true]:bg-muted/50"
                      data-testid={`admin-users-row-${row.id}`}
                      data-selected={
                        selectedId === row.id ? "true" : undefined
                      }
                      onClick={() => openUser(row.id)}
                    >
                      <td className="px-3 py-2 align-top">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2 font-medium">
                            <span>{row.name ?? "(no name)"}</span>
                            {actorUserId === row.id && (
                              <Badge variant="outline" className="text-[10px]">
                                You
                              </Badge>
                            )}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {row.email}
                          </div>
                          <div className="truncate font-mono text-[11px] text-muted-foreground">
                            {row.id}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <UserRoleBadge role={row.role} />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <UserStatusBadge status={row.status} />
                      </td>
                      <td className="px-3 py-2 align-top">
                        {row.orderCount.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 align-top whitespace-nowrap font-medium">
                        {formatPrice(row.totalSpentCents)}
                      </td>
                      <td className="px-3 py-2 align-top whitespace-nowrap text-xs text-muted-foreground">
                        {formatDate(row.createdAt)}
                      </td>
                      <td className="px-3 py-2 align-top text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            openUser(row.id);
                          }}
                          data-testid={`admin-users-view-${row.id}`}
                        >
                          View
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>
                Showing {showingFrom.toLocaleString()}–
                {showingTo.toLocaleString()} of {data.total.toLocaleString()}
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

      <UserDetailDrawer
        userId={selectedId}
        actorUserId={actorUserId}
        onClose={closeDrawer}
        onUpdated={onUserUpdated}
      />
    </Card>
  );
}

/* -------------------------------------------------------------------- */
/* Inline role badge                                                     */
/* -------------------------------------------------------------------- */

function UserRoleBadge({ role }: { role: string }) {
  if (role === "admin") {
    return (
      <Badge variant="default" className="gap-1.5">
        <ShieldCheck className="h-3 w-3" aria-hidden="true" />
        Admin
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1.5">
      <UserCircle2 className="h-3 w-3" aria-hidden="true" />
      Customer
    </Badge>
  );
}
