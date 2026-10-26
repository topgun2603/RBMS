CREATE TABLE "ai_money_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text DEFAULT 'loan-pack' NOT NULL,
	"facts" jsonb NOT NULL,
	"cover" jsonb NOT NULL,
	"show_names" boolean DEFAULT false NOT NULL,
	"shop_name" text,
	"credits" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"share_token" text,
	"share_expires_at" timestamp with time zone,
	"shared_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_money_packs_share_token_uq" ON "ai_money_packs" USING btree ("share_token");--> statement-breakpoint
CREATE INDEX "ai_money_packs_tenant_idx" ON "ai_money_packs" USING btree ("tenant_id","created_at");