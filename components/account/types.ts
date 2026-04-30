/**
 * Shared client-side types for the /account UI. These mirror the JSON
 * shape returned by the addresses API (`/api/users/me/addresses`),
 * which is the Drizzle row with `Date` columns serialised to ISO
 * strings on the wire.
 */
export interface Address {
  id: string;
  userId: string;
  label: string | null;
  recipient: string | null;
  phone: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postalCode: string;
  country: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}
