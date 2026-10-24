CREATE TABLE "acct_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"group_key" text NOT NULL,
	"sub_group" text,
	"key" text,
	"system" boolean DEFAULT false NOT NULL,
	"is_cash" boolean DEFAULT false NOT NULL,
	"is_bank" boolean DEFAULT false NOT NULL,
	"bank_name" text,
	"bank_account_last4" text,
	"bank_ifsc" text,
	"opening_balance" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acct_accounts_tenant_code_uq" UNIQUE("tenant_id","code"),
	CONSTRAINT "acct_accounts_tenant_key_uq" UNIQUE("tenant_id","key")
);
--> statement-breakpoint
CREATE TABLE "acct_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"number" text NOT NULL,
	"voucher_type" text NOT NULL,
	"origin" text DEFAULT 'manual' NOT NULL,
	"date" date NOT NULL,
	"late_for" date,
	"narration" text DEFAULT '' NOT NULL,
	"reference" text,
	"status" text DEFAULT 'posted' NOT NULL,
	"total" integer NOT NULL,
	"source_type" text,
	"source_id" text,
	"source_version" integer,
	"content_hash" text,
	"reversal_of_id" uuid,
	"reversed_by_id" uuid,
	"reversed_at" timestamp with time zone,
	"reversal_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acct_entries_tenant_number_uq" UNIQUE("tenant_id","number")
);
--> statement-breakpoint
CREATE TABLE "acct_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"debit" integer DEFAULT 0 NOT NULL,
	"credit" integer DEFAULT 0 NOT NULL,
	"memo" text,
	"party_type" text,
	"party_id" uuid,
	CONSTRAINT "acct_lines_amounts_chk" CHECK ("acct_lines"."debit" >= 0 and "acct_lines"."credit" >= 0 and ("acct_lines"."debit" = 0 or "acct_lines"."credit" = 0))
);
--> statement-breakpoint
CREATE TABLE "acct_lock_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"locked_through" date,
	"previous" date,
	"reason" text,
	"user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acct_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"locked_through" date,
	"start_date" date,
	"post_from" date,
	"imported_bills" text DEFAULT 'exclude' NOT NULL,
	"value_stock" boolean DEFAULT true NOT NULL,
	"method_accounts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"auto_post" boolean DEFAULT false NOT NULL,
	"next_seq" integer DEFAULT 1 NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_sync_summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acct_settings_tenant_uq" UNIQUE("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "acct_lines" ADD CONSTRAINT "acct_lines_entry_id_acct_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."acct_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acct_lines" ADD CONSTRAINT "acct_lines_account_id_acct_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."acct_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "acct_accounts_tenant_type_idx" ON "acct_accounts" USING btree ("tenant_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "acct_entries_source_uq" ON "acct_entries" USING btree ("tenant_id","source_type","source_id","source_version") WHERE "acct_entries"."source_type" is not null;--> statement-breakpoint
CREATE INDEX "acct_entries_tenant_date_idx" ON "acct_entries" USING btree ("tenant_id","date","seq");--> statement-breakpoint
CREATE INDEX "acct_entries_tenant_source_idx" ON "acct_entries" USING btree ("tenant_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "acct_lines_entry_idx" ON "acct_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "acct_lines_tenant_account_date_idx" ON "acct_lines" USING btree ("tenant_id","account_id","entry_date");--> statement-breakpoint
CREATE INDEX "acct_lines_tenant_party_idx" ON "acct_lines" USING btree ("tenant_id","party_type","party_id");--> statement-breakpoint
CREATE INDEX "acct_lock_log_tenant_at_idx" ON "acct_lock_log" USING btree ("tenant_id","at");
--> statement-breakpoint
-- Posted entries are immutable: lines never change; an entry only ever gets its reversal marks. Deleting needs the
-- session setting acct.allow_delete = 'on' (dev clean-up and tests only).
CREATE FUNCTION "acct_guard_lines"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Posted accounting lines cannot be changed; reverse the entry instead';
  END IF;
  IF COALESCE(current_setting('acct.allow_delete', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Posted accounting lines cannot be deleted; reverse the entry instead';
  END IF;
  RETURN OLD;
END $$;--> statement-breakpoint
CREATE TRIGGER "acct_lines_immutable" BEFORE UPDATE OR DELETE ON "acct_lines" FOR EACH ROW EXECUTE FUNCTION "acct_guard_lines"();--> statement-breakpoint
CREATE FUNCTION "acct_guard_entries"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.tenant_id, NEW.seq, NEW.number, NEW.voucher_type, NEW.origin, NEW.date, NEW.late_for, NEW.narration, NEW.reference, NEW.total, NEW.source_type, NEW.source_id, NEW.source_version, NEW.content_hash, NEW.reversal_of_id, NEW.created_by, NEW.created_at)
       IS DISTINCT FROM
       (OLD.tenant_id, OLD.seq, OLD.number, OLD.voucher_type, OLD.origin, OLD.date, OLD.late_for, OLD.narration, OLD.reference, OLD.total, OLD.source_type, OLD.source_id, OLD.source_version, OLD.content_hash, OLD.reversal_of_id, OLD.created_by, OLD.created_at) THEN
      RAISE EXCEPTION 'A posted accounting entry cannot be changed; reverse it instead';
    END IF;
    RETURN NEW;
  END IF;
  IF COALESCE(current_setting('acct.allow_delete', true), '') <> 'on' THEN
    RAISE EXCEPTION 'A posted accounting entry cannot be deleted; reverse it instead';
  END IF;
  RETURN OLD;
END $$;--> statement-breakpoint
CREATE TRIGGER "acct_entries_immutable" BEFORE UPDATE OR DELETE ON "acct_entries" FOR EACH ROW EXECUTE FUNCTION "acct_guard_entries"();
