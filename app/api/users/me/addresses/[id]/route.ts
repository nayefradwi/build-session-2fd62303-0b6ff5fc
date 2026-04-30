import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { addresses } from "@/lib/db/schema";
import {
  AuthRequiredError,
  requireUser,
} from "@/lib/server/auth";
import {
  clearOtherDefaults,
  getOwnedAddress,
  updateAddressSchema,
} from "@/lib/server/addresses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ErrorBody {
  error: string;
  code: string;
  fieldErrors?: Record<string, string[]>;
}

function errorResponse(
  status: number,
  body: ErrorBody,
): NextResponse<ErrorBody> {
  return NextResponse.json(body, { status });
}

function unauthorized(): NextResponse<ErrorBody> {
  return errorResponse(401, {
    error: "Authentication required",
    code: "unauthenticated",
  });
}

function notFound(): NextResponse<ErrorBody> {
  return errorResponse(404, {
    error: "Address not found",
    code: "not_found",
  });
}

/**
 * UUID v4-ish guard so a malformed id never reaches the DB driver.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/users/me/addresses/[id]
 *
 * Return a single address owned by the authenticated user.
 */
export async function GET(_req: Request, ctx: RouteParams) {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    throw err;
  }
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return notFound();

  const row = await getOwnedAddress(user.id, id);
  if (!row) return notFound();
  return NextResponse.json({ address: row }, { status: 200 });
}

/**
 * PUT /api/users/me/addresses/[id]
 *
 * Update an address owned by the authenticated user. Promoting an
 * address to default first demotes the previous default (excluding the
 * current row) so the partial unique index stays satisfied.
 */
export async function PUT(req: Request, ctx: RouteParams) {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    throw err;
  }
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return notFound();

  const existing = await getOwnedAddress(user.id, id);
  if (!existing) return notFound();

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return errorResponse(400, {
      error: "Request body must be valid JSON",
      code: "invalid_json",
    });
  }

  const parsed = updateAddressSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(400, {
      error: "Invalid address payload",
      code: "validation_failed",
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  const data = parsed.data;

  // Build the update set, only including provided fields.
  const updates: Partial<typeof addresses.$inferInsert> & {
    updatedAt?: Date;
  } = { updatedAt: new Date() };

  if (data.label !== undefined) updates.label = data.label;
  if (data.recipient !== undefined) updates.recipient = data.recipient;
  if (data.phone !== undefined) updates.phone = data.phone;
  if (data.line1 !== undefined) updates.line1 = data.line1;
  if (data.line2 !== undefined) updates.line2 = data.line2;
  if (data.city !== undefined) updates.city = data.city;
  if (data.state !== undefined) updates.state = data.state;
  if (data.postalCode !== undefined) updates.postalCode = data.postalCode;
  if (data.country !== undefined) updates.country = data.country;

  // Default-flag handling.
  // - true  → demote any other default first, then promote this row.
  // - false → only allowed if another default exists OR another row
  //           exists; we simply unset the flag and leave the user with
  //           no default. (Safer than silently promoting an arbitrary
  //           address.)
  if (data.isDefault === true) {
    await clearOtherDefaults(user.id, id);
    updates.isDefault = true;
  } else if (data.isDefault === false) {
    updates.isDefault = false;
  }

  let updated;
  try {
    updated = await db
      .update(addresses)
      .set(updates)
      .where(and(eq(addresses.id, id), eq(addresses.userId, user.id)))
      .returning();
  } catch {
    return errorResponse(500, {
      error: "Failed to update address",
      code: "internal_error",
    });
  }

  const row = updated[0];
  if (!row) return notFound();
  return NextResponse.json({ address: row }, { status: 200 });
}

/**
 * DELETE /api/users/me/addresses/[id]
 *
 * Remove an address owned by the authenticated user. If the deleted
 * row was the default, we promote the next-most-recent address (if any)
 * so the user keeps a default whenever they still have addresses.
 */
export async function DELETE(_req: Request, ctx: RouteParams) {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    throw err;
  }
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return notFound();

  const existing = await getOwnedAddress(user.id, id);
  if (!existing) return notFound();

  await db
    .delete(addresses)
    .where(and(eq(addresses.id, id), eq(addresses.userId, user.id)));

  if (existing.isDefault) {
    // Promote the most recently created remaining address, if any.
    const remaining = await db
      .select({ id: addresses.id })
      .from(addresses)
      .where(eq(addresses.userId, user.id));
    if (remaining.length > 0) {
      // Pick the most recent by re-querying with createdAt ordering.
      const ordered = await db
        .select()
        .from(addresses)
        .where(eq(addresses.userId, user.id));
      ordered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const next = ordered[0];
      if (next) {
        // Defensive: ensure we don't somehow leave two defaults.
        await clearOtherDefaults(user.id, next.id);
        await db
          .update(addresses)
          .set({ isDefault: true, updatedAt: new Date() })
          .where(eq(addresses.id, next.id));
      }
    }
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
