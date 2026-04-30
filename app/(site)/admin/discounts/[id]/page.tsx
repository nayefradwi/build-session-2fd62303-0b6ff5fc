import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";

import { DiscountCodeForm } from "@/components/admin/discount-code-form";
import type { AdminDiscountCode } from "@/components/admin/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getDiscountCodeById } from "@/lib/server/discount-codes";

export const metadata: Metadata = {
  title: "Edit discount code",
  description: "Edit an existing promo code.",
};

export const dynamic = "force-dynamic";

interface EditDiscountPageProps {
  params: Promise<{ id: string }>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Admin > Discounts > Edit.
 *
 * Server component — loads the row by id (404s on unknown / malformed
 * ids) and passes the canonical row to the form. The form handles its
 * own submit / error / success path; this page is just a shell.
 */
export default async function EditDiscountPage({
  params,
}: EditDiscountPageProps) {
  const { id } = await params;
  if (!id || !UUID_RE.test(id)) notFound();
  const row = await getDiscountCodeById(id);
  if (!row) notFound();

  // The helper returns `PublicDiscountCode`, which structurally matches
  // `AdminDiscountCode`. Cast keeps the call site explicit.
  const initial: AdminDiscountCode = row as AdminDiscountCode;

  return (
    <Card>
      <CardHeader>
        <Link
          href="/admin/discounts"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to discounts
        </Link>
        <CardTitle className="text-xl">
          Edit discount code{" "}
          <span className="font-mono text-base">{initial.code}</span>
        </CardTitle>
        <CardDescription>
          Update the code, type, value, restrictions, or activation. Saving
          immediately changes how the code behaves at checkout.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DiscountCodeForm initial={initial} />
      </CardContent>
    </Card>
  );
}
