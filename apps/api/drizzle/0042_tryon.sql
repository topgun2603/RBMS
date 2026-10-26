CREATE TABLE "ai_image_cleanups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"original_url" text NOT NULL,
	"cleaned_url" text,
	"cutout_url" text,
	"style" text DEFAULT 'white' NOT NULL,
	"color" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stats" jsonb,
	"model" text,
	"credits" integer DEFAULT 0 NOT NULL,
	"ms" integer,
	"error" text,
	"created_by" text,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_tryons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"image_url" text NOT NULL,
	"anchors" jsonb NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_image_cleanups_batch_idx" ON "ai_image_cleanups" USING btree ("tenant_id","batch_id");
--> statement-breakpoint
CREATE INDEX "ai_image_cleanups_product_idx" ON "ai_image_cleanups" USING btree ("tenant_id","product_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_tryons_product_uq" ON "ai_tryons" USING btree ("tenant_id","product_id");
