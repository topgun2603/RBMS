CREATE TABLE "auth_mfa" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"secret_enc" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"last_step" integer,
	"recovery_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_discount_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"subject" text NOT NULL,
	"max_percent_bp" integer,
	"max_amount" integer,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_discount_limits_uq" UNIQUE("tenant_id","scope","subject")
);
--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "cancelled_by" uuid;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "auth_mfa" ADD CONSTRAINT "auth_mfa_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_discount_limits_tenant_idx" ON "staff_discount_limits" USING btree ("tenant_id");