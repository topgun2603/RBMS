CREATE TABLE "quotation_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"fy" text NOT NULL,
	"prefix" text NOT NULL,
	"next_seq" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotation_series_tenant_branch_fy_uq" UNIQUE NULLS NOT DISTINCT("tenant_id","branch_id","fy")
);
--> statement-breakpoint
CREATE TABLE "quotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"rev" integer DEFAULT 1 NOT NULL,
	"latest" boolean DEFAULT true NOT NULL,
	"branch_id" uuid,
	"customer_id" uuid,
	"customer" jsonb NOT NULL,
	"seller" jsonb NOT NULL,
	"number" text NOT NULL,
	"fy" text NOT NULL,
	"seq" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"date" date NOT NULL,
	"valid_until" date NOT NULL,
	"place_of_supply" text NOT NULL,
	"inter_state" boolean DEFAULT false NOT NULL,
	"lines" jsonb NOT NULL,
	"totals" jsonb NOT NULL,
	"total" integer NOT NULL,
	"notes" text,
	"terms" text,
	"delivery_text" text,
	"advance_percent" integer,
	"share_token" text,
	"sent_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"responded_by" text,
	"response_note" text,
	"converted_kind" text,
	"converted_id" uuid,
	"converted_number" text,
	"converted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotations_share_token_uq" UNIQUE("share_token")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "quotations_tenant_branch_fy_seq_rev_uq" ON "quotations" USING btree ("tenant_id",coalesce("branch_id", '00000000-0000-0000-0000-000000000000'::uuid),"fy","seq","rev");--> statement-breakpoint
CREATE INDEX "quotations_tenant_latest_date_idx" ON "quotations" USING btree ("tenant_id","latest","date");--> statement-breakpoint
CREATE INDEX "quotations_tenant_group_idx" ON "quotations" USING btree ("tenant_id","group_id");--> statement-breakpoint
CREATE INDEX "quotations_tenant_customer_idx" ON "quotations" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "quotations_tenant_converted_idx" ON "quotations" USING btree ("tenant_id","converted_id");