CREATE TABLE "plan_addons" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"app_id" text,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"modules" text[] DEFAULT '{}' NOT NULL,
	"price_monthly_paise" integer DEFAULT 0 NOT NULL,
	"price_yearly_paise" integer DEFAULT 0 NOT NULL,
	"price_once_paise" integer DEFAULT 0 NOT NULL,
	"min_quantity" integer DEFAULT 1 NOT NULL,
	"max_quantity" integer DEFAULT 1 NOT NULL,
	"tiers" text[] DEFAULT '{}' NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"granted" integer DEFAULT 0 NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_credits_tenant_key_uq" UNIQUE("tenant_id","key")
);
--> statement-breakpoint
CREATE TABLE "subscription_addon_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subscription_id" uuid,
	"addon_id" text NOT NULL,
	"kind" text NOT NULL,
	"from_quantity" integer DEFAULT 0 NOT NULL,
	"to_quantity" integer NOT NULL,
	"taxable_paise" integer NOT NULL,
	"charge_paise" integer NOT NULL,
	"label" text NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"provider" text,
	"provider_payment_id" text,
	"auth_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp with time zone,
	"invoice_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_addons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subscription_id" uuid,
	"addon_id" text NOT NULL,
	"source" text DEFAULT 'plan' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"next_quantity" integer,
	"interval" text DEFAULT 'monthly' NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"end_reason" text,
	"notice" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_addons_tenant_addon_uq" UNIQUE("tenant_id","addon_id")
);
--> statement-breakpoint
ALTER TABLE "platform_invoices" ADD COLUMN "kind" text DEFAULT 'plan' NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_invoices" ADD COLUMN "addon_lines" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "plan_addons_app_idx" ON "plan_addons" USING btree ("app_id","code");--> statement-breakpoint
CREATE INDEX "subscription_addon_payments_tenant_idx" ON "subscription_addon_payments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "subscription_addon_payments_provider_idx" ON "subscription_addon_payments" USING btree ("provider_payment_id");--> statement-breakpoint
CREATE INDEX "subscription_addons_status_idx" ON "subscription_addons" USING btree ("status");