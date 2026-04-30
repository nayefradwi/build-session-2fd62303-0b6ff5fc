"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  GripVertical,
  Loader2,
  Move,
  Star,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  AdminProduct,
  AdminProductApiError,
  AdminProductCategoryOption,
} from "@/components/admin/product-types";
import {
  centsToDollarsField,
  productFormSchema,
  slugify,
  toProductApiPayload,
  type ProductFormValues,
} from "@/lib/client/product-schema";

interface ProductFormProps {
  /** When provided we run in "edit" mode: the form is seeded with the
   *  existing values and the submit hits PUT instead of POST. */
  initial?: AdminProduct;
  categories: AdminProductCategoryOption[];
}

interface ProductApiSuccess {
  product: AdminProduct;
}

/**
 * Map the server's `fieldErrors` into the form's per-field error map.
 * Server uses dotted paths (`images[0].url`); the form stores image
 * errors on the `images` array root, so we collapse those.
 */
function flattenServerErrors(
  fieldErrors: Record<string, string[]> | undefined,
): Partial<Record<keyof ProductFormValues, string>> {
  const result: Partial<Record<keyof ProductFormValues, string>> = {};
  if (!fieldErrors) return result;
  const known: ReadonlyArray<keyof ProductFormValues> = [
    "slug",
    "sku",
    "name",
    "description",
    "categoryId",
    "price",
    "compareAtPrice",
    "currency",
    "size",
    "material",
    "color",
    "stock",
    "isFeatured",
    "isNew",
    "images",
  ];
  for (const [serverKey, messages] of Object.entries(fieldErrors)) {
    const message = messages?.[0];
    if (!message) continue;

    // map server keys to form keys
    let formKey: keyof ProductFormValues | null = null;
    if (serverKey === "priceCents") formKey = "price";
    else if (serverKey === "compareAtPriceCents") formKey = "compareAtPrice";
    else if (serverKey.startsWith("images")) formKey = "images";
    else if ((known as readonly string[]).includes(serverKey)) {
      formKey = serverKey as keyof ProductFormValues;
    }

    if (formKey && !result[formKey]) result[formKey] = message;
  }
  return result;
}

function buildDefaults(initial: AdminProduct | undefined): ProductFormValues {
  if (!initial) {
    return {
      slug: "",
      sku: "",
      name: "",
      description: "",
      categoryId: "",
      price: "",
      compareAtPrice: "",
      currency: "USD",
      size: "",
      material: "",
      color: "",
      stock: "0",
      isFeatured: false,
      isNew: false,
      images: [],
    };
  }
  return {
    slug: initial.slug,
    sku: initial.sku,
    name: initial.name,
    description: initial.description ?? "",
    categoryId: initial.category?.id ?? "",
    price: centsToDollarsField(initial.priceCents),
    compareAtPrice: centsToDollarsField(initial.compareAtPriceCents),
    currency: initial.currency,
    size: initial.size ?? "",
    material: initial.material ?? "",
    color: initial.color ?? "",
    stock: String(initial.stock ?? 0),
    isFeatured: initial.isFeatured,
    isNew: initial.isNew,
    images: initial.images.map((img) => ({
      id: img.id,
      url: img.url,
      alt: img.alt ?? "",
      serverId: img.id,
    })),
  };
}

/** Drag-and-drop image bay. Manages the gallery rows directly via the
 *  parent's `useFieldArray` controls. */
