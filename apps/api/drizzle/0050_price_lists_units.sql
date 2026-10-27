CREATE TABLE "catalog_item_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"unit" text NOT NULL,
	"factor" numeric(14, 6) NOT NULL,
	"barcode" text,
	"price" integer,
	"mrp" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price_list_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_pricing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"group_id" uuid,
	"price_list_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"price_list_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"unit" text,
	"min_qty" numeric(14, 3) DEFAULT '0' NOT NULL,
	"price" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"adjust_pct" real,
	"round_rupee" boolean DEFAULT false NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_item_units" ADD CONSTRAINT "catalog_item_units_variant_id_catalog_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."catalog_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_groups" ADD CONSTRAINT "customer_groups_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_pricing" ADD CONSTRAINT "customer_pricing_group_id_customer_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."customer_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_pricing" ADD CONSTRAINT "customer_pricing_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_item_units_variant_unit_uq" ON "catalog_item_units" USING btree ("tenant_id","variant_id",lower("unit"));--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_item_units_tenant_barcode_uq" ON "catalog_item_units" USING btree ("tenant_id","barcode") WHERE "catalog_item_units"."barcode" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_groups_tenant_name_uq" ON "customer_groups" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "customer_pricing_tenant_customer_uq" ON "customer_pricing" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "customer_pricing_tenant_group_idx" ON "customer_pricing" USING btree ("tenant_id","group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_list_items_list_item_unit_qty_uq" ON "price_list_items" USING btree ("tenant_id","price_list_id","item_id",coalesce(lower("unit"), ''),"min_qty");--> statement-breakpoint
CREATE INDEX "price_list_items_tenant_item_idx" ON "price_list_items" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_lists_tenant_name_uq" ON "price_lists" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "price_lists_tenant_default_uq" ON "price_lists" USING btree ("tenant_id") WHERE "price_lists"."is_default";