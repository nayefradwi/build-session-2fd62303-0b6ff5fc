import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  createSession,
  publicUser,
  setSessionCookie,
  verifyPassword,
} from "@/lib/server/auth";
import { rateLimit, resetRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Invalid email address"),
  password: z.string().min(1, "Password is required").max(1024),
});

interface ErrorBody {
  error: string;
  code: string;
  fieldErrors?: Record<string, string[]>;
}

function errorResponse(
  status: number,
  body: ErrorBody,
  headers?: Record<string, string>,
): NextResponse<ErrorBody> {
  return NextResponse.json(body, { status, headers });
}

/** Login attempts: 10 per 10 minutes per (ip + email) tuple. */
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

function clientIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || "unknown";
}

/**
 * POST /api/auth/login
 *
 * Body: { email: string; password: string }
 *
 * - Validates input with zod.
 * - Rate-limits per (ip + email) to slow brute-force.
 * - Verifies the bcrypt password hash.
 * - On success: opens a DB-backed session, sets the httpOnly session
 *   cookie (SameSite=Lax — works across tabs of the same origin), and
 *   returns the public user record.
 * - On failure: returns a generic 401 to avoid leaking which field
 *   was wrong (email vs password).
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

  const parsed = loginSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(400, {
      error: "Invalid login payload",
      code: "validation_failed",
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  const { email, password } = parsed.data;
  const ip = clientIp(req);
  const rateKey = `login:${ip}:${email}`;
  const rl = rateLimit(rateKey, {
    windowMs: LOGIN_WINDOW_MS,
    max: LOGIN_MAX_ATTEMPTS,
  });

  const rateHeaders: Record<string, string> = {
    "X-RateLimit-Limit": String(rl.limit),
    "X-RateLimit-Remaining": String(rl.remaining),
    "X-RateLimit-Reset": String(Math.floor(rl.resetAt.getTime() / 1000)),
  };

  if (!rl.allowed) {
    return errorResponse(
      429,
      {
        error: "Too many login attempts. Please try again later.",
        code: "rate_limited",
      },
      { ...rateHeaders, "Retry-After": String(rl.retryAfterSeconds) },
    );
  }

  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  const user = rows[0];

  // Always run bcrypt to keep timing roughly constant whether or not
  // the email exists. We compare against a known-bad hash on the miss
  // path so the work factor stays similar.
  const dummyHash =
    "$2a$12$CwTycUXWue0Thq9StjUM0uJ8.0p6PBfQ4LQk/JxF.E3CkUjT.G3WO";
  const candidateHash = user?.passwordHash ?? dummyHash;
  const passwordOk = await verifyPassword(password, candidateHash);

  if (!user || !passwordOk) {
    return errorResponse(
      401,
      {
        error: "Invalid email or password",
        code: "invalid_credentials",
      },
      rateHeaders,
    );
  }

  // Successful login — clear the brute-force counter for this tuple
  // so a legitimate user is not penalised by their own typos.
  resetRateLimit(rateKey);

  const userAgent = req.headers.get("user-agent");
  const ipAddress = ip === "unknown" ? null : ip;

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
    { status: 200, headers: rateHeaders },
  );
}
