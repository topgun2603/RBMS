CREATE TABLE "jewellery_exchanges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"date" date NOT NULL,
	"customer_name" text NOT NULL,
	"customer_phone" text,
	"lines" jsonb NOT NULL,
	"total" integer NOT NULL,
	"invoice_id" uuid,
	"applied_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"note" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jewellery_exchanges_tenant_number_uq" UNIQUE("tenant_id","number")
);
--> statement-breakpoint
CREATE TABLE "jewellery_pieces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"metal" text NOT NULL,
	"purity" text NOT NULL,
	"gross_weight" numeric(10, 3) NOT NULL,
	"stone_weight" numeric(10, 3) DEFAULT '0' NOT NULL,
	"net_weight" numeric(10, 3) NOT NULL,
	"wastage_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"making_type" text DEFAULT 'per_gram' NOT NULL,
	"making_value" integer DEFAULT 0 NOT NULL,
	"stone_charges" integer DEFAULT 0 NOT NULL,
	"huid" text,
	"tag_no" text,
	"status" text DEFAULT 'in_stock' NOT NULL,
	"price_updated_at" timestamp with time zone,
	"last_price" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jewellery_pieces_tenant_item_uq" UNIQUE("tenant_id","item_id"),
	CONSTRAINT "jewellery_pieces_tenant_huid_uq" UNIQUE("tenant_id","huid"),
	CONSTRAINT "jewellery_pieces_tenant_tag_uq" UNIQUE("tenant_id","tag_no")
);
--> statement-breakpoint
CREATE TABLE "jewellery_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"date" date NOT NULL,
	"metal" text NOT NULL,
	"purity" text NOT NULL,
	"rate_per_gram" integer NOT NULL,
	"set_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jewellery_rates_tenant_date_metal_purity_uq" UNIQUE("tenant_id","date","metal","purity")
);
--> statement-breakpoint
CREATE TABLE "scale_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"plu" integer NOT NULL,
	"sold_by" text DEFAULT 'weight' NOT NULL,
	"tare_grams" integer DEFAULT 0 NOT NULL,
	"unit_label" text DEFAULT 'kg' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"price_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scale_items_tenant_item_uq" UNIQUE("tenant_id","item_id"),
	CONSTRAINT "scale_items_tenant_plu_uq" UNIQUE("tenant_id","plu"),
	CONSTRAINT "scale_items_plu_range" CHECK ("scale_items"."plu" between 1 and 99999),
	CONSTRAINT "scale_items_tare_range" CHECK ("scale_items"."tare_grams" >= 0)
);
--> statement-breakpoint
CREATE TABLE "serial_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"type" text NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"ref_number" text,
	"note" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "serial_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"tracked" boolean DEFAULT true NOT NULL,
	"warranty_months" integer DEFAULT 12 NOT NULL,
	"dual_imei" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "serial_items_tenant_item_uq" UNIQUE("tenant_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "serial_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"item_name" text NOT NULL,
	"serial" text NOT NULL,
	"serial2" text,
	"status" text DEFAULT 'in_stock' NOT NULL,
	"purchase_ref" text,
	"supplier" text,
	"cost_paise" integer,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invoice_id" uuid,
	"invoice_number" text,
	"sold_at" timestamp with time zone,
	"sold_on" date,
	"customer_name" text,
	"customer_phone" text,
	"warranty_months" integer DEFAULT 12 NOT NULL,
	"warranty_end" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "serial_units_tenant_serial_uq" UNIQUE("tenant_id","serial")
);
--> statement-breakpoint
CREATE INDEX "jewellery_exchanges_tenant_date_idx" ON "jewellery_exchanges" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "jewellery_exchanges_tenant_invoice_idx" ON "jewellery_exchanges" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE INDEX "jewellery_pieces_tenant_metal_status_idx" ON "jewellery_pieces" USING btree ("tenant_id","metal","status");--> statement-breakpoint
CREATE INDEX "jewellery_rates_tenant_metal_date_idx" ON "jewellery_rates" USING btree ("tenant_id","metal","date");--> statement-breakpoint
CREATE INDEX "scale_items_tenant_name_idx" ON "scale_items" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "serial_events_tenant_unit_idx" ON "serial_events" USING btree ("tenant_id","unit_id","created_at");--> statement-breakpoint
CREATE INDEX "serial_events_tenant_ref_idx" ON "serial_events" USING btree ("tenant_id","ref_id","type");--> statement-breakpoint
CREATE INDEX "serial_items_tenant_name_idx" ON "serial_items" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "serial_units_tenant_serial2_uq" ON "serial_units" USING btree ("tenant_id","serial2") WHERE "serial_units"."serial2" is not null;--> statement-breakpoint
CREATE INDEX "serial_units_tenant_status_idx" ON "serial_units" USING btree ("tenant_id","status","received_at");--> statement-breakpoint
CREATE INDEX "serial_units_tenant_item_idx" ON "serial_units" USING btree ("tenant_id","item_id","status");--> statement-breakpoint
CREATE INDEX "serial_units_tenant_invoice_idx" ON "serial_units" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE INDEX "serial_units_tenant_warranty_idx" ON "serial_units" USING btree ("tenant_id","warranty_end");