import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";

import { ProductForm } from "@/components/admin/product-form";
import type { AdminProductCategoryOption } from "@/components/admin/product-types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listCategories } from "@/lib/server/admin-categories";

export const metadata: Metadata = {
  title: "New product",
  description: "Create a new product for the catalog.",
};

export const dynamic = "force-dynamic";

/**
 * Admin > Products > New.
 *
 * Renders the create form. The `/admin` layout already enforces the
 * admin role check, and the API endpoint enforces it again on submit —
 * this page just builds the editor.
 */
export default async function NewProductPage() {
  const categoriesResult = await listCategories();
  const categoryOptions: AdminProductCategoryOption[] =
    categoriesResult.items.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      parentId: c.parentId,
    }));

  return (
    <Card>
      <CardHeader>
        <Link
          href="/admin/products"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to products
        </Link>
        <CardTitle className="text-xl">New product</CardTitle>
        <CardDescription>
          Configure the customer-facing details, stock, merchandising
          flags, and image gallery.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ProductForm categories={categoryOptions} />
      </CardContent>
    </Card>
  );
}
