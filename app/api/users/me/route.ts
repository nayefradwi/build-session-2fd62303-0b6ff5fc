import { NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  AuthRequiredError,
  publicUser,
  requireUser,
} from "@/lib/server/auth";

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

/**
 * Profile update payload.
 *
 * - `email` is optional; when present it is normalised (trim + lowercase)
 *   and re-validated for uniqueness.
 * - `name` is optional; pass `null` to explicitly clear it.
 *
 * The body must contain at least one of the two fields. An empty PUT
 * is treated as a 400 so callers don't accidentally no-op.
 */
const updateMeSchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email("Invalid email address")
      .optional(),
    name: z
      .union([
        z.string().trim().min(1, "Name cannot be empty").max(200),
        z.null(),
      ])
      .optional(),
  })
  .refine((v) => v.email !== undefined || v.name !== undefined, {
    message: "At least one of `email` or `name` must be provided",
  });

/**
 * GET /api/users/me
 *
 * Return the current authenticated user. Strips server-internal fields
 * (e.g. password hash) via `publicUser`.
 */
export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ user: publicUser(user) }, { status: 200 });
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      return errorResponse(401, {
        error: "Authentication required",
        code: "unauthenticated",
      });
    }
    throw err;
  }
}

/**
 * PUT /api/users/me
 *
 * Body: { email?: string; name?: string | null }
 *
 * Updates the authenticated user's profile. When `email` changes, we
 * pre-check for collisions and also rely on the unique index as a
 * source-of-truth in case of a race.
 */
export async function PUT(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      return errorResponse(401, {
        error: "Authentication required",
        code: "unauthenticated",
      });
    }
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

  const parsed = updateMeSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(400, {
      error: "Invalid profile update payload",
      code: "validation_failed",
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  const { email, name } = parsed.data;

  // Build a sparse update set. Only include fields the caller sent.
  const updates: Partial<{
    email: string;
    name: string | null;
    updatedAt: Date;
  }> = { updatedAt: new Date() };

  if (email !== undefined && email !== user.email) {
    // Fast-path uniqueness check. The DB unique index is still the
    // ultimate guard against concurrent updates.
    const collision = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, email), ne(users.id, user.id)))
      .limit(1);
    if (collision.length > 0) {
      return errorResponse(409, {
        error: "An account with that email already exists",
        code: "email_taken",
        fieldErrors: { email: ["Email already registered"] },
      });
    }
    updates.email = email;
  }

  if (name !== undefined) {
    updates.name = name;
  }

  // Nothing actually changed (e.g. caller submitted current email and
  // omitted name). Skip the round-trip and return the current user.
  if (updates.email === undefined && !("name" in updates)) {
    return NextResponse.json({ user: publicUser(user) }, { status: 200 });
  }

  let updated;
  try {
    updated = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, user.id))
      .returning();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (/unique|duplicate/i.test(message)) {
      return errorResponse(409, {
        error: "An account with that email already exists",
        code: "email_taken",
        fieldErrors: { email: ["Email already registered"] },
      });
    }
    return errorResponse(500, {
      error: "Failed to update profile",
      code: "internal_error",
    });
  }

  const next = updated[0];
  if (!next) {
    return errorResponse(500, {
      error: "Failed to update profile",
      code: "internal_error",
    });
  }

  return NextResponse.json({ user: publicUser(next) }, { status: 200 });
}
