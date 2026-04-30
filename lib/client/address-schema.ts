import { z } from "zod";

/**
 * Client-side validation for the addresses CRUD form.
 *
 * Mirrors the server contract in `lib/server/addresses.ts` so users get
 * inline validation without a round-trip. The server is still the source
 * of truth — these schemas match the same minimum lengths, the same
 * two-letter ISO country code, and the same trim semantics.
 *
 * The form uses string fields throughout (no nullable inputs) because
 * react-hook-form + native <input> elements deal in strings. Empty
 * optional strings are passed through as `undefined` when serialised so
 * the server's `optionalTrimmed` clears the column to NULL.
 */
const trimmedRequired = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .min(min, `${label} is required`)
    .max(max, `${label} is too long`);

const trimmedOptional = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long`)
    .optional()
    .or(z.literal(""));

/**
 * Two-letter ISO 3166-1 alpha-2 country code. We coerce to upper case
 * so "us" + "US" both validate the same way.
 */
const countryCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "Country must be a two-letter ISO code (e.g. US)");

/** Shared schema for both create and edit address forms. */
export const addressFormSchema = z.object({
  label: trimmedOptional(100, "Label"),
  recipient: trimmedOptional(200, "Recipient"),
  phone: trimmedOptional(40, "Phone"),
  line1: trimmedRequired(1, 200, "Line 1"),
  line2: trimmedOptional(200, "Line 2"),
  city: trimmedRequired(1, 120, "City"),
  state: trimmedOptional(120, "State"),
  postalCode: trimmedRequired(1, 32, "Postal code"),
  country: countryCode,
  isDefault: z.boolean().optional(),
});

export type AddressFormValues = z.infer<typeof addressFormSchema>;

/** Empty defaults used when the user opens "add address". */
export const emptyAddressFormValues: AddressFormValues = {
  label: "",
  recipient: "",
  phone: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "",
  isDefault: false,
};

/**
 * Translate the form values into the JSON payload the API expects.
 *
 * Empty optional strings are dropped to `undefined` so the backend's
 * `optionalTrimmed` parser receives a missing field rather than an
 * empty string. The server treats empty strings as "clear to null", so
 * either form would work for edits — but for creates we want to omit
 * the field entirely to keep the payload tidy.
 */
export function toAddressApiPayload(values: AddressFormValues) {
  const optional = (v: string | undefined): string | undefined =>
    v && v.trim().length > 0 ? v.trim() : undefined;

  return {
    label: optional(values.label),
    recipient: optional(values.recipient),
    phone: optional(values.phone),
    line1: values.line1.trim(),
    line2: optional(values.line2),
    city: values.city.trim(),
    state: optional(values.state),
    postalCode: values.postalCode.trim(),
    country: values.country.trim().toUpperCase(),
    isDefault: values.isDefault === true ? true : undefined,
  };
}

