CREATE TABLE "medicine_batch_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"delta" numeric(14, 3) NOT NULL,
	"qty_after" numeric(14, 3) NOT NULL,
	"reason" text NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"ref_number" text,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medicine_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"item_name" text NOT NULL,
	"batch_no" text NOT NULL,
	"expiry" date NOT NULL,
	"mrp" integer,
	"purchase_rate" integer,
	"qty" numeric(14, 3) DEFAULT '0' NOT NULL,
	"supplier" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "medicine_batches_tenant_item_batch_uq" UNIQUE("tenant_id","item_id","batch_no")
);
--> statement-breakpoint
CREATE TABLE "medicine_prescriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid,
	"invoice_number" text,
	"patient_name" text NOT NULL,
	"patient_age" integer,
	"patient_phone" text,
	"patient_address" text,
	"doctor_name" text NOT NULL,
	"doctor_reg_no" text,
	"doctor_address" text,
	"rx_date" date NOT NULL,
	"image_url" text,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medicines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"composition" text,
	"manufacturer" text,
	"schedule" text DEFAULT 'otc' NOT NULL,
	"pack_size" integer DEFAULT 1 NOT NULL,
	"pack_unit" text DEFAULT 'strip' NOT NULL,
	"rack" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "medicines_tenant_item_uq" UNIQUE("tenant_id","item_id")
);
--> statement-breakpoint
CREATE INDEX "medicine_batch_movements_tenant_batch_idx" ON "medicine_batch_movements" USING btree ("tenant_id","batch_id","created_at");--> statement-breakpoint
CREATE INDEX "medicine_batch_movements_tenant_ref_idx" ON "medicine_batch_movements" USING btree ("tenant_id","ref_id");--> statement-breakpoint
CREATE INDEX "medicine_batch_movements_tenant_reason_idx" ON "medicine_batch_movements" USING btree ("tenant_id","reason","created_at");--> statement-breakpoint
CREATE INDEX "medicine_batches_tenant_expiry_idx" ON "medicine_batches" USING btree ("tenant_id","expiry");--> statement-breakpoint
CREATE INDEX "medicine_batches_tenant_item_idx" ON "medicine_batches" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "medicine_prescriptions_tenant_invoice_idx" ON "medicine_prescriptions" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE INDEX "medicine_prescriptions_tenant_date_idx" ON "medicine_prescriptions" USING btree ("tenant_id","rx_date");--> statement-breakpoint
CREATE INDEX "medicines_tenant_name_idx" ON "medicines" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "medicines_tenant_composition_idx" ON "medicines" USING btree ("tenant_id","composition");