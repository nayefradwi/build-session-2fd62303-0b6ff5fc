import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/client/utils";
import type { AdminUserStatus } from "@/components/admin/users-types";

interface UserStatusBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  status: AdminUserStatus | string;
}

interface StatusVisuals {
  label: string;
  classes: string;
  dotClass: string;
}

const STATUS_VISUALS: Record<string, StatusVisuals> = {
  active: {
    label: "Active",
    classes:
      "border-transparent bg-emerald-100 text-emerald-900 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200",
    dotClass: "bg-emerald-500",
  },
  disabled: {
    label: "Disabled",
    classes:
      "border-transparent bg-rose-100 text-rose-900 hover:bg-rose-200 dark:bg-rose-900/30 dark:text-rose-200",
    dotClass: "bg-rose-500",
  },
};

const FALLBACK_VISUALS: StatusVisuals = {
  label: "Unknown",
  classes: "border-transparent bg-muted text-muted-foreground",
  dotClass: "bg-muted-foreground/60",
};

function visualsFor(status: string): StatusVisuals {
  const key = status?.toLowerCase?.() ?? "";
  if (key in STATUS_VISUALS) return STATUS_VISUALS[key];
  return FALLBACK_VISUALS;
}

/**
 * Coloured pill for an admin-user account status. Mirrors the look of
 * `OrderStatusBadge` so the admin surfaces feel consistent.
 */
export function UserStatusBadge({
  status,
  className,
  ...rest
}: UserStatusBadgeProps) {
  const v = visualsFor(status);
  return (
    <Badge
      className={cn(v.classes, "gap-1.5", className)}
      data-testid="admin-user-status-badge"
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
