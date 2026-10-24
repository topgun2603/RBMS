CREATE TABLE "gst_2b_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"month" text NOT NULL,
	"gstin" text,
	"filename" text,
	"format" text DEFAULT 'json' NOT NULL,
	"generated_on" text,
	"row_count" integer DEFAULT 0 NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"imported_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gst_2b_imports_tenant_month_uq" UNIQUE("tenant_id","month")
);
--> statement-breakpoint
CREATE TABLE "gst_2b_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"month" text NOT NULL,
	"section" text DEFAULT 'b2b' NOT NULL,
	"supplier_gstin" text NOT NULL,
	"supplier_name" text,
	"doc_kind" text DEFAULT 'inv' NOT NULL,
	"doc_number" text NOT NULL,
	"doc_date" date,
	"doc_value" integer DEFAULT 0 NOT NULL,
	"pos" text,
	"reverse_charge" boolean DEFAULT false NOT NULL,
	"itc_available" boolean DEFAULT true NOT NULL,
	"reason" text,
	"taxable" integer DEFAULT 0 NOT NULL,
	"igst" integer DEFAULT 0 NOT NULL,
	"cgst" integer DEFAULT 0 NOT NULL,
	"sgst" integer DEFAULT 0 NOT NULL,
	"cess" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'missing_in_books' NOT NULL,
	"matched_type" text,
	"matched_id" uuid,
	"diff" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"action" text,
	"action_note" text,
	"action_by" uuid,
	"action_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gst_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"month" text NOT NULL,
	"kind" text NOT NULL,
	"taxable" integer DEFAULT 0 NOT NULL,
	"igst" integer DEFAULT 0 NOT NULL,
	"cgst" integer DEFAULT 0 NOT NULL,
	"sgst" integer DEFAULT 0 NOT NULL,
	"cess" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gst_advances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"month" text NOT NULL,
	"kind" text NOT NULL,
	"pos" text NOT NULL,
	"rate" real NOT NULL,
	"amount" integer NOT NULL,
	"cess" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gst_doc_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"doc_type" text NOT NULL,
	"doc_id" uuid NOT NULL,
	"itc_status" text,
	"itc_class" text,
	"reversal_reason" text,
	"reason" text,
	"claim_month" text,
	"reversal_month" text,
	"rcm" boolean DEFAULT false NOT NULL,
	"rcm_category" text,
	"rcm_rate" real,
	"rcm_taxable" integer,
	"rcm_import" boolean DEFAULT false NOT NULL,
	"rcm_paid_on" date,
	"rcm_paid_amount" integer,
	"rcm_challan" text,
	"note" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gst_doc_flags_tenant_doc_uq" UNIQUE("tenant_id","doc_type","doc_id")
);
--> statement-breakpoint
CREATE TABLE "gst_filings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"return_type" text NOT NULL,
	"period" text NOT NULL,
	"filed_on" date NOT NULL,
	"arn" text,
	"note" text,
	"filed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gst_filings_tenant_return_period_uq" UNIQUE("tenant_id","return_type","period")
);
--> statement-breakpoint
CREATE TABLE "gst_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"composition" boolean DEFAULT false NOT NULL,
	"composition_from" date,
	"composition_type" text DEFAULT 'trader' NOT NULL,
	"qrmp" boolean DEFAULT false NOT NULL,
	"qrmp_from" date,
	"rcm_categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"zero_rate_class" text DEFAULT 'nil' NOT NULL,
	"zero_rate_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gstin" text,
	"prior_turnover" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gst_settings_tenant_uq" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE "gst_tax_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"period" text NOT NULL,
	"paid_on" date NOT NULL,
	"igst" integer DEFAULT 0 NOT NULL,
	"cgst" integer DEFAULT 0 NOT NULL,
	"sgst" integer DEFAULT 0 NOT NULL,
	"cess" integer DEFAULT 0 NOT NULL,
	"interest" integer DEFAULT 0 NOT NULL,
	"late_fee" integer DEFAULT 0 NOT NULL,
	"method" text DEFAULT 'bank' NOT NULL,
	"challan" text,
	"note" text,
	"status" text DEFAULT 'paid' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "gst_2b_rows_tenant_month_idx" ON "gst_2b_rows" USING btree ("tenant_id","month");--> statement-breakpoint
CREATE INDEX "gst_2b_rows_import_idx" ON "gst_2b_rows" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "gst_2b_rows_tenant_matched_idx" ON "gst_2b_rows" USING btree ("tenant_id","matched_type","matched_id");--> statement-breakpoint
CREATE INDEX "gst_adjustments_tenant_month_idx" ON "gst_adjustments" USING btree ("tenant_id","month");--> statement-breakpoint
CREATE INDEX "gst_advances_tenant_month_idx" ON "gst_advances" USING btree ("tenant_id","month");--> statement-breakpoint
CREATE INDEX "gst_doc_flags_tenant_idx" ON "gst_doc_flags" USING btree ("tenant_id","doc_type");--> statement-breakpoint
CREATE INDEX "gst_tax_payments_tenant_idx" ON "gst_tax_payments" USING btree ("tenant_id","paid_on");