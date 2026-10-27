CREATE TABLE "acct_bank_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"statement_id" uuid NOT NULL,
	"date" date NOT NULL,
	"value_date" date,
	"narration" text DEFAULT '' NOT NULL,
	"reference" text,
	"amount" integer NOT NULL,
	"balance" integer,
	"seq" integer DEFAULT 0 NOT NULL,
	"hash" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"match_group_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acct_bank_lines_account_hash_uq" UNIQUE("tenant_id","account_id","hash")
);
--> statement-breakpoint
CREATE TABLE "acct_bank_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"bank_line_id" uuid,
	"acct_line_id" uuid,
	"method" text DEFAULT 'manual' NOT NULL,
	"confidence" integer,
	"reconciled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acct_bank_recons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"book_balance" integer NOT NULL,
	"bank_balance" integer NOT NULL,
	"difference" integer NOT NULL,
	"note" text,
	"user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acct_bank_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"file_name" text,
	"layout" text NOT NULL,
	"from_date" date,
	"to_date" date,
	"opening_balance" integer,
	"closing_balance" integer,
	"rows" integer DEFAULT 0 NOT NULL,
	"added" integer DEFAULT 0 NOT NULL,
	"duplicates" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"mapping" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acct_cheques" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"account_id" uuid NOT NULL,
	"cheque_no" text NOT NULL,
	"cheque_date" date NOT NULL,
	"amount" integer NOT NULL,
	"party_type" text,
	"party_id" uuid,
	"party_name" text DEFAULT '' NOT NULL,
	"drawn_on" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"deposited_on" date,
	"cleared_on" date,
	"bounced_on" date,
	"bounce_reason" text,
	"bounce_charges" integer DEFAULT 0 NOT NULL,
	"acct_line_id" uuid,
	"entry_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acct_depreciation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"amount" integer NOT NULL,
	"entry_id" uuid NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acct_fixed_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"asset_account_id" uuid NOT NULL,
	"purchase_date" date NOT NULL,
	"in_use_from" date NOT NULL,
	"cost" integer NOT NULL,
	"salvage" integer DEFAULT 0 NOT NULL,
	"method" text NOT NULL,
	"rate" integer,
	"life_months" integer,
	"opening_depreciation" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"disposed_on" date,
	"sale_amount" integer,
	"disposal_entry_id" uuid,
	"purchase_entry_id" uuid,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acct_party_tax" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"party_type" text NOT NULL,
	"party_id" uuid NOT NULL,
	"pan" text,
	"deductee_type" text,
	"default_section" text,
	"lower_rate" integer,
	"certificate_no" text,
	"certificate_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acct_party_tax_party_uq" UNIQUE("tenant_id","party_type","party_id")
);
--> statement-breakpoint
CREATE TABLE "acct_tds_challans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"period" text NOT NULL,
	"section" text,
	"bsr_code" text NOT NULL,
	"challan_no" text NOT NULL,
	"date" date NOT NULL,
	"tax" integer NOT NULL,
	"interest" integer DEFAULT 0 NOT NULL,
	"fee" integer DEFAULT 0 NOT NULL,
	"paid_from_account_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"entry_id" uuid,
	"reversal_entry_id" uuid,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acct_tds_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"date" date NOT NULL,
	"section" text NOT NULL,
	"party_type" text NOT NULL,
	"party_id" uuid,
	"party_name" text NOT NULL,
	"pan" text,
	"base" integer NOT NULL,
	"rate" integer NOT NULL,
	"amount" integer NOT NULL,
	"no_pan" boolean DEFAULT false NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text,
	"source_ref" text,
	"other_account_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"entry_id" uuid,
	"reversal_entry_id" uuid,
	"settlement_id" text,
	"challan_id" uuid,
	"note" text,
	"created_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acct_tds_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"tcs_enabled" boolean DEFAULT false NOT NULL,
	"tan" text,
	"deductor_name" text,
	"responsible_person" text,
	"buyer_turnover_above_10cr" boolean DEFAULT false NOT NULL,
	"overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acct_tds_settings_tenant_uq" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE "acct_year_closes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fy" text NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"net_profit" integer NOT NULL,
	"stock_adjustment" integer DEFAULT 0 NOT NULL,
	"entry_id" uuid,
	"reversal_entry_id" uuid,
	"previous_lock" date,
	"status" text DEFAULT 'closed' NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"reopened_by" uuid,
	"reopened_at" timestamp with time zone,
	"reopen_reason" text
);
--> statement-breakpoint
CREATE INDEX "acct_bank_lines_tenant_account_date_idx" ON "acct_bank_lines" USING btree ("tenant_id","account_id","date");--> statement-breakpoint
CREATE INDEX "acct_bank_lines_tenant_status_idx" ON "acct_bank_lines" USING btree ("tenant_id","account_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "acct_bank_matches_bank_line_uq" ON "acct_bank_matches" USING btree ("tenant_id","bank_line_id") WHERE "acct_bank_matches"."bank_line_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "acct_bank_matches_acct_line_uq" ON "acct_bank_matches" USING btree ("tenant_id","acct_line_id") WHERE "acct_bank_matches"."acct_line_id" is not null;--> statement-breakpoint
CREATE INDEX "acct_bank_matches_tenant_group_idx" ON "acct_bank_matches" USING btree ("tenant_id","group_id");--> statement-breakpoint
CREATE INDEX "acct_bank_recons_tenant_account_idx" ON "acct_bank_recons" USING btree ("tenant_id","account_id","as_of");--> statement-breakpoint
CREATE INDEX "acct_bank_statements_tenant_account_idx" ON "acct_bank_statements" USING btree ("tenant_id","account_id","created_at");--> statement-breakpoint
CREATE INDEX "acct_cheques_tenant_status_idx" ON "acct_cheques" USING btree ("tenant_id","status","cheque_date");--> statement-breakpoint
CREATE INDEX "acct_cheques_tenant_no_idx" ON "acct_cheques" USING btree ("tenant_id","cheque_no");--> statement-breakpoint
CREATE UNIQUE INDEX "acct_depreciation_asset_period_uq" ON "acct_depreciation" USING btree ("tenant_id","asset_id","period_end") WHERE "acct_depreciation"."status" = 'posted';--> statement-breakpoint
CREATE INDEX "acct_depreciation_tenant_idx" ON "acct_depreciation" USING btree ("tenant_id","period_end");--> statement-breakpoint
CREATE INDEX "acct_fixed_assets_tenant_idx" ON "acct_fixed_assets" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "acct_tds_challans_tenant_period_idx" ON "acct_tds_challans" USING btree ("tenant_id","kind","period");--> statement-breakpoint
CREATE INDEX "acct_tds_entries_tenant_date_idx" ON "acct_tds_entries" USING btree ("tenant_id","kind","date");--> statement-breakpoint
CREATE INDEX "acct_tds_entries_tenant_party_idx" ON "acct_tds_entries" USING btree ("tenant_id","party_type","party_id");--> statement-breakpoint
CREATE INDEX "acct_tds_entries_tenant_source_idx" ON "acct_tds_entries" USING btree ("tenant_id","source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "acct_year_closes_fy_uq" ON "acct_year_closes" USING btree ("tenant_id","fy") WHERE "acct_year_closes"."status" = 'closed';--> statement-breakpoint
CREATE INDEX "acct_year_closes_tenant_idx" ON "acct_year_closes" USING btree ("tenant_id","to_date");