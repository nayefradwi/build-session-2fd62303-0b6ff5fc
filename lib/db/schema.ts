import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
  boolean,
  uniqueIndex,
  integer,
  numeric,
  type AnyPgColumn,
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

/**
 * Product taxonomy.
 *
 * Categories are slug-keyed (e.g. "outerwear", "footwear/sneakers") so
 * they can be referenced from URLs without exposing internal UUIDs.
 *
 * `parentId` is a self-reference enabling a one-level (or deeper) tree.
 * It is nullable: top-level categories have a NULL parent. The default
 * `onDelete` for the parent reference is set-null so removing a parent
 * promotes its children to the top level rather than cascading deletes.
 */
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: varchar("slug", { length: 120 }).notNull().unique(),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description"),
    parentId: uuid("parent_id").references((): AnyPgColumn => categories.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    slugIdx: index("categories_slug_idx").on(table.slug),
    parentIdx: index("categories_parent_idx").on(table.parentId),
  }),
);

/**
 * Products / SKUs.
 *
 * One product row corresponds to a single sellable SKU. Fields cover the
 * common e-commerce browse/search/filter surface:
 *
 * - `slug` is the URL identifier; `sku` is the merchant-facing code.
 * - Price is stored in integer cents (no rounding surprises). Optional
 *   `compareAtPriceCents` is the original/strike-through price for sales.
 * - Variant axes (`size`, `material`, `color`) are flat strings; richer
 *   variant modeling can be added later behind the same API.
 * - `stock` is the on-hand quantity. The `availability` filter on the
 *   browse API maps to `stock > 0` / `stock = 0`.
 * - `isFeatured` / `isNew` are merchandising flags surfaced in the UI.
 * - `ratingAverage` / `ratingCount` are denormalised aggregates kept in
 *   sync by review write-paths (out of scope for this task).
 * - `salesCount` powers the popularity sort.
 *
 * The `search_vector` column (added in the SQL migration) is a STORED
 * generated tsvector built from `name` + `description` with weighted
 * lexemes. It is queried with `plainto_tsquery` and indexed with GIN.
 * It is intentionally NOT declared on this Drizzle table: it cannot be
 * inserted into or updated, and queries reference it via raw SQL.
 */
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: varchar("slug", { length: 200 }).notNull().unique(),
    sku: varchar("sku", { length: 64 }).notNull().unique(),
    name: varchar("name", { length: 300 }).notNull(),
    description: text("description").notNull().default(""),
    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    priceCents: integer("price_cents").notNull(),
    compareAtPriceCents: integer("compare_at_price_cents"),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    size: varchar("size", { length: 32 }),
    material: varchar("material", { length: 64 }),
    color: varchar("color", { length: 32 }),
    stock: integer("stock").notNull().default(0),
    isFeatured: boolean("is_featured").notNull().default(false),
    isNew: boolean("is_new").notNull().default(false),
    ratingAverage: numeric("rating_average", { precision: 3, scale: 2 })
      .notNull()
      .default("0"),
    ratingCount: integer("rating_count").notNull().default(0),
    salesCount: integer("sales_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    slugIdx: index("products_slug_idx").on(table.slug),
    skuIdx: index("products_sku_idx").on(table.sku),
    categoryIdx: index("products_category_idx").on(table.categoryId),
    priceIdx: index("products_price_idx").on(table.priceCents),
    createdAtIdx: index("products_created_at_idx").on(table.createdAt),
    ratingIdx: index("products_rating_idx").on(table.ratingAverage),
    salesIdx: index("products_sales_idx").on(table.salesCount),
    sizeIdx: index("products_size_idx").on(table.size),
    materialIdx: index("products_material_idx").on(table.material),
    colorIdx: index("products_color_idx").on(table.color),
    stockIdx: index("products_stock_idx").on(table.stock),
    featuredIdx: index("products_featured_idx").on(table.isFeatured),
  }),
);

