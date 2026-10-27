CREATE TABLE "pos_displays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"register" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"token_hash" text,
	"paired_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"pairing_code_hash" text,
	"pairing_expires_at" timestamp with time zone,
	"created_by" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "till_sessions" ADD COLUMN "z_number" integer;--> statement-breakpoint
ALTER TABLE "till_sessions" ADD COLUMN "handovers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "till_sessions" ADD COLUMN "difference_reason" text;--> statement-breakpoint
ALTER TABLE "till_sessions" ADD COLUMN "close_approved_by" uuid;--> statement-breakpoint
ALTER TABLE "till_sessions" ADD COLUMN "close_approved_by_name" text;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_displays_token_uq" ON "pos_displays" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_displays_pairing_code_uq" ON "pos_displays" USING btree ("pairing_code_hash");--> statement-breakpoint
CREATE INDEX "pos_displays_tenant_register_idx" ON "pos_displays" USING btree ("tenant_id","register");--> statement-breakpoint
CREATE UNIQUE INDEX "till_sessions_z_number_uq" ON "till_sessions" USING btree ("tenant_id",coalesce("branch_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("register"),"z_number") WHERE "till_sessions"."z_number" is not null;