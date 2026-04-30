/**
 * Server-side auth utilities.
 *
 * - Password hashing / verification with bcrypt.
 * - Session creation, lookup, and revocation against the `sessions` table.
 * - `getCurrentUser()` reads the session cookie set by route handlers.
 *
 * Import as `import { ... } from "@/lib/server/auth"`. There's also a
 * thin re-export at `lib/auth.ts` for the path the task spec calls out.
 */
import { randomBytes, createHash } from "node:crypto";

import bcrypt from "bcryptjs";
import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";

import { db } from "@/lib/db";
import {
  passwordResetTokens,
  refreshTokens,
  sessions,
  users,
  type PasswordResetToken,
  type User,
} from "@/lib/db/schema";
import { env } from "@/lib/server/env";

/** Default session lifetime — 7 days. */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

/** Bcrypt cost factor. 12 is a reasonable default for 2024+ hardware. */
const BCRYPT_ROUNDS = 12;

/**
 * Minimum password requirements. Mirrors the shared validator below.
 * Keep in sync with any client-side schema (lib/client/...).
 */
export const PASSWORD_RULES = {
  minLength: 8,
  maxLength: 128,
} as const;

export interface PasswordValidationResult {
  ok: boolean;
  error?: string;
}

/** Validate a password against `PASSWORD_RULES`. */
export function validatePassword(pw: string): PasswordValidationResult {
  if (typeof pw !== "string") {
    return { ok: false, error: "Password must be a string" };
  }
  if (pw.length < PASSWORD_RULES.minLength) {
    return {
      ok: false,
      error: `Password must be at least ${PASSWORD_RULES.minLength} characters`,
    };
  }
  if (pw.length > PASSWORD_RULES.maxLength) {
    return {
      ok: false,
      error: `Password must be at most ${PASSWORD_RULES.maxLength} characters`,
    };
  }
  // Require at least one letter and one digit. Cheap, broadly compatible.
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) {
    return {
      ok: false,
      error: "Password must contain at least one letter and one number",
    };
  }
  return { ok: true };
}

/** Hash a plaintext password with bcrypt. */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

/** Constant-time-ish password verification via bcrypt. */
export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  if (!plain || !hash) return false;
  return bcrypt.compare(plain, hash);
}

/**
 * Generate a fresh opaque session token. We store the token directly as
 * the row id; it is 32 bytes of CSPRNG output, base64url-encoded.
 */
export function generateSessionId(): string {
  return randomBytes(32).toString("base64url");
}

/** Hash an arbitrary token (e.g. refresh token) for at-rest storage. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface CreateSessionInput {
  userId: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  ttlSeconds?: number;
}

export interface CreateSessionResult {
  id: string;
  expiresAt: Date;
}

/** Insert a new session row. Returns the opaque id and expiry. */
export async function createSession(
  input: CreateSessionInput,
): Promise<CreateSessionResult> {
  const id = generateSessionId();
  const ttl = input.ttlSeconds ?? SESSION_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttl * 1000);

  await db.insert(sessions).values({
    id,
    userId: input.userId,
    expiresAt,
    userAgent: input.userAgent ?? null,
    ipAddress: input.ipAddress ?? null,
  });

  return { id, expiresAt };
}

/**
 * Look up a session by id, ensuring it has not expired or been revoked,
 * and return the associated user. Returns `null` for any failure case.
 */
export async function getSessionUser(
  sessionId: string,
): Promise<{ user: User; sessionId: string } | null> {
  if (!sessionId) return null;
  const now = new Date();

  const rows = await db
    .select({
      user: users,
      sessionId: sessions.id,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.id, sessionId),
        gt(sessions.expiresAt, now),
        isNull(sessions.revokedAt),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return { user: row.user, sessionId: row.sessionId };
}

/** Mark a session as revoked. Idempotent. */
export async function revokeSession(sessionId: string): Promise<void> {
  if (!sessionId) return;
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.id, sessionId));
}

export interface SessionCookieOptions {
  expiresAt: Date;
}

/**
 * Build the cookie attributes used for the session cookie. Centralised
 * so login, register, and logout routes stay consistent.
 */
export function sessionCookieOptions(opts: SessionCookieOptions) {
  return {
    httpOnly: true,
    secure: env.IS_PROD,
    sameSite: "lax" as const,
    path: "/",
    expires: opts.expiresAt,
  };
}

/** Write the session cookie onto the outgoing response. */
export async function setSessionCookie(
  sessionId: string,
  expiresAt: Date,
): Promise<void> {
  const store = await cookies();
  store.set(
    env.SESSION_COOKIE_NAME,
    sessionId,
    sessionCookieOptions({ expiresAt }),
  );
}

/** Read the session cookie value from the current request, if any. */
export async function readSessionCookie(): Promise<string | null> {
  const store = await cookies();
  const c = store.get(env.SESSION_COOKIE_NAME);
  return c?.value ?? null;
}

/** Clear the session cookie. */
export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(env.SESSION_COOKIE_NAME);
}

/**
 * Resolve the currently-authenticated user from the session cookie.
 * Returns `null` if the cookie is missing, the session is unknown, or
 * the session has expired / been revoked.
 */