/**
 * Image gallery for a product.
 *
 * The first row (lowest `position`) is the primary thumbnail; subsequent
 * rows feed the PDP carousel. `url` is treated as opaque — it can point
 * at the public-asset CDN, an S3 bucket, or a placeholder service.
 */
export const productImages = pgTable(
  "product_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    alt: varchar("alt", { length: 300 }),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    productIdx: index("product_images_product_idx").on(table.productId),
    productPositionIdx: index("product_images_product_position_idx").on(
      table.productId,
      table.position,
    ),
  }),
);

/**
 * Wishlist items.
 *
 * A wishlist row pins a single product to a single user. The pair
 * `(user_id, product_id)` is the natural key — a user cannot wishlist the
 * same product twice. We enforce that with a unique index, AND the route
 * layer pre-checks for an existing row so callers receive a clean 409
 * instead of a generic constraint-violation error.
 *
 * Both foreign keys cascade on delete:
 *   - deleting the user removes their wishlist
 *   - deleting the product removes every wishlist row that referenced it
 *
 * The `createdAt` column lets the GET endpoint return rows in
 * "most-recently-added first" order without an extra sort key.
 */
export const wishlistItems = pgTable(
  "wishlist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdx: index("wishlist_items_user_idx").on(table.userId),
    productIdx: index("wishlist_items_product_idx").on(table.productId),
    // Prevent duplicates: a user can wishlist a given product at most once.
    userProductIdx: uniqueIndex("wishlist_items_user_product_idx").on(
      table.userId,
      table.productId,
    ),
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
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ProductImage = typeof productImages.$inferSelect;
export type NewProductImage = typeof productImages.$inferInsert;
export type WishlistItem = typeof wishlistItems.$inferSelect;
export type NewWishlistItem = typeof wishlistItems.$inferInsert;

/**
 * Cart items.
 *
 * One row per (user, product) pair, holding the quantity the shopper has
 * chosen. Like the wishlist, the natural key `(user_id, product_id)` is
 * enforced with a unique index so the same product never appears as two
 * separate rows in a single user's cart — repeat "add to cart" calls
 * increment the existing row instead.
 *
 * - `quantity` is required and is checked to be > 0 by the application
 *   layer; the route also rejects any value greater than the live
 *   `products.stock` so a shopper cannot reserve more than is on hand.
 * - Both foreign keys cascade on delete: deleting a user (or product)
 *   tears the corresponding cart rows down so we never leave dangling
 *   references.
 *
 * The `quantity` column does NOT carry a database CHECK constraint —
 * Drizzle's stable surface for column-level CHECKs is still in flux at
 * the time of writing — but the migration and the route handlers both
 * enforce the > 0 invariant. Adding a CHECK in a follow-up migration is
 * a clean future-only edit.
 */
export const cartItems = pgTable(
  "cart_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdx: index("cart_items_user_idx").on(table.userId),
    productIdx: index("cart_items_product_idx").on(table.productId),
    // Prevent duplicates: a user has at most one row per product.
    userProductIdx: uniqueIndex("cart_items_user_product_idx").on(
      table.userId,
      table.productId,
    ),
  }),
);

export type CartItem = typeof cartItems.$inferSelect;
export type NewCartItem = typeof cartItems.$inferInsert;

