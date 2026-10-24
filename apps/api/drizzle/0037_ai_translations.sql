CREATE TABLE "ai_product_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"locale" text DEFAULT 'ta' NOT NULL,
	"batch_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"source_name" text NOT NULL,
	"source_description" text,
	"name" text,
	"description" text,
	"removed" jsonb,
	"run_id" uuid,
	"credits" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_by" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_product_translations_uq" ON "ai_product_translations" USING btree ("tenant_id","product_id","locale");--> statement-breakpoint
CREATE INDEX "ai_product_translations_batch_idx" ON "ai_product_translations" USING btree ("tenant_id","batch_id");