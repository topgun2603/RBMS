CREATE TABLE "landed_cost_vouchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"purchase_id" uuid NOT NULL,
	"charge_purchase_id" uuid,
	"owns_charge_bill" boolean DEFAULT false NOT NULL,
	"kind" text NOT NULL,
	"description" text,
	"amount" integer NOT NULL,
	"gst" integer DEFAULT 0 NOT NULL,
	"claimable" boolean DEFAULT true NOT NULL,
	"basis" text DEFAULT 'value' NOT NULL,
	"allocations" jsonb NOT NULL,
	"to_stock" integer NOT NULL,
	"to_sold" integer NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"created_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "landed_cost_vouchers_tenant_number_uq" UNIQUE("tenant_id","number")
);
--> statement-breakpoint
CREATE TABLE "stock_cost_draws" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"layer_id" uuid,
	"movement_id" uuid,
	"item_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"kind" text DEFAULT 'out' NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"value" bigint NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_cost_layers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"seq" bigserial NOT NULL,
	"item_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"batch_id" uuid,
	"movement_id" uuid,
	"ref_type" text,
	"ref_id" text,
	"received_at" timestamp with time zone NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"remaining" numeric(14, 3) NOT NULL,
	"value" bigint NOT NULL,
	"remaining_value" bigint NOT NULL,
	"unit_cost" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_valuation_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"method" text DEFAULT 'average' NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"layers_built_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "charges" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "charges" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "cost_avg" bigint;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "cost_fifo" bigint;--> statement-breakpoint
CREATE INDEX "landed_cost_vouchers_tenant_purchase_idx" ON "landed_cost_vouchers" USING btree ("tenant_id","purchase_id");--> statement-breakpoint
CREATE INDEX "landed_cost_vouchers_tenant_date_idx" ON "landed_cost_vouchers" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "stock_cost_draws_tenant_movement_idx" ON "stock_cost_draws" USING btree ("tenant_id","movement_id");--> statement-breakpoint
CREATE INDEX "stock_cost_draws_tenant_layer_idx" ON "stock_cost_draws" USING btree ("tenant_id","layer_id");--> statement-breakpoint
CREATE INDEX "stock_cost_draws_tenant_at_idx" ON "stock_cost_draws" USING btree ("tenant_id","at");--> statement-breakpoint
CREATE INDEX "stock_cost_layers_open_idx" ON "stock_cost_layers" USING btree ("tenant_id","item_id","location_id","received_at","seq") WHERE "stock_cost_layers"."remaining" > 0;--> statement-breakpoint
CREATE INDEX "stock_cost_layers_tenant_ref_idx" ON "stock_cost_layers" USING btree ("tenant_id","ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "stock_cost_layers_tenant_received_idx" ON "stock_cost_layers" USING btree ("tenant_id","received_at");