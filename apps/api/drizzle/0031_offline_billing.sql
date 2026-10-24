CREATE TABLE "pos_number_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"terminal_id" uuid,
	"branch_id" uuid,
	"fy" text NOT NULL,
	"prefix" text NOT NULL,
	"from_seq" integer NOT NULL,
	"to_seq" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"voided" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reserved_by" uuid,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"close_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_number_blocks_range_chk" CHECK ("pos_number_blocks"."to_seq" >= "pos_number_blocks"."from_seq")
);
--> statement-breakpoint
CREATE TABLE "pos_offline_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"user_id" uuid,
	"status" text DEFAULT 'processing' NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"billed_at" timestamp with time zone NOT NULL,
	"block_id" uuid,
	"seq" integer,
	"provisional_number" text,
	"invoice_id" uuid,
	"number" text,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" jsonb,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"review_note" text,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "pos_number_blocks_tenant_device_idx" ON "pos_number_blocks" USING btree ("tenant_id","device_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_offline_bills_tenant_client_uq" ON "pos_offline_bills" USING btree ("tenant_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_offline_bills_block_seq_uq" ON "pos_offline_bills" USING btree ("block_id","seq") WHERE "pos_offline_bills"."block_id" is not null;--> statement-breakpoint
CREATE INDEX "pos_offline_bills_tenant_status_idx" ON "pos_offline_bills" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "pos_offline_bills_tenant_invoice_idx" ON "pos_offline_bills" USING btree ("tenant_id","invoice_id");