export async function getCurrentUser(): Promise<User | null> {
  const sessionId = await readSessionCookie();
  if (!sessionId) return null;
  const result = await getSessionUser(sessionId);
  return result?.user ?? null;
}

/**
 * Resolve the currently-authenticated session id and user from the
 * session cookie. Convenience for handlers that need to revoke or
 * rotate the active session in addition to identifying the user.
 */
export async function getCurrentSession(): Promise<
  { user: User; sessionId: string } | null
> {
  const sessionId = await readSessionCookie();
  if (!sessionId) return null;
  return getSessionUser(sessionId);
}

/**
 * Require an authenticated user. Throws an `AuthRequiredError` that
 * route handlers can catch and turn into a 401 response. Most code
 * should prefer the explicit `getCurrentUser()` form.
 */
export class AuthRequiredError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new AuthRequiredError();
  return user;
}

/**
 * Strip server-internal fields before returning a user over the wire.
 * The `passwordHash` must never leave the server.
 */
export function publicUser(u: User) {
  const { passwordHash: _ph, ...rest } = u;
  void _ph;
  return rest;
}

export type PublicUser = ReturnType<typeof publicUser>;

/**
 * Password-reset tokens.
 *
 * The raw token is what the user receives by email; we store only the
 * SHA-256 hash. Tokens expire after `PASSWORD_RESET_TTL_SECONDS` (1
 * hour by default) and become unusable once `usedAt` is set.
 */
export const PASSWORD_RESET_TTL_SECONDS = 60 * 60; // 1 hour

/** Bytes of CSPRNG output for the raw reset token. 32 → ~43 char base64url. */
const PASSWORD_RESET_TOKEN_BYTES = 32;

export interface IssuePasswordResetTokenInput {
  userId: string;
  ttlSeconds?: number;
}

export interface IssuePasswordResetTokenResult {
  /** The raw token, intended for email delivery. NEVER stored verbatim. */
  rawToken: string;
  /** The DB row id. */
  id: string;
  expiresAt: Date;
}

/**
 * Generate a fresh password-reset token row. Returns the raw token so
 * the caller can embed it in the outbound email — only the hash hits
 * the database.
 */
export async function issuePasswordResetToken(
  input: IssuePasswordResetTokenInput,
): Promise<IssuePasswordResetTokenResult> {
  const rawToken = randomBytes(PASSWORD_RESET_TOKEN_BYTES).toString("base64url");
  const tokenHash = hashToken(rawToken);
  const ttl = input.ttlSeconds ?? PASSWORD_RESET_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttl * 1000);

  const inserted = await db
    .insert(passwordResetTokens)
    .values({
      userId: input.userId,
      tokenHash,
      expiresAt,
    })
    .returning({ id: passwordResetTokens.id });

  const row = inserted[0];
  if (!row) {
    throw new Error("Failed to insert password_reset_tokens row");
  }
  return { rawToken, id: row.id, expiresAt };
}

/**
 * Find a password-reset token row by raw token. Returns the row only if
 * it has not expired and has not already been used. The `tokenHash` is
 * indexed and unique so this is a single-row lookup.
 */
export async function findActivePasswordResetToken(
  rawToken: string,
): Promise<PasswordResetToken | null> {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const now = new Date();

  const rows = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        gt(passwordResetTokens.expiresAt, now),
        isNull(passwordResetTokens.usedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Atomically mark a password-reset token row as consumed. Returns true
 * when the update affected exactly one not-yet-used row, false when the
 * token was already used (e.g. a double-submit).
 *
 * Using an `isNull(usedAt)` predicate makes this safe under concurrent
 * confirm requests: only one of them flips `usedAt` from null.
 */
export async function consumePasswordResetToken(id: string): Promise<boolean> {
  const updated = await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(passwordResetTokens.id, id),
        isNull(passwordResetTokens.usedAt),
      ),
    )
    .returning({ id: passwordResetTokens.id });
  return updated.length === 1;
}

/**
 * Invalidate every outstanding password-reset token for a user. Called
 * after a successful reset so a leaked-but-unused token can't be redeemed.
 */
export async function invalidateAllPasswordResetTokens(
  userId: string,
): Promise<void> {
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(passwordResetTokens.userId, userId),
        isNull(passwordResetTokens.usedAt),
      ),
    );
}

/**
 * Update a user's password hash and bump `updatedAt`. Used by the
 * password-reset confirm flow.
 */
export async function setUserPasswordHash(
  userId: string,
  newHash: string,
): Promise<void> {
  await db
    .update(users)
    .set({ passwordHash: newHash, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

/**
 * Revoke every active session and refresh token for a user. Called from
 * the password-reset confirm flow so an attacker who stole a session
 * can't keep using it after the legitimate owner resets the password.
 */
export async function revokeAllUserSessions(userId: string): Promise<void> {
  const now = new Date();
  await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(
      and(eq(sessions.userId, userId), isNull(sessions.revokedAt)),
    );
  await db
    .update(refreshTokens)
    .set({ revokedAt: now })
    .where(
      and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)),
    );
}
