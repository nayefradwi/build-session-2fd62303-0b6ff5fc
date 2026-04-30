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
} as const;

export type Env = typeof env;
