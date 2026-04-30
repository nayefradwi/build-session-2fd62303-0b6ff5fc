/**
 * Shared TypeScript shapes for the admin products UI.
 *
 * Mirrors the payload returned by `lib/server/admin-products` (`AdminProduct`
 * / `ListAdminProductsResult`) so the client can render every field the API
 * exposes — including the full image gallery, rating snapshot, and stock /
 * merchandising flags — without re-importing server-only modules.
 *
 * Kept under `components/admin` (rather than `lib/client`) so the type
 * definition lives next to the surfaces that consume it; the canonical
 * server-side shape is published from `@/lib/server/admin-products`.
 */

export interface AdminProductImage {
  id: string;
  url: string;
  alt: string | null;
  position: number;
}

export interface AdminProductCategoryRef {
  id: string;
  slug: string;
  name: string;
}

export interface AdminProduct {
  id: string;
  slug: string;
  sku: string;
  name: string;
  description: string;
  category: AdminProductCategoryRef | null;
  priceCents: number;
  compareAtPriceCents: number | null;
  currency: string;
  size: string | null;
  material: string | null;
  color: string | null;
  stock: number;
  inStock: boolean;
  isFeatured: boolean;
  isNew: boolean;
  rating: { average: number; count: number };
  salesCount: number;
  primaryImageUrl: string | null;
  images: AdminProductImage[];
  createdAt: string;
  updatedAt: string;
}

export interface AdminProductListResult {
  items: AdminProduct[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface AdminProductApiError {
  error: string;
  code: string;
  fieldErrors?: Record<string, string[]>;
  details?: Record<string, unknown>;
}

/** Subset of an admin-categories list payload the products UI renders in
 *  its category selector. The categories API publishes more, but the form
 *  only needs `id`, `name`, and (optionally) `slug` for display. */
export interface AdminProductCategoryOption {
  id: string;
  slug: string;
  name: string;
  parentId?: string | null;
}

export interface AdminCategoryListResult {
  items: AdminProductCategoryOption[];
  total: number;
}

/** Allowed values for the `?flag=` filter on the list page. Maps onto the
 *  list endpoint's `featured=true` / `new=true` query params. */
export const ADMIN_PRODUCT_FLAG_FILTERS = [
  "all",
  "featured",
  "new",
  "out_of_stock",
] as const;

export type AdminProductFlagFilter =
  (typeof ADMIN_PRODUCT_FLAG_FILTERS)[number];
