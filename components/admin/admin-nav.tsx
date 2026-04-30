"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Tag } from "lucide-react";

import { cn } from "@/lib/client/utils";

interface AdminNavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

/**
 * Sidebar navigation for the /admin section. New admin surfaces (orders,
 * products, customers…) just append to this array; the highlight logic
 * automatically follows nested routes (`/admin/discounts/{id}` keeps the
 * Discounts entry lit).
 */
const NAV_ITEMS: ReadonlyArray<AdminNavItem> = [
  { href: "/admin/discounts", label: "Discounts", icon: Tag },
];

/**
 * Sidebar navigation for the /admin section. Client component because
 * we need `usePathname()` to highlight the active entry.
 */
export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin navigation" className="space-y-1">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
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
