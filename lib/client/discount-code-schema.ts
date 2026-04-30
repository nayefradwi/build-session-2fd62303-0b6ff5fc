import { z } from "zod";

/**
 * Client-side schema for the admin discount-code create/edit form.
 *
 * The form lets admins type human-friendly values (e.g. "10" for 10% off
 * and "$50.00" for the minimum order) and the schema is the place where
 * we coerce / normalise that input into the integer cents / count
 * representation the API expects.
 *
 * Mirrors the server contract in `lib/server/discount-codes.ts`:
 *   - `code` — 3-64 chars, A-Z 0-9 `-` `_`, normalised upper-case.
 *   - `type` — "percentage" | "fixed".
 *   - `value`:
 *       * percentage — 1-100 (whole-percent integer)
 *       * fixed      — entered as dollars (e.g. "5.00"), stored as cents.
 *   - `minOrderValue` — optional dollars; converted to cents (or null).
 *   - `expiresAt` — optional `YYYY-MM-DDTHH:MM` (datetime-local). Stored
 *     as ISO 8601 with timezone offset.
 *   - `usageLimit` — optional positive integer (or null).
 *   - `description` — optional free-text, trimmed.
 *   - `isActive` — boolean, defaults to true on create.
 *
 * Server stays the source of truth for things we can't check locally
 * (uniqueness collisions). Those errors come back as `code_taken` and
 * are surfaced as inline field errors by the form component.
 */

export const DISCOUNT_CODE_TYPES = ["percentage", "fixed"] as const;
export type DiscountCodeFormType = (typeof DISCOUNT_CODE_TYPES)[number];

/**
 * Optional decimal-dollar field (e.g. "12.34"). Accepts an empty string
 * meaning "no value" and emits a discriminated `{ kind, value? }` shape
 * the submit handler can map straight into the JSON body.
 *
 * The cents representation is `Math.round(dollars * 100)` — the input
 * pattern restricts to two decimals so this never floats off by one.
 */
const DOLLARS_PATTERN = /^\d+(?:\.\d{1,2})?$/;

function dollarsToCents(raw: string): number {
  // Already validated against DOLLARS_PATTERN — parseFloat is safe.
  const n = parseFloat(raw);
  return Math.round(n * 100);
}

export const discountCodeFormSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3, "Code must be at least 3 characters")
      .max(64, "Code must be at most 64 characters")
      .regex(
        // Accept both cases on input — `toDiscountCodeApiPayload` and the
        // server normalise to upper-case, so admins can type either way.
        /^[A-Za-z0-9_-]+$/,
        "Use only letters, digits, '-' or '_'",
      ),
    type: z.enum(DISCOUNT_CODE_TYPES, {
      errorMap: () => ({ message: "Pick a discount type" }),
    }),
    /**
     * Percentage form: integer 1-100. Fixed form: dollar string.
     * We use a string here so the UI can render an empty field rather
     * than a forced "0".
     */
    value: z
      .string()
      .trim()
      .min(1, "Value is required"),
    minOrderValue: z
      .string()
      .trim()
      .optional()
      .or(z.literal("")),
    expiresAt: z
      .string()
      .trim()
      .optional()
      .or(z.literal("")),
    usageLimit: z
      .string()
      .trim()
      .optional()
      .or(z.literal("")),
    description: z
      .string()
      .max(2000, "Description must be at most 2000 characters")
      .optional()
      .or(z.literal("")),
    isActive: z.boolean().optional(),
  })
  .superRefine((values, ctx) => {
    // value, validated against the chosen type
    if (values.type === "percentage") {
      if (!/^\d+$/.test(values.value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["value"],
          message: "Enter a whole number between 1 and 100",
        });
      } else {
        const n = Number(values.value);
        if (n < 1 || n > 100) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["value"],
            message: "Percentage must be between 1 and 100",
          });
        }
      }
    } else if (values.type === "fixed") {
      if (!DOLLARS_PATTERN.test(values.value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["value"],
          message: "Enter a dollar amount (e.g. 5.00)",
        });
      } else if (dollarsToCents(values.value) <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["value"],
          message: "Value must be greater than zero",
        });
      }
    }

    // minOrderValue (optional)
    if (values.minOrderValue && values.minOrderValue.length > 0) {
      if (!DOLLARS_PATTERN.test(values.minOrderValue)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["minOrderValue"],
          message: "Enter a dollar amount (e.g. 50.00)",
        });
      }
    }

    // usageLimit (optional)
    if (values.usageLimit && values.usageLimit.length > 0) {
      if (!/^\d+$/.test(values.usageLimit)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["usageLimit"],
          message: "Enter a whole number",
        });
      } else if (Number(values.usageLimit) <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["usageLimit"],
          message: "Usage limit must be greater than zero",
        });
      }
    }

    // expiresAt (optional, datetime-local YYYY-MM-DDTHH:MM)
    if (values.expiresAt && values.expiresAt.length > 0) {
      const d = new Date(values.expiresAt);
      if (Number.isNaN(d.getTime())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["expiresAt"],
          message: "Enter a valid date and time",
        });
      }
    }
  });

export type DiscountCodeFormValues = z.infer<typeof discountCodeFormSchema>;

/**
 * Shape of the JSON body sent to `POST /api/admin/discount-codes` and
 * `PUT /api/admin/discount-codes/{id}`. Mirrors the server's Zod schema
 * so adapters in either direction are total.
 */
export interface DiscountCodeApiPayload {
  code: string;
  type: DiscountCodeFormType;
  value: number;
  minOrderValue: number | null;
  expiresAt: string | null;
  usageLimit: number | null;
  description: string | null;
  isActive?: boolean;
}

/**
 * Convert a validated `DiscountCodeFormValues` into the API payload.
 * Empty strings collapse to `null` so the server clears the column.
 *
 * Date conversion uses `new Date(local).toISOString()`. The browser
 * interprets `datetime-local` input in the local zone, so the resulting
 * ISO string is the right UTC instant for that wall clock — which is
 * exactly what the server stores.
 */
export function toDiscountCodeApiPayload(
  values: DiscountCodeFormValues,
): DiscountCodeApiPayload {
  const codeNormalised = values.code.trim().toUpperCase();
  const value =
    values.type === "percentage"
      ? Number(values.value)
      : Math.round(parseFloat(values.value) * 100);

  const minOrderValue =
    values.minOrderValue && values.minOrderValue.length > 0
      ? Math.round(parseFloat(values.minOrderValue) * 100)
      : null;

  const expiresAt =
    values.expiresAt && values.expiresAt.length > 0
      ? new Date(values.expiresAt).toISOString()
      : null;

  const usageLimit =
    values.usageLimit && values.usageLimit.length > 0
      ? Number(values.usageLimit)
      : null;

  const description =
    values.description && values.description.trim().length > 0
      ? values.description.trim()
      : null;

  return {
    code: codeNormalised,
    type: values.type,
    value,
    minOrderValue,
    expiresAt,
    usageLimit,
    description,
    isActive: values.isActive ?? true,
  };
}

/**
 * Format an integer cents value as a plain "12.34" string for an
 * editable form field. Used to seed the form when editing an existing
 * code so the admin sees the same number they originally typed.
 */
export function centsToDollarsField(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

/**
 * Format an ISO 8601 timestamp as `YYYY-MM-DDTHH:MM` for an
 * `<input type="datetime-local">` field. Returns "" for null inputs.
 *
 * Uses local-zone components so what the admin sees in the field
 * matches the time they originally typed.
 */
export function isoToDatetimeLocalField(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}
