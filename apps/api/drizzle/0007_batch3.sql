CREATE TABLE "branch_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_users_branch_user_uq" UNIQUE("branch_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"address" text,
	"city" text,
	"pincode" text,
	"phone" text,
	"gstin" text,
	"state_code" text,
	"stock_location_id" uuid,
	"invoice_prefix" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_tenant_code_uq" UNIQUE("tenant_id","code"),
	CONSTRAINT "branches_tenant_prefix_uq" UNIQUE("tenant_id","invoice_prefix")
);
--> statement-breakpoint
CREATE TABLE "chat_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"subject_type" text,
	"subject_id" text,
	"title" text,
	"last_message_at" timestamp with time zone,
	"last_message_preview" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reply_to" uuid,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_messages_body_len_ck" CHECK (char_length("chat_messages"."body") <= 4000)
);
--> statement-breakpoint
CREATE TABLE "chat_participants" (
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"last_read_at" timestamp with time zone,
	"muted" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_participants_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"response_status" integer,
	"response_body" text,
	"error" text,
	"duration_ms" integer,
	"next_attempt_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"url" text NOT NULL,
	"secret_enc" text NOT NULL,
	"events" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"description" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"disabled_at" timestamp with time zone,
	"disabled_reason" text,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "einvoice_accounts" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'mock' NOT NULL,
	"gstin" text NOT NULL,
	"username" text DEFAULT '' NOT NULL,
	"password_enc" text,
	"client_credentials_enc" text,
	"sandbox" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "einvoice_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"doc_type" text DEFAULT 'INV' NOT NULL,
	"doc_no" text NOT NULL,
	"doc_date" date NOT NULL,
	"irn" text,
	"ack_no" text,
	"ack_date" timestamp with time zone,
	"signed_qr" text,
	"signed_invoice" text,
	"status" text NOT NULL,
	"error" jsonb,
	"payload" jsonb,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"cancel_remark" text,
	"ewb_no" text,
	"ewb_date" timestamp with time zone,
	"ewb_valid_till" timestamp with time zone,
	"ewb_status" text,
	"ewb_cancelled_at" timestamp with time zone,
	"ewb_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kyc_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"input_masked" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"input_fingerprint" text,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"name_on_record" text,
	"name_match_score" integer,
	"error" text,
	"created_by" uuid,
	"review_decision" text,
	"review_reason" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kyc_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"file_url" text NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kyc_subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"status" text DEFAULT 'none' NOT NULL,
	"verified_name" text,
	"badges" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loyalty_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"type" text NOT NULL,
	"points" integer NOT NULL,
	"amount_paise" bigint DEFAULT 0 NOT NULL,
	"remaining" integer DEFAULT 0 NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" text NOT NULL,
	"expires_at" timestamp with time zone,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyalty_ledger_ref_uq" UNIQUE("tenant_id","ref_type","ref_id","type")
);
--> statement-breakpoint
CREATE TABLE "loyalty_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_key" text NOT NULL,
	"name" text,
	"points_balance" integer DEFAULT 0 NOT NULL,
	"lifetime_spend" bigint DEFAULT 0 NOT NULL,
	"tier" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyalty_members_tenant_key_uq" UNIQUE("tenant_id","member_key")
);
--> statement-breakpoint
CREATE TABLE "vendor_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"type" text NOT NULL,
	"amount" integer NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"order_number" text NOT NULL,
	"vendor_id" uuid NOT NULL,
	"lines" jsonb NOT NULL,
	"subtotal" integer NOT NULL,
	"discount" integer DEFAULT 0 NOT NULL,
	"shipping_share" integer DEFAULT 0 NOT NULL,
	"commission_bps" integer NOT NULL,
	"commission" integer NOT NULL,
	"net" integer NOT NULL,
	"status" text NOT NULL,
	"settlement_status" text DEFAULT 'pending' NOT NULL,
	"placed_at" timestamp with time zone NOT NULL,
	"delivered_at" timestamp with time zone,
	"eligible_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"payout_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_orders_order_vendor_uq" UNIQUE("tenant_id","order_id","vendor_id")
);
--> statement-breakpoint
CREATE TABLE "vendor_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"period_from" timestamp with time zone,
	"period_to" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'staff' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_users_vendor_user_uq" UNIQUE("vendor_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"kyc_status" text DEFAULT 'none' NOT NULL,
	"commission_bps" integer,
	"description" text,
	"logo_url" text,
	"contact_name" text,
	"contact_phone" text,
	"contact_email" text,
	"gstin" text,
	"address" jsonb,
	"payout_account_enc" text,
	"payout_account_masked" jsonb,
	"payout_account_status" text DEFAULT 'none' NOT NULL,
	"notes" text,
	"approved_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendors_tenant_slug_uq" UNIQUE("tenant_id","slug")
);
--> statement-breakpoint
CREATE TABLE "report_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"preset" text NOT NULL,
	"cron" text NOT NULL,
	"recipients" jsonb NOT NULL,
	"format" text DEFAULT 'xlsx' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"last_status" text,
	"last_error" text,
	"last_row_count" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"dataset" text NOT NULL,
	"spec" jsonb NOT NULL,
	"created_by" uuid,
	"shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "faq_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category_id" uuid,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"helpful_yes" integer DEFAULT 0 NOT NULL,
	"helpful_no" integer DEFAULT 0 NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"seo" jsonb,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "faq_articles_tenant_slug_uq" UNIQUE("tenant_id","slug")
);
--> statement-breakpoint
CREATE TABLE "faq_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "faq_categories_tenant_slug_uq" UNIQUE("tenant_id","slug")
);
--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_id" uuid,
	"author_kind" text NOT NULL,
	"kind" text DEFAULT 'reply' NOT NULL,
	"body" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_ticket_series" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"next_seq" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"seq" integer NOT NULL,
	"requester_user_id" uuid,
	"requester_name" text,
	"requester_phone" text,
	"requester_email" text,
	"subject" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"channel" text DEFAULT 'web' NOT NULL,
	"assignee_id" uuid,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"related_type" text,
	"related_id" text,
	"first_response_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"sla_due_at" timestamp with time zone,
	"sla_breached" boolean DEFAULT false NOT NULL,
	"merged_into_id" uuid,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_tickets_tenant_number_uq" UNIQUE("tenant_id","number")
);
--> statement-breakpoint
CREATE TABLE "wa_accounts" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'meta' NOT NULL,
	"phone_number_id" text NOT NULL,
	"waba_id" text NOT NULL,
	"display_number" text,
	"token_enc" text NOT NULL,
	"app_secret_enc" text NOT NULL,
	"verify_token" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_error" text,
	"last_webhook_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wa_campaign_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"name" text,
	"variables" jsonb NOT NULL,
	"contact_id" uuid,
	"seq" integer NOT NULL,
	"batch" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"message_id" uuid,
	"provider_id" text,
	"error" text,
	"sent_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wa_campaign_recipients_phone_uq" UNIQUE("campaign_id","phone")
);
--> statement-breakpoint
CREATE TABLE "wa_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"template_id" uuid NOT NULL,
	"mapping" jsonb NOT NULL,
	"audience" jsonb NOT NULL,
	"schedule_at" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"counts" jsonb NOT NULL,
	"rate_per_minute" integer,
	"run_id" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wa_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"name" text,
	"opted_in" boolean DEFAULT false NOT NULL,
	"opted_out_at" timestamp with time zone,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_inbound_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"last_message_preview" text,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"assignee_id" uuid,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wa_contacts_tenant_phone_uq" UNIQUE("tenant_id","phone")
);
--> statement-breakpoint
CREATE TABLE "wa_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"type" text NOT NULL,
	"body" text,
	"media" jsonb,
	"template_name" text,
	"template_language" text,
	"template_params" jsonb,
	"status" text NOT NULL,
	"provider_id" text,
	"reply_to" text,
	"error" text,
	"extra" jsonb,
	"campaign_id" uuid,
	"sent_by" uuid,
	"status_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wa_messages_provider_uq" UNIQUE("tenant_id","provider_id")
);
--> statement-breakpoint
CREATE TABLE "wa_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wa_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"remote_id" text,
	"name" text NOT NULL,
	"language" text NOT NULL,
	"status" text NOT NULL,
	"category" text,
	"parameter_format" text,
	"components" jsonb NOT NULL,
	"mapping" jsonb,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wa_templates_name_lang_uq" UNIQUE("tenant_id","name","language")
);
--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_tenant_fy_seq_uq";--> statement-breakpoint
ALTER TABLE "invoice_series" DROP CONSTRAINT "invoice_series_pk";--> statement-breakpoint
ALTER TABLE "catalog_products" ADD COLUMN "vendor_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice_series" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_series" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "branch_users" ADD CONSTRAINT "branch_users_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_checks" ADD CONSTRAINT "kyc_checks_subject_id_kyc_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."kyc_subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_subject_id_kyc_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."kyc_subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_member_id_loyalty_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."loyalty_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_ledger" ADD CONSTRAINT "vendor_ledger_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_orders" ADD CONSTRAINT "vendor_orders_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_payouts" ADD CONSTRAINT "vendor_payouts_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_users" ADD CONSTRAINT "vendor_users_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_report_id_saved_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."saved_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faq_articles" ADD CONSTRAINT "faq_articles_category_id_faq_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."faq_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_campaign_recipients" ADD CONSTRAINT "wa_campaign_recipients_campaign_id_wa_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."wa_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_campaigns" ADD CONSTRAINT "wa_campaigns_template_id_wa_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."wa_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_messages" ADD CONSTRAINT "wa_messages_contact_id_wa_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."wa_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_notes" ADD CONSTRAINT "wa_notes_contact_id_wa_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."wa_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "branch_users_tenant_user_idx" ON "branch_users" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "branch_users_tenant_user_default_uq" ON "branch_users" USING btree ("tenant_id","user_id") WHERE "branch_users"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "branches_tenant_default_uq" ON "branches" USING btree ("tenant_id") WHERE "branches"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "branches_tenant_location_uq" ON "branches" USING btree ("tenant_id","stock_location_id") WHERE "branches"."stock_location_id" is not null;--> statement-breakpoint
CREATE INDEX "chat_conversations_tenant_last_idx" ON "chat_conversations" USING btree ("tenant_id","last_message_at");--> statement-breakpoint
CREATE INDEX "chat_conversations_tenant_type_idx" ON "chat_conversations" USING btree ("tenant_id","type","last_message_at");--> statement-breakpoint
CREATE INDEX "chat_conversations_tenant_subject_idx" ON "chat_conversations" USING btree ("tenant_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "chat_messages_conversation_created_idx" ON "chat_messages" USING btree ("conversation_id","created_at","id");--> statement-breakpoint
CREATE INDEX "chat_messages_tenant_created_idx" ON "chat_messages" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_participants_tenant_user_idx" ON "chat_participants" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_uq" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_tenant_idx" ON "api_keys" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_tenant_idx" ON "webhook_deliveries" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_endpoint_idx" ON "webhook_deliveries" USING btree ("endpoint_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_due_idx" ON "webhook_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_tenant_idx" ON "webhook_endpoints" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "einvoice_records_active_uidx" ON "einvoice_records" USING btree ("tenant_id","invoice_id") WHERE status = 'generated';--> statement-breakpoint
CREATE INDEX "einvoice_records_tenant_invoice_idx" ON "einvoice_records" USING btree ("tenant_id","invoice_id","created_at");--> statement-breakpoint
CREATE INDEX "einvoice_records_tenant_irn_idx" ON "einvoice_records" USING btree ("tenant_id","irn");--> statement-breakpoint
CREATE INDEX "kyc_checks_subject_idx" ON "kyc_checks" USING btree ("tenant_id","subject_id","created_at");--> statement-breakpoint
CREATE INDEX "kyc_checks_status_idx" ON "kyc_checks" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "kyc_checks_fingerprint_idx" ON "kyc_checks" USING btree ("tenant_id","input_fingerprint");--> statement-breakpoint
CREATE INDEX "kyc_documents_subject_idx" ON "kyc_documents" USING btree ("tenant_id","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kyc_subjects_subject_uq" ON "kyc_subjects" USING btree ("tenant_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "kyc_subjects_status_idx" ON "kyc_subjects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "loyalty_ledger_member_idx" ON "loyalty_ledger" USING btree ("tenant_id","member_id","created_at");--> statement-breakpoint
CREATE INDEX "loyalty_ledger_due_idx" ON "loyalty_ledger" USING btree ("expires_at") WHERE "loyalty_ledger"."remaining" > 0;--> statement-breakpoint
CREATE INDEX "loyalty_members_tenant_name_idx" ON "loyalty_members" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "vendor_ledger_tenant_vendor_idx" ON "vendor_ledger" USING btree ("tenant_id","vendor_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_ledger_vendor_order_uq" ON "vendor_ledger" USING btree ("tenant_id","type","ref_type","ref_id") WHERE "vendor_ledger"."ref_type" in ('vendor_order', 'vendor_order_reversal');--> statement-breakpoint
CREATE INDEX "vendor_orders_tenant_vendor_idx" ON "vendor_orders" USING btree ("tenant_id","vendor_id","placed_at");--> statement-breakpoint
CREATE INDEX "vendor_orders_settlement_idx" ON "vendor_orders" USING btree ("tenant_id","settlement_status","eligible_at");--> statement-breakpoint
CREATE INDEX "vendor_payouts_tenant_vendor_idx" ON "vendor_payouts" USING btree ("tenant_id","vendor_id","created_at");--> statement-breakpoint
CREATE INDEX "vendor_payouts_tenant_status_idx" ON "vendor_payouts" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "vendor_users_tenant_user_idx" ON "vendor_users" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "vendors_tenant_status_idx" ON "vendors" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "report_schedules_tenant_report_idx" ON "report_schedules" USING btree ("tenant_id","report_id");--> statement-breakpoint
CREATE INDEX "report_schedules_due_idx" ON "report_schedules" USING btree ("active","next_run_at");--> statement-breakpoint
CREATE INDEX "saved_reports_tenant_idx" ON "saved_reports" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "faq_articles_tenant_status_idx" ON "faq_articles" USING btree ("tenant_id","status","category_id","sort");--> statement-breakpoint
CREATE INDEX "support_messages_ticket_idx" ON "support_messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "support_messages_tenant_idx" ON "support_messages" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "support_tickets_tenant_status_idx" ON "support_tickets" USING btree ("tenant_id","status","last_message_at");--> statement-breakpoint
CREATE INDEX "support_tickets_tenant_assignee_idx" ON "support_tickets" USING btree ("tenant_id","assignee_id");--> statement-breakpoint
CREATE INDEX "support_tickets_tenant_requester_idx" ON "support_tickets" USING btree ("tenant_id","requester_user_id");--> statement-breakpoint
CREATE INDEX "support_tickets_tenant_phone_idx" ON "support_tickets" USING btree ("tenant_id","requester_phone");--> statement-breakpoint
CREATE INDEX "support_tickets_sla_idx" ON "support_tickets" USING btree ("sla_due_at") WHERE first_response_at is null and sla_breached = false;--> statement-breakpoint
CREATE INDEX "support_tickets_tags_idx" ON "support_tickets" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "wa_campaign_recipients_batch_idx" ON "wa_campaign_recipients" USING btree ("campaign_id","batch","status");--> statement-breakpoint
CREATE INDEX "wa_campaign_recipients_provider_idx" ON "wa_campaign_recipients" USING btree ("tenant_id","provider_id");--> statement-breakpoint
CREATE INDEX "wa_campaigns_tenant_idx" ON "wa_campaigns" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "wa_contacts_tenant_last_idx" ON "wa_contacts" USING btree ("tenant_id","last_message_at");--> statement-breakpoint
CREATE INDEX "wa_messages_contact_idx" ON "wa_messages" USING btree ("tenant_id","contact_id","created_at");--> statement-breakpoint
CREATE INDEX "wa_notes_contact_idx" ON "wa_notes" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE INDEX "catalog_products_tenant_vendor_idx" ON "catalog_products" USING btree ("tenant_id","vendor_id");--> statement-breakpoint
CREATE INDEX "invoices_tenant_branch_date_idx" ON "invoices" USING btree ("tenant_id","branch_id","date");--> statement-breakpoint
CREATE INDEX "orders_tenant_branch_placed_idx" ON "orders" USING btree ("tenant_id","branch_id","placed_at");--> statement-breakpoint
ALTER TABLE "invoice_series" ADD CONSTRAINT "invoice_series_tenant_branch_fy_uq" UNIQUE NULLS NOT DISTINCT("tenant_id","branch_id","fy");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_tenant_branch_fy_seq_uq" ON "invoices" USING btree ("tenant_id",coalesce("branch_id", '00000000-0000-0000-0000-000000000000'::uuid),"fy","seq") WHERE "invoices"."seq" is not null;