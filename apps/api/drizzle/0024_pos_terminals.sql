CREATE TABLE "pos_pin_attempts" (
	"terminal_id" uuid PRIMARY KEY NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_staff_pins" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"pin_lookup" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_staff_pins_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "pos_terminals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'pos' NOT NULL,
	"branch_id" uuid,
	"location_id" uuid,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"device_token_hash" text,
	"device" jsonb,
	"paired_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"pairing_code_hash" text,
	"pairing_expires_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_terminals_role_chk" CHECK ("pos_terminals"."role" in ('pos', 'weighing'))
);
--> statement-breakpoint
CREATE TABLE "pos_weigh_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"terminal_id" uuid NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"lines" jsonb NOT NULL,
	"total" integer NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"used_invoice_id" uuid,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "terminal_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_staff_pins_tenant_lookup_uq" ON "pos_staff_pins" USING btree ("tenant_id","pin_lookup");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_terminals_tenant_name_uq" ON "pos_terminals" USING btree ("tenant_id",lower("name")) WHERE "pos_terminals"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_terminals_device_token_uq" ON "pos_terminals" USING btree ("device_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_terminals_pairing_code_uq" ON "pos_terminals" USING btree ("pairing_code_hash");--> statement-breakpoint
CREATE INDEX "pos_terminals_tenant_idx" ON "pos_terminals" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_weigh_tickets_tenant_code_uq" ON "pos_weigh_tickets" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "pos_weigh_tickets_terminal_idx" ON "pos_weigh_tickets" USING btree ("tenant_id","terminal_id","created_at");--> statement-breakpoint
CREATE INDEX "pos_weigh_tickets_invoice_idx" ON "pos_weigh_tickets" USING btree ("tenant_id","used_invoice_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_terminal_idx" ON "auth_sessions" USING btree ("terminal_id");