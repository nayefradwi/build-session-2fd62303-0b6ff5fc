-- Admin order management.
--
-- Adds cancellation snapshot columns (`cancellation_reason`,
-- `cancelled_at`, `cancelled_by`), a composite index that powers the
-- admin list query, and extends the `orders.status` CHECK constraint to
-- accept the new `processing` value introduced by the admin state
-- machine. The previously allowed states are preserved verbatim:
-- `paid` is the legacy/auto-payment state from `POST /api/orders`, and
-- the admin UI treats it as a synonym of `processing` for forward
-- transitions.
--
-- The admin transitions allowed by the helper layer are:
--
--    pending → processing → shipped → delivered
--                ▲                ▲
--                └─ from "paid" ──┘
--
--    pending | paid | processing → cancelled
--    delivered, cancelled         → terminal
--
-- Cancellation requires a free-form reason snapshotted onto the order
-- row alongside the timestamp and the cancelling admin's user id.

ALTER TABLE "orders" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancelled_by" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "orders" ADD CONSTRAINT "orders_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_status_created_at_idx" ON "orders" USING btree ("status","created_at");--> statement-breakpoint
-- Extend the status CHECK constraint to include `processing`. The drop /
-- recreate form is idempotent: the DROP IF EXISTS handles the first run
-- (when the constraint already lists the legacy four values) and any
-- subsequent re-runs (already extended).
DO $$ BEGIN
 ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_status_check";
EXCEPTION
 WHEN undefined_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "orders" ADD CONSTRAINT "orders_status_check" CHECK ("status" IN ('pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
