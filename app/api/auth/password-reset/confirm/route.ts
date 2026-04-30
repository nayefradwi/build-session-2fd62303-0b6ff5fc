import { NextResponse } from "next/server";
import { z } from "zod";

import {
  consumePasswordResetToken,
  findActivePasswordResetToken,
  hashPassword,
  invalidateAllPasswordResetTokens,
  revokeAllUserSessions,
  setUserPasswordHash,
  validatePassword,
} from "@/lib/server/auth";
import { rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const confirmSchema = z.object({
  token: z.string().min(1, "Token is required").max(512),
  password: z.string(),
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

/** 20 confirm attempts per IP per 15 minutes — generous for retries, tight enough to slow guessing. */
const CONFIRM_WINDOW_MS = 15 * 60 * 1000;
const CONFIRM_MAX = 20;

function clientIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || "unknown";
}

/**
 * POST /api/auth/password-reset/confirm
 *
 * Body: { token: string; password: string }
 *
 * Redeems a previously-issued password reset token. Validates the
 * incoming token (must exist, not be expired, not already used),
 * enforces the password policy, hashes the new password with bcrypt,
 * stores it on the user, marks the token as used, and invalidates all
 * other outstanding tokens plus active sessions / refresh tokens for
 * that user — so a leaked token can't outlive the reset and stale
 * sessions on other devices are forced to re-authenticate.
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

  const parsed = confirmSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(400, {
      error: "Invalid request payload",
      code: "validation_failed",
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  const { token, password } = parsed.data;

  const ip = clientIp(req);
  const rateKey = `password-reset-confirm:${ip}`;
  const rl = rateLimit(rateKey, {
    windowMs: CONFIRM_WINDOW_MS,
    max: CONFIRM_MAX,
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
        error: "Too many attempts. Please try again later.",
        code: "rate_limited",
      },
      { ...rateHeaders, "Retry-After": String(rl.retryAfterSeconds) },
    );
  }

  const pwCheck = validatePassword(password);
  if (!pwCheck.ok) {
    return errorResponse(400, {
      error: pwCheck.error ?? "Password does not meet requirements",
      code: "weak_password",
      fieldErrors: { password: [pwCheck.error ?? "Password is too weak"] },
    });
  }

  const tokenRow = await findActivePasswordResetToken(token);
  if (!tokenRow) {
    return errorResponse(
      400,
      {
        error: "This reset link is invalid or has expired. Please request a new one.",
        code: "invalid_token",
      },
      rateHeaders,
    );
  }

  // Atomic single-use guard. Whoever flips usedAt from null first wins.
  const consumed = await consumePasswordResetToken(tokenRow.id);
  if (!consumed) {
    return errorResponse(
      400,
      {
        error: "This reset link has already been used. Please request a new one.",
        code: "invalid_token",
      },
      rateHeaders,
    );
  }

  const newHash = await hashPassword(password);
  await setUserPasswordHash(tokenRow.userId, newHash);

  // Burn every other outstanding reset token for the user, plus all
  // active sessions / refresh tokens — defensive cleanup so a stolen
  // session can't outlive the reset.
  await invalidateAllPasswordResetTokens(tokenRow.userId);
  await revokeAllUserSessions(tokenRow.userId);

  return NextResponse.json(
    {
      ok: true,
      message:
        "Password updated. Please sign in with your new password.",
    },
    { status: 200, headers: rateHeaders },
  );
}
