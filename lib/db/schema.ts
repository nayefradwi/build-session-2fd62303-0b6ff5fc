import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

/**
 * Users table.
 *
 * - `email` is the canonical login identifier and must be unique.
 * - `passwordHash` stores a bcrypt hash; never the plaintext password.
 * - `role` defaults to "user". Other valid values: "admin".
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 320 }).notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    name: varchar("name", { length: 200 }),
    role: varchar("role", { length: 32 }).notNull().default("user"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    emailIdx: index("users_email_idx").on(table.email),
  }),
);

/**
 * DB-backed session tokens.
 *
 * The session cookie holds the opaque `id` value. The server looks up the
 * session row, verifies it has not expired or been revoked, then loads the
 * associated user. Sessions are short-lived (default 7 days); refresh
 * tokens (separate table below) extend that without re-authenticating.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    userAgent: text("user_agent"),
    ipAddress: varchar("ip_address", { length: 64 }),
  },
  (table) => ({
    userIdx: index("sessions_user_idx").on(table.userId),
    expiresIdx: index("sessions_expires_idx").on(table.expiresAt),
  }),
);

/**
 * Refresh tokens. Optional companion to `sessions` for sliding-window
 * authentication. A refresh token can be exchanged for a new session row
 * without sending the user back through the login flow.
 */
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => sessions.id, {
      onDelete: "cascade",
    }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => ({
    userIdx: index("refresh_tokens_user_idx").on(table.userId),
    sessionIdx: index("refresh_tokens_session_idx").on(table.sessionId),
  }),
);

/**
 * Password-reset tokens.
 *
 * Issued by `POST /api/auth/password-reset/request`, redeemed by
 * `POST /api/auth/password-reset/confirm`. The user receives the raw
 * token via email; only the SHA-256 hash is stored at rest so that a
 * read of the database alone cannot impersonate a reset request.
 *
 * - `token_hash` — SHA-256(rawToken). Indexed for the lookup.
 * - `expires_at` — defaults to issued_at + 1 hour at the route layer.
 * - `used_at` — set when the reset is consumed; subsequent attempts
 *   with the same token must be rejected.
 */
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (table) => ({
    userIdx: index("password_reset_tokens_user_idx").on(table.userId),
    tokenHashIdx: index("password_reset_tokens_token_hash_idx").on(
      table.tokenHash,
    ),
    expiresIdx: index("password_reset_tokens_expires_idx").on(table.expiresAt),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert;
