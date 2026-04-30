import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  PASSWORD_RESET_TTL_SECONDS,
  issuePasswordResetToken,
} from "@/lib/server/auth";
import { renderPasswordResetEmail, sendEmail } from "@/lib/server/email";
import { env } from "@/lib/server/env";
import { rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  email: z.string().trim().toLowerCase().email("Invalid email address"),
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

/** 5 reset requests per (ip + email) per 15 minutes — enough for typos, not for abuse. */
const REQUEST_WINDOW_MS = 15 * 60 * 1000;
const REQUEST_MAX = 5;

function clientIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || "unknown";
}

/** Build the absolute URL the email links to. */
function buildResetUrl(rawToken: string): string {
  const base = env.APP_URL.replace(/\/$/, "");
  // Frontend is expected to render a /reset-password page that reads the
  // `token` query param and POSTs it to /api/auth/password-reset/confirm.
  return `${base}/reset-password?token=${encodeURIComponent(rawToken)}`;
}

/**
 * POST /api/auth/password-reset/request
 *
 * Body: { email: string }
 *
 * Issues a password-reset token for the user matching `email` and emails
 * them a link valid for 1 hour. Always responds 200 with the same shape
 * regardless of whether the email is registered — this prevents account
 * enumeration. Rate-limited per (ip + email) tuple.
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

  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(400, {
      error: "Invalid request payload",
      code: "validation_failed",
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  const { email } = parsed.data;
  const ip = clientIp(req);
  const rateKey = `password-reset:${ip}:${email}`;
  const rl = rateLimit(rateKey, {
    windowMs: REQUEST_WINDOW_MS,
    max: REQUEST_MAX,
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
        error: "Too many password reset requests. Please try again later.",
        code: "rate_limited",
      },
      { ...rateHeaders, "Retry-After": String(rl.retryAfterSeconds) },
    );
  }

  // Look up the user. We intentionally swallow the "no such user" case
  // and return the generic OK response below so callers can't enumerate
  // valid email addresses through this endpoint.
  const rows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  const user = rows[0];

  if (user) {
    try {
      const { rawToken, expiresAt } = await issuePasswordResetToken({
        userId: user.id,
      });
      const resetUrl = buildResetUrl(rawToken);
      const ttlMinutes = Math.round(PASSWORD_RESET_TTL_SECONDS / 60);
      const rendered = renderPasswordResetEmail({
        to: user.email,
        resetUrl,
        expiresInMinutes: ttlMinutes,
      });
      await sendEmail({
        to: user.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
      void expiresAt;
    } catch (err) {
      // Log but do not surface details — see comment above re: enumeration.
      // eslint-disable-next-line no-console
      console.error("[password-reset:request] failed to issue / send", err);
    }
  }

  return NextResponse.json(
    {
      ok: true,
      message:
        "If an account exists for that email, a password reset link has been sent.",
    },
    { status: 200, headers: rateHeaders },
  );
}
