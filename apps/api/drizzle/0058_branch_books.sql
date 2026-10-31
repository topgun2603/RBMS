ALTER TABLE "acct_lines" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
CREATE INDEX "acct_lines_tenant_branch_date_idx" ON "acct_lines" USING btree ("tenant_id","branch_id","entry_date");