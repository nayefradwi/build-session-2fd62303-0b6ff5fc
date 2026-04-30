import type { Metadata } from "next";

import { UsersList } from "@/components/admin/users-list";
import {
  ADMIN_USER_ROLE_FILTERS,
  ADMIN_USER_STATUS_FILTERS,
  type AdminUserRoleFilter,
  type AdminUserStatusFilter,
  type AdminUsersListResult,
} from "@/components/admin/users-types";
import { getCurrentUser } from "@/lib/server/auth";
import {
  ADMIN_USERS_DEFAULT_PAGE_SIZE,
  listAdminUsers,
} from "@/lib/server/admin-users";

export const metadata: Metadata = {
  title: "Users",
  description:
    "Search across customers and admins, review profile / addresses / order history, and enable or disable accounts.",
};

export const dynamic = "force-dynamic";

interface AdminUsersPageProps {
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

function parsePage(raw: string | undefined): number {
  if (!raw) return 1;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

function parseRole(raw: string | undefined): AdminUserRoleFilter {
  if (!raw) return "all";
  return (ADMIN_USER_ROLE_FILTERS as readonly string[]).includes(raw)
    ? (raw as AdminUserRoleFilter)
    : "all";
}

function parseStatus(raw: string | undefined): AdminUserStatusFilter {
  if (!raw) return "all";
  return (ADMIN_USER_STATUS_FILTERS as readonly string[]).includes(raw)
    ? (raw as AdminUserStatusFilter)
    : "all";
}

function parseSelectedId(raw: string | undefined): string | null {
  if (!raw) return null;
  return UUID_RE.test(raw) ? raw : null;
}

/**
 * Admin > Users.
 *
 * Server component — reads the same filters off the URL the client
 * component manages so deep links and refreshes hydrate to the right
 * state. The first page is fetched directly via the shared service
 * helper so the initial paint is fully populated; subsequent filter /
 * pagination changes go through the API.
 *
 * The actor's user id is forwarded to the client so the detail drawer
 * can grey out destructive actions on the admin's own row (the API
 * already refuses self-disable / self-delete with a typed 409, but
 * surfacing the rule in the UI keeps the affordance honest).
 */
export default async function AdminUsersPage({
  searchParams,
}: AdminUsersPageProps) {
  // The /admin layout already enforces requireAdmin(); fetching the
  // current user here is just so the drawer can compare ids.
  const actor = await getCurrentUser();

  const resolved = await searchParams;
  const q = pickString(resolved, "q") ?? "";
  const role = parseRole(pickString(resolved, "role"));
  const status = parseStatus(pickString(resolved, "status"));
  const page = parsePage(pickString(resolved, "page"));
  const selected = parseSelectedId(pickString(resolved, "selected"));

  const initialData: AdminUsersListResult = await listAdminUsers({
    page,
    pageSize: ADMIN_USERS_DEFAULT_PAGE_SIZE,
    role,
    status,
    q: q.trim().length > 0 ? q.trim() : undefined,
  });

  return (
    <UsersList
      initialData={initialData}
      initialQuery={q}
      initialRole={role}
      initialStatus={status}
      initialUserId={selected}
      actorUserId={actor?.id ?? null}
    />
  );
}