function ImageGallery({
  images,
  onAdd,
  onRemove,
  onAltChange,
  onMove,
  uploading,
  disabled,
  uploadError,
}: {
  images: ProductFormValues["images"];
  onAdd: (files: FileList | File[]) => void;
  onRemove: (index: number) => void;
  onAltChange: (index: number, alt: string) => void;
  onMove: (from: number, to: number) => void;
  uploading: boolean;
  disabled: boolean;
  uploadError: string | null;
}) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = React.useState(false);

  const handleDrop: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    onAdd(e.dataTransfer.files);
  };

  const handleRowDragStart = (
    e: React.DragEvent<HTMLLIElement>,
    index: number,
  ) => {
    e.dataTransfer.setData("text/plain", String(index));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleRowDrop = (
    e: React.DragEvent<HTMLLIElement>,
    index: number,
  ) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData("text/plain");
    const from = Number(raw);
    if (Number.isNaN(from) || from === index) return;
    onMove(from, index);
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-6 text-center transition-colors ${
          dragOver
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/30 bg-muted/20"
        }`}
        data-testid="product-image-dropzone"
      >
        <UploadCloud
          className="h-6 w-6 text-muted-foreground"
          aria-hidden="true"
        />
        <p className="text-sm font-medium">
          Drag &amp; drop images, or{" "}
          <button
            type="button"
            className="text-primary underline-offset-2 hover:underline"
            disabled={disabled || uploading}
            onClick={() => inputRef.current?.click()}
          >
            browse
          </button>
        </p>
        <p className="text-xs text-muted-foreground">
          PNG, JPG, WebP, GIF, AVIF · up to 10 MB each · max 24 images
        </p>
        {uploading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Uploading…
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              onAdd(e.target.files);
            }
            // Allow re-uploading the same file by clearing the input.
            e.target.value = "";
          }}
          data-testid="product-image-input"
        />
      </div>

      {uploadError && (
        <p className="text-xs text-destructive" role="alert">
          {uploadError}
        </p>
      )}

      {images.length > 0 && (
        <ul
          className="grid gap-3 sm:grid-cols-2"
          data-testid="product-image-list"
        >
          {images.map((image, index) => (
            <li
              key={image.id}
              draggable
              onDragStart={(e) => handleRowDragStart(e, index)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => handleRowDrop(e, index)}
              className="flex flex-col gap-2 rounded-md border bg-card p-3"
              data-testid={`product-image-row-${index}`}
            >
              <div className="flex items-center gap-3">
                <span
                  className="flex h-6 w-6 cursor-grab items-center justify-center rounded text-muted-foreground hover:text-foreground"
                  aria-hidden="true"
                  title="Drag to reorder"
                >
                  <GripVertical className="h-4 w-4" />
                </span>
                <div className="relative h-16 w-16 flex-none overflow-hidden rounded border bg-muted">
                  {image.url ? (
                    <Image
                      src={image.url}
                      alt={image.alt}
                      fill
                      sizes="64px"
                      className="object-cover"
                      unoptimized
                    />
                  ) : null}
                </div>
                <div className="flex flex-1 flex-col gap-1 text-xs">
                  <span className="line-clamp-1 break-all font-mono">
                    {image.url}
                  </span>
                  {index === 0 && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300">
                      <Star className="h-3 w-3" aria-hidden="true" />
                      Primary thumbnail
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => onMove(index, Math.max(0, index - 1))}
                    disabled={index === 0}
                    aria-label="Move image up"
                    title="Move up"
                  >
                    <Move className="h-4 w-4 -rotate-90" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      onMove(index, Math.min(images.length - 1, index + 1))
                    }
                    disabled={index === images.length - 1}
                    aria-label="Move image down"
                    title="Move down"
                  >
                    <Move className="h-4 w-4 rotate-90" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => onRemove(index)}
                    aria-label="Remove image"
                    title="Remove"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div>
                <Label
                  htmlFor={`image-alt-${image.id}`}
                  className="text-xs text-muted-foreground"
                >
                  Alt text
                </Label>
                <Input
                  id={`image-alt-${image.id}`}
                  type="text"
                  placeholder="Describe this image for accessibility"
                  value={image.alt}
                  onChange={(e) => onAltChange(index, e.target.value)}
                  className="mt-1 h-8 text-xs"
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Admin create / edit form for a single product.
 *
 * Submits to:
 *   - `POST /api/admin/products` in create mode
 *   - `PUT  /api/admin/products/{id}` in edit mode
 *
 * Image uploads go through `/api/admin/uploads` (Vercel Blob in
 * production; deterministic placeholder URLs in dev). The returned URL
 * is stashed in the gallery state and submitted alongside the rest of
 * the payload — the API replaces the gallery wholesale.
 *
 * Successful submits navigate back to `/admin/products` and call
 * `router.refresh()` so the list reflects the new state immediately. We
 * also issue an additional refresh so the storefront's server-rendered
 * pages re-query (delete / edit are both visible to shoppers).
 */
export function ProductForm({ initial, categories }: ProductFormProps) {
  const router = useRouter();
  const isEdit = !!initial;
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const slugTouched = React.useRef(!!initial);

  const defaults = React.useMemo(() => buildDefaults(initial), [initial]);

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    mode: "onTouched",
    defaultValues: defaults,
  });

  React.useEffect(() => {
    form.reset(defaults);
    slugTouched.current = !!initial;
  }, [form, defaults, initial]);

  const imagesArray = useFieldArray<ProductFormValues, "images", "id">({
    control: form.control,
    name: "images",
    keyName: "id",
  });

  const watchedImages = form.watch("images") ?? [];

  // When the admin types a name in create mode, auto-fill the slug
  // (until the slug field is touched manually).
  const watchedName = form.watch("name");
  React.useEffect(() => {
    if (slugTouched.current) return;
    if (isEdit) return;
    const next = slugify(watchedName ?? "");
    if (next !== form.getValues("slug")) {
      form.setValue("slug", next, { shouldDirty: true });
    }
  }, [watchedName, form, isEdit]);

  const handleAddImages = React.useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      const remainingSlots = 24 - imagesArray.fields.length;
      if (remainingSlots <= 0) {
        setUploadError("You've reached the 24-image limit.");
        return;
      }
      const accepted = list.slice(0, remainingSlots);
      if (accepted.length < list.length) {
        setUploadError(
          `Only the first ${accepted.length} of ${list.length} files fit; the rest were skipped.`,
        );
      } else {
        setUploadError(null);
      }
      setUploading(true);
      try {
        for (const file of accepted) {
          const fd = new FormData();
          fd.append("file", file);
          const res = await fetch("/api/admin/uploads", {
            method: "POST",
            credentials: "same-origin",
            body: fd,
          });
          if (!res.ok) {
            let body: AdminProductApiError | null = null;
            try {
              body = (await res.json()) as AdminProductApiError;
            } catch {
              // not JSON
            }
            const description =
              body?.error ?? `Upload failed (${res.status})`;
            setUploadError(description);
            toast.error("Couldn't upload image", { description });
            continue;
          }
          const data = (await res.json()) as { url: string };
          imagesArray.append({
            id: `local-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            url: data.url,
            alt: "",
            serverId: null,
          });
        }
      } catch (err) {
        const description =
          err instanceof Error
            ? err.message
            : "Could not reach the server. Please try again.";
        setUploadError(description);
        toast.error("Network error", { description });
      } finally {
        setUploading(false);
      }
    },
    [imagesArray],
  );

  const handleRemoveImage = (index: number) => {
    imagesArray.remove(index);
  };

  const handleMoveImage = (from: number, to: number) => {
    if (from === to) return;
    imagesArray.move(from, to);
  };

  const handleAltChange = (index: number, alt: string) => {
    form.setValue(`images.${index}.alt`, alt, { shouldDirty: true });
  };

  const onSubmit = async (values: ProductFormValues) => {
    const payload = toProductApiPayload(values);
    const url = isEdit
      ? `/api/admin/products/${initial.id}`
      : "/api/admin/products";
    const method = isEdit ? "PUT" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let body: AdminProductApiError | null = null;
        try {
          body = (await res.json()) as AdminProductApiError;
        } catch {
          // not JSON
        }

        if (res.status === 401) {
          toast.error("Session expired", {
            description: "Please sign in again to continue.",
          });
          router.replace("/login?next=/admin/products");
          return;
        }
        if (res.status === 403) {
          toast.error("Admin access required", {
            description:
              "Your account doesn't have permission for this action.",
          });
          return;
        }
        if (res.status === 409 && body?.code === "slug_taken") {
          form.setError("slug", {
            type: "server",
            message: "A product with that slug already exists.",
          });
          toast.error("Slug already in use");
          return;
        }
        if (res.status === 409 && body?.code === "sku_taken") {
          form.setError("sku", {
            type: "server",
            message: "A product with that SKU already exists.",
          });
          toast.error("SKU already in use");
          return;
        }

        if (body?.fieldErrors) {
          for (const [field, message] of Object.entries(
            flattenServerErrors(body.fieldErrors),
          )) {
            form.setError(field as keyof ProductFormValues, {
              type: "server",
              message,
            });
          }
        }

        toast.error(
          isEdit ? "Couldn't update product" : "Couldn't create product",
          {
            description:
              body?.error ?? "Something went wrong. Please try again.",
          },
        );
        return;
      }

      const data = (await res.json()) as ProductApiSuccess;
      toast.success(isEdit ? "Product updated" : "Product created", {
        description: `${data.product.name} saved successfully.`,
      });
      // Refresh the list AND the storefront pages that read from the
      // catalog. router.refresh() invalidates the active route's RSC
      // cache, so once we push back to /admin/products the list
      // re-renders against the new server snapshot.
      router.push("/admin/products");
      router.refresh();
    } catch (err) {
      toast.error("Network error", {
        description:
          err instanceof Error
            ? err.message
            : "Could not reach the server. Please try again.",
      });
    }
  };

  const isSubmitting = form.formState.isSubmitting;

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-6"
        data-testid="product-form"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input
                    type="text"
                    placeholder="Linen blazer"
                    disabled={isSubmitting}
                    {...field}
                    data-testid="product-name-input"
                  />
                </FormControl>
                <FormDescription>
                  Customer-facing display name. 2-300 characters.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="slug"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Slug</FormLabel>
                <FormControl>
                  <Input
                    type="text"
                    autoComplete="off"
                    placeholder="linen-blazer"
                    disabled={isSubmitting}
                    {...field}
                    onChange={(e) => {
                      slugTouched.current = true;
                      field.onChange(e.target.value);
                    }}
                    data-testid="product-slug-input"
                  />
                </FormControl>
                <FormDescription>
                  URL identifier — auto-filled from the name on create.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="sku"
            render={({ field }) => (
              <FormItem>
                <FormLabel>SKU</FormLabel>
                <FormControl>
                  <Input
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="LIN-BLZ-001"
                    disabled={isSubmitting}
                    {...field}
                    onChange={(e) =>
                      field.onChange(e.target.value.toUpperCase())
                    }
                    data-testid="product-sku-input"
                  />
                </FormControl>
                <FormDescription>
                  Internal stock-keeping unit. Upper-case only.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <textarea
                    rows={5}
                    className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="Long-form product description shown on the PDP."
                    disabled={isSubmitting}
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormDescription>
                  Markdown is rendered as plain text. Up to 20,000
                  characters.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="categoryId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Category</FormLabel>
                <FormControl>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isSubmitting}
                    {...field}
                    value={field.value ?? ""}
                    data-testid="product-category-select"
                  >
                    <option value="">Uncategorized</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </FormControl>
                <FormDescription>
                  Drives storefront category pages and faceted search.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="currency"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Currency</FormLabel>
                <FormControl>
                  <Input
                    type="text"
                    placeholder="USD"
                    maxLength={3}
                    disabled={isSubmitting}
                    {...field}
                    onChange={(e) =>
                      field.onChange(e.target.value.toUpperCase())
                    }
                  />
                </FormControl>
                <FormDescription>3-letter ISO code.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="price"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Price (USD)</FormLabel>
                <FormControl>
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="49.99"
                    disabled={isSubmitting}
                    {...field}
                    data-testid="product-price-input"
                  />
                </FormControl>
                <FormDescription>
                  Customer-facing price. Stored as integer cents.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="compareAtPrice"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Compare-at price</FormLabel>
                <FormControl>
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="69.99"
                    disabled={isSubmitting}
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormDescription>
                  Strike-through price shown when on sale. Leave blank
                  for none.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="stock"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Stock</FormLabel>
                <FormControl>
                  <Input
                    type="text"
                    inputMode="numeric"
                    placeholder="50"
                    disabled={isSubmitting}
                    {...field}
                    data-testid="product-stock-input"
                  />
                </FormControl>
                <FormDescription>
                  Units on hand. 0 marks the product out of stock.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="size"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Size</FormLabel>
                <FormControl>
                  <Input
                    type="text"
                    placeholder="M"
                    disabled={isSubmitting}
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormDescription>Optional variant axis.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="material"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Material</FormLabel>
                <FormControl>
                  <Input
                    type="text"
                    placeholder="Linen"
                    disabled={isSubmitting}
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormDescription>Optional variant axis.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="color"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Color</FormLabel>
                <FormControl>
                  <Input
                    type="text"
                    placeholder="Sand"
                    disabled={isSubmitting}
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormDescription>Optional variant axis.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="isFeatured"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-start gap-3 rounded-md border p-3">
                  <FormControl>
                    <input
                      id="product-featured"
                      type="checkbox"
                      className="mt-1 h-4 w-4 cursor-pointer rounded border-input"
                      disabled={isSubmitting}
                      checked={field.value ?? false}
                      onChange={(e) => field.onChange(e.target.checked)}
                      data-testid="product-featured-input"
                    />
                  </FormControl>
                  <div className="space-y-1">
                    <Label
                      htmlFor="product-featured"
                      className="cursor-pointer text-sm font-medium"
                    >
                      Featured
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Surfaces on the home page and the
                      &ldquo;featured&rdquo; storefront filter.
                    </p>
                  </div>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="isNew"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-start gap-3 rounded-md border p-3">
                  <FormControl>
                    <input
                      id="product-new"
                      type="checkbox"
                      className="mt-1 h-4 w-4 cursor-pointer rounded border-input"
                      disabled={isSubmitting}
                      checked={field.value ?? false}
                      onChange={(e) => field.onChange(e.target.checked)}
                      data-testid="product-new-input"
                    />
                  </FormControl>
                  <div className="space-y-1">
                    <Label
                      htmlFor="product-new"
                      className="cursor-pointer text-sm font-medium"
                    >
                      New arrival
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Adds a &ldquo;New&rdquo; badge to the product card
                      and the &ldquo;new arrivals&rdquo; carousel.
                    </p>
                  </div>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <Label className="text-sm font-medium">Images</Label>
            <span className="text-xs text-muted-foreground">
              {watchedImages.length} of 24
            </span>
          </div>
          <ImageGallery
            images={watchedImages}
            onAdd={handleAddImages}
            onRemove={handleRemoveImage}
            onAltChange={handleAltChange}
            onMove={handleMoveImage}
            uploading={uploading}
            disabled={isSubmitting}
            uploadError={uploadError}
          />
          <FormField
            control={form.control}
            name="images"
            render={() => (
              <FormItem>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            disabled={isSubmitting || uploading}
            data-testid="product-submit"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : isEdit ? (
              "Save changes"
            ) : (
              "Create product"
            )}
          </Button>
          <Button asChild type="button" variant="ghost">
            <Link href="/admin/products">Cancel</Link>
          </Button>
        </div>
      </form>
    </Form>
  );
}
