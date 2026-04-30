import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  createSession,
  hashPassword,
  publicUser,
  setSessionCookie,
  validatePassword,
} from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email("Invalid email address"),
  password: z.string(),
  name: z.string().trim().min(1).max(200).optional(),
});

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
 * POST /api/auth/register
 *
 * Body: { email: string; password: string; name?: string }
 *
 * On success: creates the user, opens a DB-backed session, sets the
 * httpOnly session cookie, and returns the public user record.
 */
export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return errorResponse(400, {
      error: "Request body must be valid JSON",
      code: "invalid_json",
    });
  }

  const parsed = registerSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(400, {
      error: "Invalid registration payload",
      code: "validation_failed",
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  const { email, password, name } = parsed.data;

  const pwCheck = validatePassword(password);
  if (!pwCheck.ok) {
    return errorResponse(400, {
      error: pwCheck.error ?? "Password does not meet requirements",
      code: "weak_password",
      fieldErrors: { password: [pwCheck.error ?? "Password is too weak"] },
    });
  }

  // Uniqueness check. We still rely on the DB unique constraint as the
  // source of truth in case of a race; this is a fast-path UX check.
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing.length > 0) {
    return errorResponse(409, {
      error: "An account with that email already exists",
      code: "email_taken",
      fieldErrors: { email: ["Email already registered"] },
    });
  }

  const passwordHash = await hashPassword(password);

  let inserted;
  try {
    inserted = await db
      .insert(users)
      .values({
        email,
        passwordHash,
        name: name ?? null,
        role: "user",
      })
      .returning();
  } catch (err: unknown) {
    // Race: a concurrent register beat us to the unique index.
    const message = err instanceof Error ? err.message : String(err);
    if (/unique|duplicate/i.test(message)) {
      return errorResponse(409, {
        error: "An account with that email already exists",
        code: "email_taken",
        fieldErrors: { email: ["Email already registered"] },
      });
    }
    return errorResponse(500, {
      error: "Failed to create user",
      code: "internal_error",
    });
  }

  const user = inserted[0];
  if (!user) {
    return errorResponse(500, {
      error: "Failed to create user",
      code: "internal_error",
    });
  }

  const userAgent = req.headers.get("user-agent");
  const forwardedFor = req.headers.get("x-forwarded-for");
  const ipAddress = forwardedFor?.split(",")[0]?.trim() || null;

  const session = await createSession({
    userId: user.id,
    userAgent,
    ipAddress,
  });

  await setSessionCookie(session.id, session.expiresAt);

  return NextResponse.json(
    {
      user: publicUser(user),
      session: {
        expiresAt: session.expiresAt.toISOString(),
      },
    },
    { status: 201 },
  );
}
