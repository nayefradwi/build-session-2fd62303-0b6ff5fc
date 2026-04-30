import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/client/utils";

/**
 * Display-side mapping for an order's status string. Mirrors
 * `ORDER_STATUSES` in `lib/db/schema.ts` plus the legacy `paid` value
 * older orders may still carry — the UI treats `paid` as a "processing"
 * synonym (the admin state machine collapses the two on forward
 * transitions).
 *
 * The badge intentionally lives in the frontend territory so we never
 * import from the server schema; the input is a plain string and unknown
 * values render as a neutral pill so a future status added on the
 * backend doesn't break this component.
 */
export type OrderStatusValue =
  | "pending"
  | "paid"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled"
  | (string & {});

interface OrderStatusBadgeProps
  extends React.HTMLAttributes<HTMLDivElement> {
  status: OrderStatusValue;
}

interface StatusVisuals {
  /** Customer-facing label. Title-cased. */
  label: string;
  /**
   * Tailwind utility classes layered onto the base `<Badge />` so we can
   * deliver per-status colour without inventing a new variant for each
   * one. Picks colours from the existing palette so the badges read as a
   * coherent set with the rest of the app.
   */
  classes: string;
  /**
   * Single emoji-free dot rendered before the label so the status is
   * scannable at a glance even in monochrome (e.g. printed receipts).
   */
  dotClass: string;
}

const STATUS_VISUALS: Record<string, StatusVisuals> = {
  pending: {
    label: "Pending",
    classes:
      "border-transparent bg-amber-100 text-amber-900 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-200",
    dotClass: "bg-amber-500",
  },
  paid: {
    label: "Processing",
    classes:
      "border-transparent bg-sky-100 text-sky-900 hover:bg-sky-200 dark:bg-sky-900/30 dark:text-sky-200",
    dotClass: "bg-sky-500",
  },
  processing: {
    label: "Processing",
    classes:
      "border-transparent bg-sky-100 text-sky-900 hover:bg-sky-200 dark:bg-sky-900/30 dark:text-sky-200",
    dotClass: "bg-sky-500",
  },
  shipped: {
    label: "Shipped",
    classes:
      "border-transparent bg-indigo-100 text-indigo-900 hover:bg-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-200",
    dotClass: "bg-indigo-500",
  },
  delivered: {
    label: "Delivered",
    classes:
      "border-transparent bg-emerald-100 text-emerald-900 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200",
    dotClass: "bg-emerald-500",
  },
  cancelled: {
    label: "Cancelled",
    classes:
      "border-transparent bg-rose-100 text-rose-900 hover:bg-rose-200 dark:bg-rose-900/30 dark:text-rose-200",
    dotClass: "bg-rose-500",
  },
};

const FALLBACK_VISUALS: StatusVisuals = {
  label: "Unknown",
  classes:
    "border-transparent bg-muted text-muted-foreground hover:bg-muted/80",
  dotClass: "bg-muted-foreground/60",
};

/** Title-case fallback for a status the frontend doesn't recognise yet. */
function titleCase(value: string): string {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function visualsFor(status: string): StatusVisuals {
  const key = status?.toLowerCase?.() ?? "";
  if (key in STATUS_VISUALS) return STATUS_VISUALS[key];
  // Render an unknown status as a neutral pill, but keep the raw text
  // (title-cased) so support can still see what the API said.
  return {
    ...FALLBACK_VISUALS,
    label: titleCase(status ?? "") || FALLBACK_VISUALS.label,
  };
}

/**
 * Coloured, accessible status pill for an order. Used on the order
 * history table, order detail header, and order confirmation screens.
 *
 * The component is intentionally a pure presentation primitive — it
 * doesn't import any server types so it can render against either the
 * `PublicOrderListEntry` or `PublicOrderSummary` payloads.
 */
export function OrderStatusBadge({
  status,
  className,
  ...rest
}: OrderStatusBadgeProps) {
  const v = visualsFor(status);
  return (
    <Badge
      className={cn(v.classes, "gap-1.5", className)}
      data-testid="order-status-badge"
      data-status={status}
      {...rest}
    >
      <span
        aria-hidden="true"
        className={cn("h-1.5 w-1.5 rounded-full", v.dotClass)}
      />
      <span>{v.label}</span>
    </Badge>
  );
}

export { visualsFor as orderStatusVisuals };
