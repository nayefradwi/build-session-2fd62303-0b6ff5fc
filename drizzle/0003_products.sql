CREATE TABLE IF NOT EXISTS "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(120) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"url" text NOT NULL,
	"alt" varchar(300),
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(200) NOT NULL,
	"sku" varchar(64) NOT NULL,
	"name" varchar(300) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category_id" uuid,
	"price_cents" integer NOT NULL,
	"compare_at_price_cents" integer,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"size" varchar(32),
	"material" varchar(64),
	"color" varchar(32),
	"stock" integer DEFAULT 0 NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"is_new" boolean DEFAULT false NOT NULL,
	"rating_average" numeric(3, 2) DEFAULT '0' NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"sales_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_slug_unique" UNIQUE("slug"),
	CONSTRAINT "products_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "categories_slug_idx" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "categories_parent_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_images_product_idx" ON "product_images" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_images_product_position_idx" ON "product_images" USING btree ("product_id","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_slug_idx" ON "products" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_sku_idx" ON "products" USING btree ("sku");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_category_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_price_idx" ON "products" USING btree ("price_cents");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_created_at_idx" ON "products" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_rating_idx" ON "products" USING btree ("rating_average");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_sales_idx" ON "products" USING btree ("sales_count");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_size_idx" ON "products" USING btree ("size");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_material_idx" ON "products" USING btree ("material");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_color_idx" ON "products" USING btree ("color");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_stock_idx" ON "products" USING btree ("stock");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_featured_idx" ON "products" USING btree ("is_featured");--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "search_vector" tsvector
	GENERATED ALWAYS AS (
		setweight(to_tsvector('english', coalesce("name", '')), 'A') ||
		setweight(to_tsvector('english', coalesce("description", '')), 'B')
	) STORED;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_search_idx" ON "products" USING GIN ("search_vector");