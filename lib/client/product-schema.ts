import { z } from "zod";

/**
 * Client-side schema for the admin product create/edit form.
 *
 * The form lets admins type human-friendly values (e.g. "19.99" for
 * price) and the schema is the place where we coerce / normalise that
 * input into the integer-cents representation the API expects. Mirrors
 * the server contract in `lib/server/admin-products.ts`:
 *
 *   - `slug` — 2-200 chars, lower-case alphanumerics with single dashes.
 *   - `sku`  — 2-64 chars, upper-case alphanumerics + `-` / `_`.
 *   - `name` — 2-300 chars.
 *   - `description` — optional free text up to 20k chars.
 *   - `categoryId` — optional UUID (or null).
 *   - `price` / `compareAtPrice` — entered as dollars (e.g. "19.99"),
 *     stored as cents.
 *   - `stock` — non-negative integer up to 10_000_000.
 *   - `size` / `material` / `color` — optional flat strings up to 64.
 *   - `isFeatured` / `isNew` — booleans, default false.
 *   - `images` — array of `{ url, alt }` (each `url` non-empty).
 *
 * Server-side uniqueness collisions on slug / sku surface as 409 errors;
 * the form maps them to inline field errors.
 */

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKU_PATTERN = /^[A-Z0-9][A-Z0-9_-]*$/;
const DOLLARS_PATTERN = /^\d+(?:\.\d{1,2})?$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ProductImageFormValue {
  /** Stable id for React keys + reorder. New uploads get a `local-…` id. */
  id: string;
  /** URL returned by the upload endpoint, or an existing gallery URL. */
  url: string;
  /** Optional alt text. */
  alt: string;
  /** Server-assigned id when this image already exists; used by submits
   *  that want to preserve the row id (PUT replaces the gallery wholesale
   *  so this is informational only). */
  serverId?: string | null;
}

export const productImageFormValueSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1, "Image URL is required").max(2048, "URL is too long"),
  alt: z.string().max(300, "Alt text is too long"),
  serverId: z.string().nullish(),
});

export const productFormSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(2, "Slug must be at least 2 characters")
      .max(200, "Slug must be at most 200 characters"),
    sku: z
      .string()
      .trim()
      .min(2, "SKU must be at least 2 characters")
      .max(64, "SKU must be at most 64 characters"),
    name: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters")
      .max(300, "Name must be at most 300 characters"),
    description: z
      .string()
      .max(20_000, "Description is too long")
      .optional()
      .or(z.literal("")),
    categoryId: z.string().optional().or(z.literal("")),
    price: z
      .string()
      .trim()
      .min(1, "Price is required"),
    compareAtPrice: z
      .string()
      .trim()
      .optional()
      .or(z.literal("")),
    currency: z
      .string()
      .trim()
      .min(3, "Currency must be 3 letters")
      .max(3, "Currency must be 3 letters"),
    size: z.string().max(64, "Size is too long").optional().or(z.literal("")),
    material: z
      .string()
      .max(64, "Material is too long")
      .optional()
      .or(z.literal("")),
    color: z.string().max(64, "Color is too long").optional().or(z.literal("")),
    stock: z.string().trim().min(1, "Stock is required"),
    isFeatured: z.boolean().optional(),
    isNew: z.boolean().optional(),
    images: z.array(productImageFormValueSchema).max(24, "Up to 24 images"),
  })
  .superRefine((values, ctx) => {
    // slug — normalised pattern after lowercase
    const slug = values.slug.trim().toLowerCase();
    if (!SLUG_PATTERN.test(slug)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slug"],
        message: "Use lower-case letters, digits, and single dashes",
      });
    }

    // sku — normalised upper-case
    const sku = values.sku.trim().toUpperCase();
    if (!SKU_PATTERN.test(sku)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sku"],
        message:
          "Use upper-case letters, digits, '-' or '_' starting with an alphanumeric",
      });
    }

    // price (required dollar string)
    if (!DOLLARS_PATTERN.test(values.price)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["price"],
        message: "Enter a dollar amount (e.g. 19.99)",
      });
    } else if (Math.round(parseFloat(values.price) * 100) <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["price"],
        message: "Price must be greater than zero",
      });
    }

    // compareAtPrice (optional, must be greater than price when set)
    if (values.compareAtPrice && values.compareAtPrice.length > 0) {
      if (!DOLLARS_PATTERN.test(values.compareAtPrice)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["compareAtPrice"],
          message: "Enter a dollar amount (e.g. 24.99)",
        });
      } else {
        const compare = Math.round(parseFloat(values.compareAtPrice) * 100);
        const price = DOLLARS_PATTERN.test(values.price)
          ? Math.round(parseFloat(values.price) * 100)
          : 0;
        if (compare > 0 && price > 0 && compare <= price) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["compareAtPrice"],
            message:
              "Compare-at price must be greater than the regular price (or empty)",
          });
        }
      }
    }

    // currency — 3 uppercase letters
    if (!/^[A-Za-z]{3}$/.test(values.currency)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["currency"],
        message: "Currency must be a 3-letter ISO code",
      });
    }

    // stock — non-negative integer
    if (!/^\d+$/.test(values.stock)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stock"],
        message: "Enter a whole number of units in stock",
      });
    } else {
      const n = Number(values.stock);
      if (n < 0 || n > 10_000_000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stock"],
          message: "Stock must be between 0 and 10,000,000",
        });
      }
    }

    // categoryId — when present must be a UUID
    if (
      values.categoryId &&
      values.categoryId.length > 0 &&
      !UUID_RE.test(values.categoryId)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["categoryId"],
        message: "Pick a valid category",
      });
    }
  });

