import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
  boolean,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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

/**
 * Addresses associated with a user.
 *
 * A user may have many addresses (shipping, billing, etc). Exactly one
 * address per user can be flagged as the default. The "only one default"
 * invariant is enforced both at the application layer (the address routes
 * clear the previous default before promoting a new row) and at the
 * database layer via a partial unique index on `(user_id) WHERE is_default`.
 *
 * Fields are intentionally generic so they fit most postal systems:
 *   - `line1` / `line2` — street address
 *   - `city`, `state`, `postalCode`, `country`
 *   - `recipient` — optional "ship to" name when different from the user
 *   - `phone` — optional contact number for delivery
 *   - `label` — optional user-facing nickname ("Home", "Work")
 */
export const addresses = pgTable(
  "addresses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 100 }),
    recipient: varchar("recipient", { length: 200 }),
    phone: varchar("phone", { length: 40 }),
    line1: varchar("line1", { length: 200 }).notNull(),
    line2: varchar("line2", { length: 200 }),
    city: varchar("city", { length: 120 }).notNull(),
    state: varchar("state", { length: 120 }),
    postalCode: varchar("postal_code", { length: 32 }).notNull(),
    country: varchar("country", { length: 2 }).notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdx: index("addresses_user_idx").on(table.userId),
    // Partial unique index: at most one default address per user.
    // Postgres only enforces uniqueness for rows where is_default is true.
    userDefaultIdx: uniqueIndex("addresses_user_default_idx")
      .on(table.userId)
      .where(sql`${table.isDefault} = true`),
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
export type Address = typeof addresses.$inferSelect;
export type NewAddress = typeof addresses.$inferInsert;
