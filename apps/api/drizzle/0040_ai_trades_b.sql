CREATE TABLE "ai_photo_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text DEFAULT 'catalogue-photos' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"done" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"credits" integer DEFAULT 0 NOT NULL,
	"drafts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"problems" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_product_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"source_name" text NOT NULL,
	"image_url" text,
	"proposal" jsonb,
	"applied" jsonb,
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
CREATE INDEX "ai_photo_batches_tenant_idx" ON "ai_photo_batches" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_product_tags_uq" ON "ai_product_tags" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE INDEX "ai_product_tags_batch_idx" ON "ai_product_tags" USING btree ("tenant_id","batch_id");