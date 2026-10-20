CREATE TABLE "dining_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dining_areas_tenant_name_uq" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
CREATE TABLE "dining_kots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"business_date" date NOT NULL,
	"station" text DEFAULT 'kitchen' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"has_voids" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"served_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dining_kots_tenant_date_number_uq" UNIQUE("tenant_id","business_date","number")
);
--> statement-breakpoint
CREATE TABLE "dining_menu_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"station" text DEFAULT 'kitchen' NOT NULL,
	"veg" boolean,
	"available" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dining_menu_items_tenant_item_uq" UNIQUE("tenant_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "dining_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"item_id" uuid,
	"name" text NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"rate" integer NOT NULL,
	"gst_rate" real DEFAULT 5 NOT NULL,
	"hsn" text,
	"unit" text,
	"note" text,
	"station" text DEFAULT 'kitchen' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"kot_id" uuid,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"business_date" date NOT NULL,
	"type" text DEFAULT 'dine_in' NOT NULL,
	"source" text DEFAULT 'staff' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"table_id" uuid,
	"guests" integer,
	"customer_name" text,
	"customer_phone" text,
	"note" text,
	"invoice_ids" uuid[] DEFAULT '{}' NOT NULL,
	"external_ref" text,
	"opened_by" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dining_orders_tenant_date_number_uq" UNIQUE("tenant_id","business_date","number")
);
--> statement-breakpoint
CREATE TABLE "dining_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"area_id" uuid,
	"name" text NOT NULL,
	"seats" integer DEFAULT 4 NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"qr_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dining_tables_tenant_name_uq" UNIQUE("tenant_id","name"),
	CONSTRAINT "dining_tables_qr_token_uq" UNIQUE("qr_token")
);
--> statement-breakpoint
CREATE INDEX "dining_kots_tenant_status_idx" ON "dining_kots" USING btree ("tenant_id","status","station");--> statement-breakpoint
CREATE INDEX "dining_kots_tenant_order_idx" ON "dining_kots" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE INDEX "dining_order_items_tenant_order_idx" ON "dining_order_items" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE INDEX "dining_order_items_tenant_kot_idx" ON "dining_order_items" USING btree ("tenant_id","kot_id");--> statement-breakpoint
CREATE INDEX "dining_orders_tenant_status_idx" ON "dining_orders" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "dining_orders_tenant_table_idx" ON "dining_orders" USING btree ("tenant_id","table_id","status");--> statement-breakpoint
CREATE INDEX "dining_orders_tenant_external_idx" ON "dining_orders" USING btree ("tenant_id","external_ref");--> statement-breakpoint
CREATE INDEX "dining_tables_tenant_area_idx" ON "dining_tables" USING btree ("tenant_id","area_id");