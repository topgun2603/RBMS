CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"summary" text,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"image_url" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"seo" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_categories_tenant_slug_uq" UNIQUE("tenant_id","slug")
);
--> statement-breakpoint
CREATE TABLE "catalog_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"brand" text,
	"category_id" uuid,
	"hsn" text,
	"gst_rate" real DEFAULT 0 NOT NULL,
	"unit" text DEFAULT 'pcs' NOT NULL,
	"tax_inclusive" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"channels" text[] DEFAULT '{store,billing}'::text[] NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"seo" jsonb,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_products_tenant_slug_uq" UNIQUE("tenant_id","slug")
);
--> statement-breakpoint
CREATE TABLE "catalog_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text,
	"barcode" text,
	"title" text DEFAULT '' NOT NULL,
	"option_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"price" integer NOT NULL,
	"mrp" integer,
	"cost" integer,
	"weight_grams" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupon_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coupon_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" uuid NOT NULL,
	"customer_key" text,
	"amount" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupon_redemptions_ref_uq" UNIQUE("coupon_id","ref_type","ref_id")
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"type" text NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	"max_discount" integer,
	"min_order" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"usage_limit" integer,
	"per_customer_limit" integer,
	"first_order_only" boolean DEFAULT false NOT NULL,
	"applies_to" text DEFAULT 'all' NOT NULL,
	"target_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"channels" text[] DEFAULT '{store}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"status" text DEFAULT 'preview' NOT NULL,
	"file_name" text,
	"file_type" text,
	"file_size" integer,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rows" jsonb,
	"summary" jsonb NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"skip_invalid" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"type" text DEFAULT 'store' NOT NULL,
	"address" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_locations_tenant_code_uq" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
CREATE TABLE "stock_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" text NOT NULL,
	"location_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"released_at" timestamp with time zone,
	"committed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_reservations_tenant_ref_item_uq" UNIQUE("tenant_id","ref_type","ref_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "stock_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"from_location_id" uuid NOT NULL,
	"to_location_id" uuid NOT NULL,
	"lines" jsonb NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"type" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"message" text,
	"actor_user_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_series" (
	"tenant_id" uuid NOT NULL,
	"fy" text NOT NULL,
	"prefix" text NOT NULL,
	"next_seq" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_series_pk" PRIMARY KEY("tenant_id","fy")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"fy" text NOT NULL,
	"seq" integer NOT NULL,
	"channel" text NOT NULL,
	"customer" jsonb NOT NULL,
	"shipping_address" jsonb,
	"billing_address" jsonb,
	"lines" jsonb NOT NULL,
	"totals" jsonb NOT NULL,
	"total" integer NOT NULL,
	"paid" integer DEFAULT 0 NOT NULL,
	"refunded" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" text DEFAULT 'placed' NOT NULL,
	"payment_status" text DEFAULT 'unpaid' NOT NULL,
	"payment_method" text NOT NULL,
	"fulfillment" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stock_state" text DEFAULT 'none' NOT NULL,
	"coupon_code" text,
	"invoice_id" uuid,
	"invoice_number" text,
	"location_id" uuid,
	"notes" text,
	"customer_note" text,
	"cancel_reason" text,
	"access_token" text NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_tenant_fy_seq_uq" UNIQUE("tenant_id","fy","seq"),
	CONSTRAINT "orders_access_token_uq" UNIQUE("access_token")
);
--> statement-breakpoint
CREATE TABLE "tenant_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"permissions" text[] DEFAULT '{}' NOT NULL,
	"builtin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_roles_tenant_key_uq" UNIQUE("tenant_id","key")
);
--> statement-breakpoint
ALTER TABLE "stock_items" DROP CONSTRAINT "stock_items_tenant_item_uq";--> statement-breakpoint
ALTER TABLE "stock_items" ADD COLUMN "location_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_items" ADD COLUMN "reserved" numeric(14, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "location_id" uuid;--> statement-breakpoint
ALTER TABLE "catalog_variants" ADD CONSTRAINT "catalog_variants_product_id_catalog_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_tenant_created_idx" ON "audit_events" USING btree ("tenant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_events_tenant_entity_idx" ON "audit_events" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_events_created_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "catalog_categories_tenant_parent_idx" ON "catalog_categories" USING btree ("tenant_id","parent_id");--> statement-breakpoint
CREATE INDEX "catalog_products_tenant_name_idx" ON "catalog_products" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "catalog_products_tenant_category_idx" ON "catalog_products" USING btree ("tenant_id","category_id");--> statement-breakpoint
CREATE INDEX "catalog_variants_tenant_product_idx" ON "catalog_variants" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_variants_tenant_sku_uq" ON "catalog_variants" USING btree ("tenant_id","sku") WHERE "catalog_variants"."sku" is not null and "catalog_variants"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_variants_tenant_barcode_uq" ON "catalog_variants" USING btree ("tenant_id","barcode") WHERE "catalog_variants"."barcode" is not null and "catalog_variants"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "coupon_redemptions_coupon_status_idx" ON "coupon_redemptions" USING btree ("coupon_id","status");--> statement-breakpoint
CREATE INDEX "coupon_redemptions_tenant_ref_idx" ON "coupon_redemptions" USING btree ("tenant_id","ref_type","ref_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_tenant_code_uq" ON "coupons" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "coupons_tenant_created_idx" ON "coupons" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "import_jobs_tenant_created_idx" ON "import_jobs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_locations_tenant_default_uq" ON "stock_locations" USING btree ("tenant_id") WHERE "stock_locations"."is_default";--> statement-breakpoint
CREATE INDEX "stock_reservations_tenant_location_item_idx" ON "stock_reservations" USING btree ("tenant_id","location_id","item_id");--> statement-breakpoint
CREATE INDEX "stock_transfers_tenant_created_idx" ON "stock_transfers" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "order_events_tenant_idx" ON "order_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_tenant_placed_idx" ON "orders" USING btree ("tenant_id","placed_at");--> statement-breakpoint
CREATE INDEX "orders_tenant_status_placed_idx" ON "orders" USING btree ("tenant_id","status","placed_at");--> statement-breakpoint
CREATE INDEX "orders_tenant_account_idx" ON "orders" USING btree ("tenant_id",("customer"->>'accountId'));--> statement-breakpoint
CREATE INDEX "orders_tenant_phone_idx" ON "orders" USING btree ("tenant_id",("customer"->>'phone'));--> statement-breakpoint
CREATE INDEX "tenant_roles_tenant_idx" ON "tenant_roles" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "stock_items_tenant_item_idx" ON "stock_items" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "stock_movements_tenant_location_created_idx" ON "stock_movements" USING btree ("tenant_id","location_id","created_at");--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_tenant_location_item_uq" UNIQUE NULLS NOT DISTINCT("tenant_id","location_id","item_id");