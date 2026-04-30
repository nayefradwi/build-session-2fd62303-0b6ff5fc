import type { Metadata } from "next";

import { AddressesManager } from "@/components/account/addresses-manager";
import type { Address } from "@/components/account/types";
import { listAddressesForUser } from "@/lib/server/addresses";
import { requireUser } from "@/lib/server/auth";

export const metadata: Metadata = {
  title: "Addresses",
  description: "Manage your shipping addresses.",
};

export const dynamic = "force-dynamic";

/**
 * Serialise a Drizzle `addresses` row into the shape the client UI
 * works with. Dates are stringified so the props can cross the
 * server → client boundary without serialisation warnings.
 */
function serialiseAddress(
  row: Awaited<ReturnType<typeof listAddressesForUser>>[number],
): Address {
  return {
    id: row.id,
    userId: row.userId,
    label: row.label,
    recipient: row.recipient,
    phone: row.phone,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    country: row.country,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * `/account/addresses` — list and manage shipping addresses.
 *
 * The server fetches the initial list directly via the Drizzle helper
 * so the first paint already has the user's addresses. The client
 * component then takes over for mutations, refetching from the API
 * after each one to stay aligned with the server's view.
 */
export default async function AccountAddressesPage() {
  const user = await requireUser();
  const rows = await listAddressesForUser(user.id);
  const initial = rows.map(serialiseAddress);

  return <AddressesManager initialAddresses={initial} />;
}
