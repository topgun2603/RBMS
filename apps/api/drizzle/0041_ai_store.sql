CREATE TABLE "ai_item_pairs" (
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"with_product_id" uuid NOT NULL,
	"together" integer NOT NULL,
	"count_a" integer NOT NULL,
	"count_b" integer NOT NULL,
	"baskets" integer NOT NULL,
	"support" real NOT NULL,
	"confidence" real NOT NULL,
	"lift" real NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_item_pairs_tenant_id_product_id_with_product_id_pk" PRIMARY KEY("tenant_id","product_id","with_product_id")
);
--> statement-breakpoint
CREATE TABLE "ai_product_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"alias_text" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'ai' NOT NULL,
	"source_name" text DEFAULT '' NOT NULL,
	"run_id" uuid,
	"credits" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_item_pairs_tenant_a_idx" ON "ai_item_pairs" USING btree ("tenant_id","product_id","lift");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_product_aliases_uq" ON "ai_product_aliases" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE INDEX "ai_product_aliases_text_trgm_idx" ON "ai_product_aliases" USING gin ("alias_text" gin_trgm_ops);
