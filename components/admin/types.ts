/**
 * Shared TypeScript shapes for the admin discount-codes UI.
 *
 * Mirrors the public payload returned by `lib/server/discount-codes`
 * (`PublicDiscountCode` / `ListDiscountCodesResult`) so the client side
 * can render every column the API exposes — including derived values
 * like `status` and `usageRemaining`.
 *
 * Kept here (under components/admin) rather than in `lib/client/` so it
 * lives next to the surfaces that consume it; the server side already
 * publishes its own type.
 */

export type AdminDiscountCodeStatus =
  | "active"
  | "inactive"
  | "expired"
  | "exhausted";

export type AdminDiscountCodeType = "percentage" | "fixed";

export interface AdminDiscountCode {
  id: string;
  code: string;
  type: AdminDiscountCodeType;
  /** Either a 1-100 whole percent or an integer cents amount. */
  value: number;
  /** Cents; null when there's no minimum. */
  minOrderValue: number | null;
  /** ISO 8601, with offset; null when there's no expiry. */
  expiresAt: string | null;
  isActive: boolean;
  usageLimit: number | null;
  usageCount: number;
  /** `usageLimit - usageCount`, or null when there is no limit. */
  usageRemaining: number | null;
  status: AdminDiscountCodeStatus;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminDiscountCodeListResult {
  items: AdminDiscountCode[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface AdminDiscountCodeApiError {
  error: string;
  code: string;
  fieldErrors?: Record<string, string[]>;
  details?: Record<string, unknown>;
}

/** Allowed values for the `?status=` filter on the list endpoint. */
export const ADMIN_DISCOUNT_STATUS_FILTERS = [
  "all",
  "active",
  "inactive",
  "expired",
  "exhausted",
] as const;

export type AdminDiscountStatusFilter =
  (typeof ADMIN_DISCOUNT_STATUS_FILTERS)[number];
