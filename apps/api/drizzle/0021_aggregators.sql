CREATE TABLE "aggregator_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"webhook_key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"username" text,
	"api_key_enc" text,
	"webhook_secret_enc" text,
	"store_ref" text,
	"base_url" text,
	"platforms" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"auto_accept" boolean DEFAULT false NOT NULL,
	"prep_minutes" integer DEFAULT 20 NOT NULL,
	"last_webhook_at" timestamp with time zone,
	"last_error" text,
	"menu_pushed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aggregator_connections_tenant_provider_uq" UNIQUE("tenant_id","provider"),
	CONSTRAINT "aggregator_connections_key_uq" UNIQUE("webhook_key")
);
--> statement-breakpoint
CREATE TABLE "aggregator_item_maps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aggregator_item_maps_tenant_ext_uq" UNIQUE("tenant_id","provider","external_id")
);
--> statement-breakpoint
CREATE TABLE "aggregator_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"platform_order_id" text,
	"type" text DEFAULT 'delivery' NOT NULL,
	"status" text DEFAULT 'placed' NOT NULL,
	"dining_order_id" uuid,
	"kitchen_number" integer,
	"order" jsonb NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unmapped" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"payment" text DEFAULT 'prepaid' NOT NULL,
	"tax_mode" text DEFAULT 'eco_9_5' NOT NULL,
	"value_of_supply" integer DEFAULT 0 NOT NULL,
	"gst" integer DEFAULT 0 NOT NULL,
	"operator_gstin" text,
	"placed_at" timestamp with time zone NOT NULL,
	"expected_pickup_at" timestamp with time zone,
	"prep_minutes" integer,
	"accepted_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"dispatched_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"reason" text,
	"rider" jsonb,
	"callbacks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"kitchen_error" text,
	"test" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aggregator_orders_tenant_ext_uq" UNIQUE("tenant_id","provider","external_id")
);
--> statement-breakpoint
ALTER TABLE "dining_orders" ADD COLUMN "platform" text;--> statement-breakpoint
ALTER TABLE "dining_orders" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dining_orders" ADD COLUMN "tax_by_operator" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "aggregator_item_maps_tenant_item_idx" ON "aggregator_item_maps" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "aggregator_orders_tenant_status_idx" ON "aggregator_orders" USING btree ("tenant_id","status","placed_at");--> statement-breakpoint
CREATE INDEX "aggregator_orders_tenant_dining_idx" ON "aggregator_orders" USING btree ("tenant_id","dining_order_id");