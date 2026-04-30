"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MapPin, Package, User } from "lucide-react";

import { cn } from "@/lib/client/utils";

interface AccountNavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /**
   * When true, the nav item is highlighted on exact match only. Used
   * for the top-level /account profile entry so it doesn't stay lit
   * when the user is on /account/orders.
   */
  exact?: boolean;
}

const NAV_ITEMS: ReadonlyArray<AccountNavItem> = [
  { href: "/account", label: "Profile", icon: User, exact: true },
  { href: "/account/addresses", label: "Addresses", icon: MapPin },
  { href: "/account/orders", label: "Order history", icon: Package },
];

/**
 * Sidebar navigation for the /account section. Client component because
 * we need `usePathname()` to highlight the active entry.
 */
export function AccountNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Account navigation" className="space-y-1">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