/**
 * Discount codes (admin-managed promo codes).
 *
 * One row per redeemable code. The code itself is a short, human-readable
 * string that the shopper types at checkout — it is stored in upper-case
 * form to make case-insensitive lookups a simple equality probe, with a
 * unique index ensuring no two codes collide.
 *
 * Fields:
 *   - `code`             the redeemable token (uppercased on insert).
 *   - `type`             discount kind: "percentage" or "fixed".
 *                        `percentage` interprets `value` as a 1-100 integer
 *                        percent; `fixed` interprets `value` as cents.
 *   - `value`            integer; meaning depends on `type`. Stored in the
 *                        smallest unit so we never deal with floats.
 *   - `minOrderValue`    minimum subtotal (in CENTS) for the code to apply.
 *                        Null / zero means no minimum.
 *   - `expiresAt`        UTC timestamp after which the code is no longer
 *                        redeemable. Nullable — codes with no expiry are
 *                        valid forever (until manually deactivated).
 *   - `isActive`         soft on/off switch. An inactive code is rejected
 *                        even if it is otherwise valid (not expired and
 *                        within usage limits).
 *   - `usageLimit`       optional cap on the total number of redemptions.
 *                        Nullable means "unlimited". When set, redemptions
 *                        bump `usageCount` and the code is rejected once
 *                        the count reaches the limit.
 *   - `usageCount`       running tally of successful redemptions; bumped
 *                        atomically by the (forthcoming) checkout flow.
 *   - `description`      optional admin-only memo (label, marketing copy,
 *                        campaign reference, etc.). Not surfaced to shoppers.
 *
 * The "currently usable" predicate is computed at read time — the table
 * deliberately stores raw facts so an admin can edit any field without
 * having to recompute a status column. The query helper exposes a
 * `status` enum (`active` | `inactive` | `expired` | `exhausted`)
 * suitable for the admin list view.
 */
export const discountCodes = pgTable(
  "discount_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 64 }).notNull().unique(),
    type: varchar("type", { length: 16 }).notNull(),
    value: integer("value").notNull(),
    minOrderValue: integer("min_order_value"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
    usageLimit: integer("usage_limit"),
    usageCount: integer("usage_count").notNull().default(0),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    codeIdx: index("discount_codes_code_idx").on(table.code),
    activeIdx: index("discount_codes_active_idx").on(table.isActive),
    expiresIdx: index("discount_codes_expires_idx").on(table.expiresAt),
  }),
);

export type DiscountCode = typeof discountCodes.$inferSelect;
export type NewDiscountCode = typeof discountCodes.$inferInsert;

/**
 * Orders.
 *
 * One row per checkout commit. Created by `POST /api/orders` from a
 * user's cart inside a serializable transaction that also decrements the
 * relevant `products.stock`, bumps `discount_codes.usage_count` (when a
 * promo applied), and clears the cart.
 *
 * Pricing fields are integer cents to match the rest of the catalog. The
 * shipping address is BOTH referenced by id (so admin/listing UIs can
 * follow a `JOIN` cleanly) AND snapshotted into denormalised columns so
 * the order-history view stays correct after a user edits or deletes the
 * underlying address row.
 *
 * Status vocabulary (intentionally informal — formal state machine lives
 * in a follow-up admin task):
 *
 *   - "pending"   → freshly created, awaiting payment / fulfilment
 *   - "paid"      → payment captured (future)
 *   - "shipped"   → in transit (future)
 *   - "delivered" → completed (future)
 *   - "cancelled" → reversed (future)
 *
 * `discount_code_id` references the discount row that was applied (or
 * NULL for no-promo orders); `discount_code` holds the literal code text
 * for display so an admin renaming/deleting a code does not break the
 * receipt UI.
 */
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: varchar("status", { length: 32 }).notNull().default("pending"),

    // Shipping address — referenced (when known) and snapshotted.
    shippingAddressId: uuid("shipping_address_id").references(
      () => addresses.id,
      { onDelete: "set null" },
    ),
    shippingRecipient: varchar("shipping_recipient", { length: 200 }),
    shippingPhone: varchar("shipping_phone", { length: 40 }),
    shippingLine1: varchar("shipping_line1", { length: 200 }).notNull(),
    shippingLine2: varchar("shipping_line2", { length: 200 }),
    shippingCity: varchar("shipping_city", { length: 120 }).notNull(),
    shippingState: varchar("shipping_state", { length: 120 }),
    shippingPostalCode: varchar("shipping_postal_code", { length: 32 }).notNull(),
    shippingCountry: varchar("shipping_country", { length: 2 }).notNull(),

    // Pricing snapshot.
    subtotalCents: integer("subtotal_cents").notNull(),
    shippingCents: integer("shipping_cents").notNull().default(0),
    discountCents: integer("discount_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),

    // Discount snapshot. The id may go null if the code is later deleted;
    // the literal `discount_code` string is preserved for display.
    discountCodeId: uuid("discount_code_id").references(
      () => discountCodes.id,
      { onDelete: "set null" },
    ),
    discountCode: varchar("discount_code", { length: 64 }),

    /** Sum of `quantity` across every line — denormalised for fast reads. */
    itemCount: integer("item_count").notNull(),
    notes: text("notes"),

    /**
     * Cancellation snapshot. Populated by the admin "cancel order" flow —
     * see `lib/server/admin-orders.ts` and `POST /api/admin/orders/{id}/cancel`.
     *
     *   - `cancellationReason` free-form admin note (required for cancel).
     *   - `cancelledAt`        timestamp the admin pressed cancel.
     *   - `cancelledBy`        the admin's `users.id`. `set null` on delete
     *                          so removing an admin user does not erase
     *                          history.
     */
    cancellationReason: text("cancellation_reason"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdx: index("orders_user_idx").on(table.userId),
    statusIdx: index("orders_status_idx").on(table.status),
    createdAtIdx: index("orders_created_at_idx").on(table.createdAt),
    statusCreatedAtIdx: index("orders_status_created_at_idx").on(
      table.status,
      table.createdAt,
    ),
    addressIdx: index("orders_shipping_address_idx").on(table.shippingAddressId),
  }),
);

