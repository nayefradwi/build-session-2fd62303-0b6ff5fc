CREATE TABLE IF NOT EXISTS "discount_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(64) NOT NULL,
	"type" varchar(16) NOT NULL,
	"value" integer NOT NULL,
	"min_order_value" integer,
	"expires_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"usage_limit" integer,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_codes_code_unique" UNIQUE("code"),
	CONSTRAINT "discount_codes_type_check" CHECK ("type" IN ('percentage', 'fixed')),
	CONSTRAINT "discount_codes_value_positive" CHECK ("value" > 0),
	CONSTRAINT "discount_codes_percentage_range" CHECK ("type" <> 'percentage' OR ("value" >= 1 AND "value" <= 100)),
	CONSTRAINT "discount_codes_min_order_value_nonneg" CHECK ("min_order_value" IS NULL OR "min_order_value" >= 0),
	CONSTRAINT "discount_codes_usage_limit_positive" CHECK ("usage_limit" IS NULL OR "usage_limit" > 0),
	CONSTRAINT "discount_codes_usage_count_nonneg" CHECK ("usage_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discount_codes_code_idx" ON "discount_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discount_codes_active_idx" ON "discount_codes" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discount_codes_expires_idx" ON "discount_codes" USING btree ("expires_at");
