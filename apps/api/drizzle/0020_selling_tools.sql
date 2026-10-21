CREATE TABLE "offer_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" uuid NOT NULL,
	"customer_key" text,
	"amount" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offer_redemptions_ref_uq" UNIQUE("offer_id","ref_type","ref_id")
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"slug" text,
	"image_url" text,
	"applies_to" text DEFAULT 'all' NOT NULL,
	"target_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"config" jsonb NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"usage_limit" integer,
	"per_customer_limit" integer,
	"channels" text[] DEFAULT '{store}'::text[] NOT NULL,
	"stackable" boolean DEFAULT false NOT NULL,
	"combines_with_coupons" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "offer_redemptions" ADD CONSTRAINT "offer_redemptions_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "offer_redemptions_offer_status_idx" ON "offer_redemptions" USING btree ("offer_id","status");--> statement-breakpoint
CREATE INDEX "offer_redemptions_tenant_ref_idx" ON "offer_redemptions" USING btree ("tenant_id","ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "offers_tenant_kind_idx" ON "offers" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "offers_tenant_slug_uq" ON "offers" USING btree ("tenant_id","slug") WHERE slug is not null;