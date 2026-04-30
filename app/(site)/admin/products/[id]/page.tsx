import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";

import { ProductForm } from "@/components/admin/product-form";
import type {
  AdminProduct,
  AdminProductCategoryOption,
} from "@/components/admin/product-types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getAdminProduct } from "@/lib/server/admin-products";
import { listCategories } from "@/lib/server/admin-categories";

export const metadata: Metadata = {
  title: "Edit product",
  description: "Edit an existing product.",
};

export const dynamic = "force-dynamic";

interface EditProductPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Admin > Products > Edit.
 *
 * Server component — loads the row by id (or slug; the helper resolves
 * both). 404s on unknown ids; passes the canonical row to the form,
 * which handles its own submit / error / success path.
 */
export default async function EditProductPage({
  params,
}: EditProductPageProps) {
  const { id } = await params;
  if (!id) notFound();
  const [row, categoriesResult] = await Promise.all([
    getAdminProduct(id),
    listCategories(),
  ]);
  if (!row) notFound();

  // Server payload structurally matches the client `AdminProduct` shape.
  const initial: AdminProduct = row as AdminProduct;
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
        <CardTitle className="text-xl">
          Edit{" "}
          <span className="font-mono text-base">{initial.sku}</span> ·{" "}
          {initial.name}
        </CardTitle>
        <CardDescription>
          Update attributes, swap images, change stock, or toggle
          merchandising flags. Saving immediately propagates to the
          storefront.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ProductForm initial={initial} categories={categoryOptions} />
      </CardContent>
    </Card>
  );
}
