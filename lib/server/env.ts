/**
 * Server-only environment validation.
 *
 * This module is imported by everything in `lib/db/**`, `lib/server/**`,
 * and `app/api/**`. By convention it lives under `lib/server/**` so that
 * client bundles never reach for it.
 */

function required(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Set it in .env.local (see .env.example).`,
    );
  }
  return value;
}

const isProd = process.env.NODE_ENV === "production";

export const env = {
  DATABASE_URL: required("DATABASE_URL", process.env.DATABASE_URL),
  AUTH_SECRET: process.env.AUTH_SECRET ?? "dev-only-insecure-secret",
  SESSION_COOKIE_NAME: process.env.SESSION_COOKIE_NAME ?? "session",
  IS_PROD: isProd,
  /**
   * Public URL the app is served from. Used to build absolute links in
   * outbound email (password reset, etc.). Falls back to localhost in dev.
   */
  APP_URL: process.env.APP_URL ?? "http://localhost:3000",
  /**
   * Resend API key. Optional — when unset, transactional emails are
   * logged to stdout instead of dispatched. This keeps local dev frictionless.
   */
  RESEND_API_KEY: process.env.RESEND_API_KEY ?? "",
  /**
   * "From" address for transactional email. Must be a verified sender
   * on your Resend account in production.
   */
  EMAIL_FROM: process.env.EMAIL_FROM ?? "no-reply@example.com",
  /**
   * Vercel Blob read-write token used by the admin product image-upload
   * route. When unset, uploads in production return a 503 ("not
   * configured") and uploads in development fall back to deterministic
   * placeholder URLs so the create/edit flows remain exercisable without
   * provisioning a blob store first. Generate one at:
   *   Vercel project → Storage → Blob → Connect → Read/Write token.
   */
  BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN ?? "",
} as const;

export type Env = typeof env;
