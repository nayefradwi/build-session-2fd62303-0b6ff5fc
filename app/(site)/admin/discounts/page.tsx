import type { Metadata } from "next";

import { DiscountCodesList } from "@/components/admin/discount-codes-list";
import {
  ADMIN_DISCOUNT_STATUS_FILTERS,
  type AdminDiscountStatusFilter,
} from "@/components/admin/types";
import { listDiscountCodes } from "@/lib/server/discount-codes";

export const metadata: Metadata = {
  title: "Discount codes",
  description: "Manage promo codes used at checkout.",
};

export const dynamic = "force-dynamic";

interface DiscountsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Pull a single string out of the resolved searchParams object. Arrays
 * (which Next.js produces for repeated keys) collapse to the first
 * value — the admin UI only ever sets each filter once.
 */
function pickString(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const raw = params[key];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function parseStatus(raw: string | undefined): AdminDiscountStatusFilter {
  if (!raw) return "all";
  return (ADMIN_DISCOUNT_STATUS_FILTERS as readonly string[]).includes(raw)
    ? (raw as AdminDiscountStatusFilter)
    : "all";
}

function parsePage(raw: string | undefined): number {
  if (!raw) return 1;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

/**
 * Admin > Discounts list page.
 *
 * Server component — fetches the first page directly via the shared
 * helper (the same code path the API route uses) and seeds the client
 * list. The layout has already verified the user is an admin, so any
 * navigation that lands here is authorised.
 */
export default async function AdminDiscountsPage({
  searchParams,
}: DiscountsPageProps) {
  const resolved = await searchParams;
  const q = pickString(resolved, "q") ?? "";
  const status = parseStatus(pickString(resolved, "status"));
  const page = parsePage(pickString(resolved, "page"));

  const data = await listDiscountCodes({
    q: q.length > 0 ? q : undefined,
    status,
    page,
  });

  // The helper already returns the public payload shape, so we can pass
  // it straight through — the `AdminDiscountCodeListResult` type is a
  // structural mirror of `ListDiscountCodesResult`.
  return (
    <DiscountCodesList
      initialData={data}
      initialQuery={q}
      initialStatus={status}
    />
  );
}