export type ProductFormValues = z.infer<typeof productFormSchema>;

/** Shape of the JSON body sent to `POST /api/admin/products` and
 *  `PUT /api/admin/products/{id}`. */
export interface ProductApiPayload {
  slug: string;
  sku: string;
  name: string;
  description: string;
  categoryId: string | null;
  priceCents: number;
  compareAtPriceCents: number | null;
  currency: string;
  size: string | null;
  material: string | null;
  color: string | null;
  stock: number;
  isFeatured: boolean;
  isNew: boolean;
  images: Array<{ url: string; alt: string | null; position: number }>;
}

export function toProductApiPayload(values: ProductFormValues): ProductApiPayload {
  const slug = values.slug.trim().toLowerCase();
  const sku = values.sku.trim().toUpperCase();
  const name = values.name.trim();
  const description = (values.description ?? "").trim();
  const categoryId =
    values.categoryId && values.categoryId.length > 0 ? values.categoryId : null;
  const priceCents = Math.round(parseFloat(values.price) * 100);
  const compareAtPriceCents =
    values.compareAtPrice && values.compareAtPrice.length > 0
      ? Math.round(parseFloat(values.compareAtPrice) * 100)
      : null;
  const currency = values.currency.trim().toUpperCase();
  const size = values.size && values.size.trim().length > 0 ? values.size.trim() : null;
  const material =
    values.material && values.material.trim().length > 0
      ? values.material.trim()
      : null;
  const color =
    values.color && values.color.trim().length > 0 ? values.color.trim() : null;
  const stock = Number(values.stock);
  const isFeatured = values.isFeatured ?? false;
  const isNew = values.isNew ?? false;
  const images = values.images.map((img, idx) => ({
    url: img.url,
    alt: img.alt && img.alt.trim().length > 0 ? img.alt.trim() : null,
    position: idx,
  }));

  return {
    slug,
    sku,
    name,
    description,
    categoryId,
    priceCents,
    compareAtPriceCents,
    currency,
    size,
    material,
    color,
    stock,
    isFeatured,
    isNew,
    images,
  };
}

/** "1999" → "19.99" — used to seed the form when editing. */
export function centsToDollarsField(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

/** Best-effort kebab-case slug from an arbitrary string. Empty → "". */
export function slugify(raw: string): string {
  return raw
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}
