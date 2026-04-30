import type { Metadata } from "next";

import { OrdersList } from "@/components/admin/orders-list";
import {
  ADMIN_ORDER_STATUS_FILTERS,
  type AdminOrderStatusFilter,
  type AdminOrdersListResult,
} from "@/components/admin/orders-types";
import {
  ADMIN_ORDERS_DEFAULT_PAGE_SIZE,
  listAdminOrders,
  parseAdminOrderStatusFilter,
} from "@/lib/server/admin-orders";

export const metadata: Metadata = {
  title: "Orders",
  description:
    "Triage customer orders, advance fulfilment status, cancel with a reason, and export CSVs.",
};

export const dynamic = "force-dynamic";

interface AdminOrdersPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Tolerant ISO-ish parser used to validate `dateFrom` / `dateTo` query
// strings before we forward them to the API. `yyyy-MM-dd` (the format
// the date-input picker emits), full ISO 8601, and any unambiguous
// JS-parseable string all pass.
const ISO_LIKE_RE = /^\d{4}-\d{2}-\d{2}/;

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

function parseStatus(raw: string | undefined): AdminOrderStatusFilter {
  if (!raw) return "all";
  return (ADMIN_ORDER_STATUS_FILTERS as readonly string[]).includes(raw)
    ? (raw as AdminOrderStatusFilter)
    : "all";
}

function parseDate(raw: string | undefined): string {
  if (!raw) return "";
  if (!ISO_LIKE_RE.test(raw)) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  return raw;
}

function parseSelectedId(raw: string | undefined): string | null {
  if (!raw) return null;
  return UUID_RE.test(raw) ? raw : null;
}

/**
 * Admin > Orders.
 *
 * Server component — reads the same filters off the URL the client
 * component manages so deep links and refreshes hydrate to the right
 * state. The first page is fetched directly via the shared service
 * helper (the same code path `GET /api/admin/orders` uses) so the
 * initial paint is fully populated.
 *
 * Subsequent filter / pagination changes are handled by the client
 * component talking to the API.
 */
export default async function AdminOrdersPage({
  searchParams,
}: AdminOrdersPageProps) {
  const resolved = await searchParams;
  const q = pickString(resolved, "q") ?? "";
  const status = parseStatus(pickString(resolved, "status"));
  const dateFrom = parseDate(pickString(resolved, "dateFrom"));
  const dateTo = parseDate(pickString(resolved, "dateTo"));
  const page = parsePage(pickString(resolved, "page"));
  const selected = parseSelectedId(pickString(resolved, "selected"));

  // Coerce date strings into Date objects for the server helper. The
  // route layer normally does this with explicit error responses; here
  // we silently fall back to "no filter" because URL-driven filters
  // shouldn't surface 4xxs.
  const dateFromValue = dateFrom ? new Date(dateFrom) : undefined;
  const dateToValue = dateTo ? new Date(dateTo) : undefined;

  const initialData: AdminOrdersListResult = await listAdminOrders({
    page,
    pageSize: ADMIN_ORDERS_DEFAULT_PAGE_SIZE,
    status: parseAdminOrderStatusFilter(status) ?? "all",
    q: q.trim().length > 0 ? q.trim() : undefined,
    dateFrom: dateFromValue,
    dateTo: dateToValue,
  });

  return (
    <OrdersList
      initialData={initialData}
      initialQuery={q}
      initialStatus={status}
      initialDateFrom={dateFrom}
      initialDateTo={dateTo}
      initialOrderId={selected}
    />
  );
}
