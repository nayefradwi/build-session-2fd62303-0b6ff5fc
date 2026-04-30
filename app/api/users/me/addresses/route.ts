import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { addresses } from "@/lib/db/schema";
import {
  AuthRequiredError,
  requireUser,
} from "@/lib/server/auth";
import {
  clearOtherDefaults,
  countAddressesForUser,
  createAddressSchema,
  listAddressesForUser,
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

/**
 * GET /api/users/me/addresses
 *
 * Return every address belonging to the authenticated user, default
 * address first.
 */
export async function GET() {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    throw err;
  }
  const rows = await listAddressesForUser(user.id);
  return NextResponse.json({ addresses: rows }, { status: 200 });
}

/**
 * POST /api/users/me/addresses
 *
 * Create a new address. The first address a user creates is promoted to
 * default automatically. If the caller passes `isDefault: true`, any
 * previous default is demoted before the new row is inserted so the
 * partial unique index never sees two defaults at once.
 */
export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    throw err;
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return errorResponse(400, {
      error: "Request body must be valid JSON",
      code: "invalid_json",
    });
  }

  const parsed = createAddressSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(400, {
      error: "Invalid address payload",
      code: "validation_failed",
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  const data = parsed.data;
  // Auto-default the first address; otherwise honour the caller's flag.
  const existingCount = await countAddressesForUser(user.id);
  const shouldBeDefault =
    existingCount === 0 ? true : data.isDefault === true;

  if (shouldBeDefault) {
    await clearOtherDefaults(user.id);
  }

  let inserted;
  try {
    inserted = await db
      .insert(addresses)
      .values({
        userId: user.id,
        label: data.label ?? null,
        recipient: data.recipient ?? null,
        phone: data.phone ?? null,
        line1: data.line1,
        line2: data.line2 ?? null,
        city: data.city,
        state: data.state ?? null,
        postalCode: data.postalCode,
        country: data.country,
        isDefault: shouldBeDefault,
      })
      .returning();
  } catch (err: unknown) {
    return errorResponse(500, {
      error: "Failed to create address",
      code: "internal_error",
      fieldErrors:
        err instanceof Error ? { _: [err.message] } : undefined,
    });
  }

  const row = inserted[0];
  if (!row) {
    return errorResponse(500, {
      error: "Failed to create address",
      code: "internal_error",
    });
  }

  return NextResponse.json({ address: row }, { status: 201 });
}