/**
 * Line items belonging to an order.
 *
 * Every product attribute the order surface needs is snapshotted at
 * write time so subsequent product edits or deletions cannot rewrite
 * order history. `product_id` is kept as a soft reference (set-null on
 * delete) for analytics and re-order flows that want to link back to the
 * live SKU when it still exists.
 */
export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "set null",
    }),

    // Product snapshot (preserved if the product row is later deleted).
    sku: varchar("sku", { length: 64 }).notNull(),
    name: varchar("name", { length: 300 }).notNull(),
    size: varchar("size", { length: 32 }),
    material: varchar("material", { length: 64 }),
    color: varchar("color", { length: 32 }),
    imageUrl: text("image_url"),

    quantity: integer("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    lineTotalCents: integer("line_total_cents").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orderIdx: index("order_items_order_idx").on(table.orderId),
    productIdx: index("order_items_product_idx").on(table.productId),
  }),
);

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;

/**
 * Order-status vocabulary surfaced to API consumers.
 *
 * `processing` was added by the admin order-management feature
 * (migration `0010_admin_orders.sql`) — it is the canonical "fulfilment
 * is underway" state in the admin state machine. Older orders that
 * captured payment via `POST /api/orders` may still report `paid`; the
 * admin UI treats the two as equivalent for forward transitions.
 */
