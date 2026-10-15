-- pg_trgm must exist before catalog_products_search_trgm_idx (gin_trgm_ops) below.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "analytics_daily" (
	"tenant_id" uuid NOT NULL,
	"date" date NOT NULL,
	"metric" text NOT NULL,
	"dimension" text DEFAULT '' NOT NULL,
	"value" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_daily_pk" PRIMARY KEY("tenant_id","date","metric","dimension")
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"type" text NOT NULL,
	"session_id" text NOT NULL,
	"anonymous_id" text NOT NULL,
	"path" text,
	"product_id" uuid,
	"variant_id" uuid,
	"value" integer,
	"query" text,
	"referrer_host" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"device" text NOT NULL,
	"ip_hash" text
);
--> statement-breakpoint
CREATE TABLE "catalog_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"image_url" text,
	"type" text DEFAULT 'manual' NOT NULL,
	"product_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"rule" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"seo" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_collections_tenant_slug_uq" UNIQUE("tenant_id","slug")
);
--> statement-breakpoint
CREATE TABLE "cms_home" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"draft" jsonb,
	"published" jsonb,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_menus" (
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cms_menus_pk" PRIMARY KEY("tenant_id","key")
);
--> statement-breakpoint
CREATE TABLE "cms_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"seo" jsonb,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cms_pages_tenant_slug_uq" UNIQUE("tenant_id","slug")
);
--> statement-breakpoint
CREATE TABLE "cms_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text,
	"cover_url" text,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"author_name" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"seo" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cms_posts_tenant_slug_uq" UNIQUE("tenant_id","slug")
);
--> statement-breakpoint
CREATE TABLE "delivery_accounts" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'shiprocket' NOT NULL,
	"credentials_enc" text NOT NULL,
	"pickup_location" text DEFAULT 'Primary' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"default_package" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"zone_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'flat' NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"free_above" integer,
	"weight_slabs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"eta_min_days" integer DEFAULT 2 NOT NULL,
	"eta_max_days" integer DEFAULT 7 NOT NULL,
	"cod_allowed" boolean DEFAULT true NOT NULL,
	"cod_fee" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"states" text[] DEFAULT '{}'::text[] NOT NULL,
	"pincode_prefixes" text[] DEFAULT '{}'::text[] NOT NULL,
	"pincodes" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pincode_cache" (
	"pincode" text PRIMARY KEY NOT NULL,
	"found" boolean NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"district" text DEFAULT '' NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"state_code" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_order_id" text,
	"provider_shipment_id" text,
	"awb" text,
	"courier" text,
	"status" text DEFAULT 'created' NOT NULL,
	"label_url" text,
	"tracking_url" text,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cost" integer,
	"tracked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"builtin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_categories_tenant_name_uq" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"date" date NOT NULL,
	"category_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"gst_rate" real DEFAULT 0 NOT NULL,
	"gst_amount" integer DEFAULT 0 NOT NULL,
	"vendor_name" text,
	"vendor_gstin" text,
	"payment_method" text DEFAULT 'cash' NOT NULL,
	"reference" text,
	"note" text,
	"receipt_url" text,
	"status" text DEFAULT 'recorded' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_state" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"skipped" text[] DEFAULT '{}'::text[] NOT NULL,
	"dismissed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"author_name" text NOT NULL,
	"order_id" uuid,
	"rating" integer NOT NULL,
	"title" text,
	"body" text,
	"photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"helpful_count" integer DEFAULT 0 NOT NULL,
	"reply" text,
	"replied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_reviews_tenant_product_user_uq" UNIQUE("tenant_id","product_id","user_id"),
	CONSTRAINT "product_reviews_rating_ck" CHECK ("product_reviews"."rating" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "review_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_votes_review_user_uq" UNIQUE("review_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "store_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"label" text,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"line1" text NOT NULL,
	"line2" text,
	"landmark" text,
	"city" text NOT NULL,
	"district" text,
	"state_code" text NOT NULL,
	"pincode" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_carts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"token" text NOT NULL,
	"customer_id" uuid,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"coupon_code" text,
	"pincode" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "store_carts_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "store_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"phone" text,
	"email" text,
	"marketing_opt_in" boolean DEFAULT false NOT NULL,
	"orders_count" integer DEFAULT 0 NOT NULL,
	"total_spent" integer DEFAULT 0 NOT NULL,
	"last_order_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_customers_tenant_user_uq" UNIQUE("tenant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "store_wishlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_wishlist_uq" UNIQUE("tenant_id","customer_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "catalog_products" ADD COLUMN "search_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_products" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, "search_text")) STORED;--> statement-breakpoint
ALTER TABLE "tenant_domains" ADD COLUMN "verification_token" text;--> statement-breakpoint
ALTER TABLE "tenant_domains" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_domains" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_rates" ADD CONSTRAINT "delivery_rates_zone_id_delivery_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."delivery_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_votes" ADD CONSTRAINT "review_votes_review_id_product_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."product_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_events_tenant_at_idx" ON "analytics_events" USING btree ("tenant_id","at");--> statement-breakpoint
CREATE INDEX "analytics_events_at_idx" ON "analytics_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "cms_pages_tenant_status_idx" ON "cms_pages" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "cms_posts_tenant_status_published_idx" ON "cms_posts" USING btree ("tenant_id","status","published_at");--> statement-breakpoint
CREATE INDEX "cms_posts_tags_idx" ON "cms_posts" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "delivery_rates_tenant_zone_idx" ON "delivery_rates" USING btree ("tenant_id","zone_id","sort");--> statement-breakpoint
CREATE INDEX "delivery_zones_tenant_idx" ON "delivery_zones" USING btree ("tenant_id","sort");--> statement-breakpoint
CREATE INDEX "shipments_tenant_order_idx" ON "shipments" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE INDEX "shipments_tenant_awb_idx" ON "shipments" USING btree ("tenant_id","awb");--> statement-breakpoint
CREATE INDEX "shipments_provider_status_idx" ON "shipments" USING btree ("provider","status","tracked_at");--> statement-breakpoint
CREATE INDEX "expenses_tenant_date_idx" ON "expenses" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "expenses_tenant_category_idx" ON "expenses" USING btree ("tenant_id","category_id");--> statement-breakpoint
CREATE INDEX "product_reviews_tenant_product_status_idx" ON "product_reviews" USING btree ("tenant_id","product_id","status");--> statement-breakpoint
CREATE INDEX "product_reviews_tenant_status_created_idx" ON "product_reviews" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "store_addresses_customer_idx" ON "store_addresses" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "store_carts_customer_idx" ON "store_carts" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "store_carts_expires_idx" ON "store_carts" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "catalog_products_search_trgm_idx" ON "catalog_products" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "catalog_products_search_tsv_idx" ON "catalog_products" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "tenant_domains_verified_idx" ON "tenant_domains" USING btree ("verified");