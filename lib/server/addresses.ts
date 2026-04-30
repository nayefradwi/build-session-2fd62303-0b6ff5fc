/**
 * Server-side helpers for the addresses table.
 *
 * Centralises the validation schemas and the "only one default per user"
 * invariant logic so the route handlers stay small.
 */
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { addresses, type Address } from "@/lib/db/schema";

/** Two-letter ISO 3166-1 alpha-2 country code, normalised to upper case. */
const countryCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "Country must be a two-letter ISO code");

/** Trimmed string with optional length bounds. */
const trimmed = (min: number, max: number, label = "Field") =>
  z
    .string()
    .trim()
    .min(min, `${label} is required`)
    .max(max, `${label} is too long`);

/** Optional + nullable trimmed string. Empty string and null both clear the field. */
const optionalTrimmed = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      if (v === null) return null;
      return v.length === 0 ? null : v;
    });

/**
 * Address creation payload. All required postal fields must be present.
 * `isDefault` defaults to false; the routes apply additional logic so
 * the first address inserted for a user becomes the default automatically.
 */
export const createAddressSchema = z.object({
  label: optionalTrimmed(100),
  recipient: optionalTrimmed(200),
  phone: optionalTrimmed(40),
  line1: trimmed(1, 200, "Line 1"),
  line2: optionalTrimmed(200),
  city: trimmed(1, 120, "City"),
  state: optionalTrimmed(120),
  postalCode: trimmed(1, 32, "Postal code"),
  country: countryCode,
  isDefault: z.boolean().optional(),
});

/** Update payload — every field is optional. */
export const updateAddressSchema = z
  .object({
    label: optionalTrimmed(100),
    recipient: optionalTrimmed(200),
    phone: optionalTrimmed(40),
    line1: trimmed(1, 200, "Line 1").optional(),
    line2: optionalTrimmed(200),
    city: trimmed(1, 120, "City").optional(),
    state: optionalTrimmed(120),
    postalCode: trimmed(1, 32, "Postal code").optional(),
    country: countryCode.optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "At least one field must be provided",
  });

export type CreateAddressInput = z.infer<typeof createAddressSchema>;
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;

/**
 * Atomically demote any other default address belonging to the user.
 * Run inside the same logical operation as inserting/promoting the new
 * default so the partial unique index never sees two defaults at once.
 *
 * The Neon HTTP driver does not expose interactive transactions, so we
 * sequence the writes carefully: we always clear before promoting.
 */
export async function clearOtherDefaults(
  userId: string,
  exceptId?: string,
): Promise<void> {
  const filters = [eq(addresses.userId, userId), eq(addresses.isDefault, true)];
  const where = exceptId
    ? and(...filters, ne(addresses.id, exceptId))
    : and(...filters);
  await db
    .update(addresses)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(where);
}

/** Fetch every address for a user, default first then newest first. */
export async function listAddressesForUser(userId: string): Promise<Address[]> {
  const rows = await db
    .select()
    .from(addresses)
    .where(eq(addresses.userId, userId));
  // Sort in-memory: defaults first, then newest first by createdAt desc.
  return rows.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}

/** Fetch an address only if it belongs to the given user. */
export async function getOwnedAddress(
  userId: string,
  addressId: string,
): Promise<Address | null> {
  const rows = await db
    .select()
    .from(addresses)
    .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Count how many addresses a user currently has. */
export async function countAddressesForUser(userId: string): Promise<number> {
  const rows = await db
    .select({ id: addresses.id })
    .from(addresses)
    .where(eq(addresses.userId, userId));
  return rows.length;
}
