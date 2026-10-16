CREATE TABLE "auth_handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_handoffs_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "platform_invoice_series" (
	"fy" text PRIMARY KEY NOT NULL,
	"seq" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"fy" text NOT NULL,
	"seq" integer NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subscription_id" uuid,
	"plan_id" text NOT NULL,
	"interval" text NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"date" text NOT NULL,
	"place_of_supply" text NOT NULL,
	"gst_rate" integer DEFAULT 18 NOT NULL,
	"subtotal_paise" integer NOT NULL,
	"cgst_paise" integer DEFAULT 0 NOT NULL,
	"sgst_paise" integer DEFAULT 0 NOT NULL,
	"igst_paise" integer DEFAULT 0 NOT NULL,
	"total_paise" integer NOT NULL,
	"status" text DEFAULT 'paid' NOT NULL,
	"provider" text,
	"provider_payment_id" text,
	"buyer" jsonb NOT NULL,
	"seller" jsonb NOT NULL,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_invoices_number_uq" UNIQUE("number"),
	CONSTRAINT "platform_invoices_payment_uq" UNIQUE("provider","provider_payment_id")
);
--> statement-breakpoint
CREATE TABLE "provider_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"plan_id" text NOT NULL,
	"interval" text NOT NULL,
	"amount_paise" integer NOT NULL,
	"provider_plan_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_plans_key_uq" UNIQUE("provider","plan_id","interval","amount_paise")
);
--> statement-breakpoint
CREATE TABLE "subscription_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"tenant_id" uuid,
	"provider_subscription_id" text,
	"payload" jsonb NOT NULL,
	"outcome" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_events_provider_event_uq" UNIQUE("provider","event_id")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" text NOT NULL,
	"interval" text DEFAULT 'monthly' NOT NULL,
	"status" text NOT NULL,
	"owner_user_id" uuid,
	"trial_started_at" timestamp with time zone,
	"trial_ends_at" timestamp with time zone,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"grace_ends_at" timestamp with time zone,
	"provider" text,
	"provider_subscription_id" text,
	"provider_plan_id" text,
	"auth_url" text,
	"checkout_plan_id" text,
	"checkout_interval" text,
	"pending_plan_id" text,
	"pending_interval" text,
	"converted_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"reminders" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_tenant_uq" UNIQUE("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "auth_handoffs" ADD CONSTRAINT "auth_handoffs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_handoffs_user_idx" ON "auth_handoffs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "platform_invoices_tenant_idx" ON "platform_invoices" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "subscription_events_tenant_idx" ON "subscription_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "subscriptions_status_idx" ON "subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "subscriptions_provider_sub_idx" ON "subscriptions" USING btree ("provider_subscription_id");--> statement-breakpoint
CREATE INDEX "subscriptions_owner_idx" ON "subscriptions" USING btree ("owner_user_id");