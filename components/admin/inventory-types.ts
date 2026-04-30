/**
 * Public shape of the admin inventory API surface, mirrored on the
 * client. Kept in `components/admin/` (not `lib/server`) so the client
 * components can import them without dragging server-only helpers into
 * the browser bundle.
 *
 * The shapes intentionally match `lib/server/inventory.ts` byte-for-byte
 * — we just can't import that module from a client component because it
 * pulls in `next/headers` and the Drizzle client.
 */

export const INVENTORY_STATUS_FILTERS = [
  "any",
  "in",
  "out",
  "low",
] as const;

export type InventoryStatusFilter = (typeof INVENTORY_STATUS_FILTERS)[number];

export interface InventoryCategory {
  id: string;
  slug: string;
  name: string;
}

export interface InventoryRow {
  productId: string;
  slug: string;
  sku: string;
  name: string;
  primaryImageUrl: string | null;
  category: InventoryCategory | null;
  priceCents: number;
  currency: string;
  size: string | null;
  material: string | null;
  color: string | null;
  stock: number;
  inStock: boolean;
  outOfStock: boolean;
  lowStock: boolean;
  lowStockThreshold: number;
  updatedAt: string;
}

export interface InventoryListResult {
  items: InventoryRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
  lowStockThreshold: number;
}

export interface PublicStockAdjustment {
  id: string;
  productId: string;
  productSku: string;
  productName: string;
  userId: string | null;
  userEmail: string | null;
  delta: number;
  previousStock: number;
  newStock: number;
  reason: string | null;
  createdAt: string;
}

export interface AdjustmentsListResult {
  items: PublicStockAdjustment[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface InventoryCategoryOption {
  id: string;
  slug: string;
  name: string;
  parentId: string | null;
}

export interface InventoryApiError {
  error: string;
  code: string;
  fieldErrors?: Record<string, string[]>;
}

export interface BulkUpdateLine {
  productId: string;
  stock?: number;
  delta?: number;
  reason?: string | null;
}

export interface BulkUpdateLineResult {
  productId: string;
  ok: boolean;
  product?: InventoryRow;
  adjustment?: PublicStockAdjustment;
  error?: { code: string; message?: string; fields?: Record<string, string[]> };
}

export interface BulkUpdateResult {
  ok: true;
  results: BulkUpdateLineResult[];
  applied: number;
  failed: number;
}
