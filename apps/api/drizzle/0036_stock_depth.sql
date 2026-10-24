CREATE TABLE "stock_audit_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"audit_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"mode" text DEFAULT 'add' NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"counter" text NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_audit_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"audit_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_id" uuid,
	"item_name" text NOT NULL,
	"unit" text,
	"barcode" text,
	"sku" text,
	"batch_no" text,
	"expiry" date,
	"system_qty" numeric(14, 3) NOT NULL,
	"counted_qty" numeric(14, 3),
	"unit_cost" integer,
	"reason" text,
	"note" text,
	"applied_at" timestamp with time zone,
	CONSTRAINT "stock_audit_lines_audit_item_batch_uq" UNIQUE NULLS NOT DISTINCT("audit_id","item_id","batch_id")
);
--> statement-breakpoint
CREATE TABLE "stock_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"location_id" uuid NOT NULL,
	"category_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"title" text,
	"note" text,
	"snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"started_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"totals" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_audits_tenant_number_uq" UNIQUE("tenant_id","number")
);
--> statement-breakpoint
CREATE TABLE "stock_batch_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_batch_items_tenant_item_uq" UNIQUE("tenant_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "stock_batch_levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"qty" numeric(14, 3) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_batch_levels_tenant_batch_loc_uq" UNIQUE("tenant_id","batch_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "stock_batch_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"delta" numeric(14, 3) NOT NULL,
	"qty_after" numeric(14, 3) NOT NULL,
	"reason" text NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"ref_number" text,
	"source_ref_id" text,
	"unit_cost" integer,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_batch_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"track_all" boolean DEFAULT false NOT NULL,
	"expired_policy" text DEFAULT 'warn' NOT NULL,
	"pick_rule" text DEFAULT 'fefo' NOT NULL,
	"alert_days" integer DEFAULT 30 NOT NULL,
	"discount_ladder" jsonb DEFAULT '[{"days":30,"pct":20},{"days":60,"pct":10},{"days":90,"pct":5}]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_no" text NOT NULL,
	"mfg_date" date,
	"expiry" date,
	"mrp" integer,
	"cost" integer,
	"supplier_name" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_batches_tenant_item_batch_uq" UNIQUE("tenant_id","item_id","batch_no")
);
--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "number" text;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "status" text DEFAULT 'closed' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "sent_by" uuid;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "received_by" uuid;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "transport" text;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "receive_note" text;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
CREATE INDEX "stock_audit_entries_tenant_line_idx" ON "stock_audit_entries" USING btree ("tenant_id","line_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_audit_lines_tenant_audit_idx" ON "stock_audit_lines" USING btree ("tenant_id","audit_id");--> statement-breakpoint
CREATE INDEX "stock_audit_lines_tenant_barcode_idx" ON "stock_audit_lines" USING btree ("tenant_id","audit_id","barcode");--> statement-breakpoint
CREATE INDEX "stock_audits_tenant_status_idx" ON "stock_audits" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "stock_batch_levels_tenant_item_loc_idx" ON "stock_batch_levels" USING btree ("tenant_id","item_id","location_id");--> statement-breakpoint
CREATE INDEX "stock_batch_movements_tenant_batch_idx" ON "stock_batch_movements" USING btree ("tenant_id","batch_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_batch_movements_tenant_ref_idx" ON "stock_batch_movements" USING btree ("tenant_id","ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "stock_batch_movements_tenant_source_idx" ON "stock_batch_movements" USING btree ("tenant_id","source_ref_id");--> statement-breakpoint
CREATE INDEX "stock_batches_tenant_expiry_idx" ON "stock_batches" USING btree ("tenant_id","expiry");--> statement-breakpoint
CREATE INDEX "stock_batches_tenant_item_idx" ON "stock_batches" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "stock_transfers_tenant_status_idx" ON "stock_transfers" USING btree ("tenant_id","status");