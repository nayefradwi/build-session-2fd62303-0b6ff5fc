/**
 * Admin users client-side types.
 *
 * Mirrors the public payloads exposed by `lib/server/admin-users.ts` so
 * the list / detail / drawer components can render against the API
 * response without dragging the Drizzle client (or `next/headers`)
 * into the browser bundle.
 *
 * Keep these shapes in lock-step with the server module — they are the
 * contract `app/api/admin/users/**` returns to the browser.
 */

export const ADMIN_USER_ROLE_FILTERS = ["all", "user", "admin"] as const;
export type AdminUserRoleFilter = (typeof ADMIN_USER_ROLE_FILTERS)[number];

export const ADMIN_USER_STATUS_FILTERS = [
  "all",
  "active",
  "disabled",
] as const;
export type AdminUserStatusFilter =
  (typeof ADMIN_USER_STATUS_FILTERS)[number];

export const ADMIN_USER_ROLE_FILTER_OPTIONS: ReadonlyArray<{
  value: AdminUserRoleFilter;
  label: string;
}> = [
  { value: "all", label: "All roles" },
  { value: "user", label: "Customer" },
  { value: "admin", label: "Admin" },
];

export const ADMIN_USER_STATUS_FILTER_OPTIONS: ReadonlyArray<{
  value: AdminUserStatusFilter;
  label: string;
}> = [
  { value: "all", label: "Active + disabled" },
  { value: "active", label: "Active" },
  { value: "disabled", label: "Disabled" },
];

export type AdminUserStatus = "active" | "disabled";

export interface AdminUserListEntry {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: AdminUserStatus;
  disabledAt: string | null;
  disabledReason: string | null;
  disabledByUserId: string | null;
  orderCount: number;
  totalSpentCents: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUserAddress {
  id: string;
  label: string | null;
  recipient: string | null;
  phone: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postalCode: string;
  country: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUserOrderEntry {
  id: string;
  orderNumber: string;
  status: string;
  itemCount: number;
  subtotalCents: number;
  shippingCents: number;
  discountCents: number;
  totalCents: number;
  currency: string;
  discountCode: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUserDetail extends AdminUserListEntry {
  addresses: AdminUserAddress[];
  orders: AdminUserOrderEntry[];
  orderTotals: {
    count: number;
    totalSpentCents: number;
    currency: string | null;
  };
}

export interface AdminUsersListResult {
  items: AdminUserListEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface AdminUserApiError {
  error: string;
  code: string;
  fieldErrors?: Record<string, string[]>;
  details?: Record<string, unknown>;
}
