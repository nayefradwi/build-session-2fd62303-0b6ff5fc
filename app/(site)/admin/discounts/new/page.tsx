import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";

import { DiscountCodeForm } from "@/components/admin/discount-code-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "New discount code",
  description: "Create a new promo code for checkout.",
};

export const dynamic = "force-dynamic";

/**
 * Admin > Discounts > New.
 *
 * Renders the create form. The `/admin` layout already enforces the
 * admin role check, and the API endpoint enforces it again on submit —
 * this page just builds the editor.
 */
export default function NewDiscountPage() {
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
        <CardTitle className="text-xl">New discount code</CardTitle>
        <CardDescription>
          Configure how this code reduces a customer&apos;s order. Codes
          are normalised upper-case and must be unique.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DiscountCodeForm />
      </CardContent>
    </Card>
  );
}
