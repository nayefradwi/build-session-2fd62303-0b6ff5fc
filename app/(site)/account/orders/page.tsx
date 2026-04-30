import Link from "next/link";
import type { Metadata } from "next";
import { Package } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireUser } from "@/lib/server/auth";

export const metadata: Metadata = {
  title: "Order history",
  description: "Review your past orders.",
};

export const dynamic = "force-dynamic";

/**
 * `/account/orders` — placeholder shell for the order history view.
 *
 * The orders feature is not built yet (a separate task will add the
 * orders schema, API, and the populated list view); for now we
 * surface a friendly empty state so the link from the profile page
 * lands on a real page instead of a 404.
 */
export default async function AccountOrdersPage() {
  // Auth is enforced by the parent layout, but we call requireUser()
  // anyway so future work can read fields off the user without an
  // extra fetch.
  await requireUser();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Order history</CardTitle>
        <CardDescription>
          A record of every order you&apos;ve placed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-muted/20 p-8 text-center">
          <Package
            className="h-8 w-8 text-muted-foreground"
            aria-hidden="true"
          />
          <div className="space-y-1">
            <p className="text-sm font-medium">No orders yet</p>
            <p className="text-sm text-muted-foreground">
              When you place an order, it&apos;ll show up here.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/">Continue browsing</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