export const ORDER_STATUSES = [
  "pending",
  "paid",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Product reviews.
 *
 * One row per (user, product) pair — a shopper can post at most one
 * review per product. The natural-key uniqueness is enforced both with
 * a unique index AND a pre-check in the route layer so callers receive
 * a clean 409 instead of a generic constraint-violation error.
 *
 * Fields:
 *   - `rating`     integer 1-5. A CHECK constraint in the migration
 *                  enforces the range at the database layer; the route
 *                  layer also rejects out-of-range values up front so
 *                  the response error is descriptive.
 *   - `comment`    optional free-form text. Trimmed at the route layer;
 *                  reviews with no comment are perfectly valid.
 *   - `verifiedPurchase` snapshot of the gating rule at write time —
 *                  the POST route requires the reviewer have actually
 *                  bought the product (an `order_items` row referencing
 *                  this product on an order owned by the user). The
 *                  flag persists alongside the review so a moderation
 *                  UI never has to recompute it.
 *
 * Both foreign keys cascade on delete so removing a user (or product)
 * tears down their reviews; subsequent reads of the parent product's
 * rating aggregate stay consistent because the route-layer recompute
 * (or, in this iteration, the on-write recompute below) re-derives
 * `rating_average` / `rating_count` from the live `reviews` rows.
 */
export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    comment: text("comment"),
    /**
     * Snapshot — true when the reviewer had at least one delivered/paid/
     * shipped/etc. order containing this product at write time. The route
     * layer requires this to be true to accept the review.
     */
    verifiedPurchase: boolean("verified_purchase").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdx: index("reviews_user_idx").on(table.userId),
    productIdx: index("reviews_product_idx").on(table.productId),
    productCreatedAtIdx: index("reviews_product_created_at_idx").on(
      table.productId,
      table.createdAt,
    ),
    // Prevent duplicates: a user can review a given product at most once.
    userProductIdx: uniqueIndex("reviews_user_product_idx").on(
      table.userId,
      table.productId,
    ),
  }),
);

export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;

/**
 * Audit log of every stock change applied through the admin inventory API.
 *
 * One row per write — the inventory helpers always insert here whenever a
 * `products.stock` field is updated. Each row records:
 *
 *   - `delta`         signed integer; positive on restocks, negative on
 *                     manual decrements (e.g. damage write-offs). The
 *                     route layer derives this from the requested change
 *                     before issuing the UPDATE so the log and the column
 *                     stay consistent.
 *   - `previousStock` `products.stock` before the change.
 *   - `newStock`      `products.stock` after the change.
 *   - `reason`        free-form admin note. Optional, capped at 500 chars.
 *   - `userId`        the admin who issued the change. `set null` on
 *                     delete so removing an admin user does not erase the
 *                     log entries they wrote.
 *   - `productId`     the affected product. Cascades on delete: removing
 *                     a product deletes its adjustment history because
 *                     the rows are no longer joinable to anything useful.
 *   - `createdAt`     when the change was applied.
 */
export const stockAdjustments = pgTable(
  "stock_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    delta: integer("delta").notNull(),
    previousStock: integer("previous_stock").notNull(),
    newStock: integer("new_stock").notNull(),
    reason: varchar("reason", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    productIdx: index("stock_adjustments_product_idx").on(table.productId),
    userIdx: index("stock_adjustments_user_idx").on(table.userId),
    createdAtIdx: index("stock_adjustments_created_at_idx").on(table.createdAt),
    productCreatedAtIdx: index("stock_adjustments_product_created_at_idx").on(
      table.productId,
      table.createdAt,
    ),
  }),
);

export type StockAdjustment = typeof stockAdjustments.$inferSelect;
export type NewStockAdjustment = typeof stockAdjustments.$inferInsert;

/**
 * Generic key/value store for app-wide configuration.
 *
 * Used by the admin inventory API to persist a configurable low-stock
 * threshold (key: `inventory.low_stock_threshold`, value: numeric string).
 * The shape is deliberately generic — any future scalar setting (default
 * shipping rate, feature flag, etc.) can ride on the same table without
 * a fresh migration.
 *
 * Conventions:
 *   - `key`        dotted lower-case identifier ("inventory.low_stock_threshold").
 *                  Unique; lookups are an equality probe.
 *   - `value`      stored as text. Numeric values are serialised as
 *                  base-10 strings; complex values may use JSON. The
 *                  route layer is responsible for parse/format.
 *   - `updatedBy`  uuid of the admin that wrote the value last. `set null`
 *                  on delete so removing the admin does not erase the
 *                  setting itself.
 */
export const appConfig = pgTable(
  "app_config",
  {
    key: varchar("key", { length: 120 }).primaryKey(),
    value: text("value").notNull(),
    updatedBy: uuid("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export type AppConfig = typeof appConfig.$inferSelect;
export type NewAppConfig = typeof appConfig.$inferInsert;
