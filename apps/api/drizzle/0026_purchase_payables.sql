CREATE TABLE "debit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"purchase_id" uuid NOT NULL,
	"supplier_id" uuid,
	"supplier_name" text NOT NULL,
	"date" date NOT NULL,
	"lines" jsonb NOT NULL,
	"totals" jsonb NOT NULL,
	"total" integer NOT NULL,
	"refund_amount" integer DEFAULT 0 NOT NULL,
	"reason" text,
	"location_id" uuid NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"created_by" uuid,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "debit_notes_tenant_number_uq" UNIQUE("tenant_id","number")
);
--> statement-breakpoint
CREATE TABLE "goods_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"supplier_id" uuid,
	"date" date NOT NULL,
	"location_id" uuid NOT NULL,
	"lines" jsonb NOT NULL,
	"freight" integer DEFAULT 0 NOT NULL,
	"other_charges" integer DEFAULT 0 NOT NULL,
	"purchase_id" uuid,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goods_receipts_tenant_number_uq" UNIQUE("tenant_id","number")
);
--> statement-breakpoint
CREATE TABLE "purchase_doc_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"fy" text NOT NULL,
	"prefix" text NOT NULL,
	"next_seq" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_doc_series_tenant_kind_fy_uq" UNIQUE("tenant_id","kind","fy")
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"supplier_id" uuid,
	"supplier" jsonb NOT NULL,
	"date" date NOT NULL,
	"expected_date" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"place_of_supply" text NOT NULL,
	"lines" jsonb NOT NULL,
	"totals" jsonb NOT NULL,
	"total" integer NOT NULL,
	"location_id" uuid,
	"notes" text,
	"created_by" uuid,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_tenant_number_uq" UNIQUE("tenant_id","number")
);
--> statement-breakpoint
CREATE TABLE "purchase_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_id" uuid,
	"purchase_id" uuid,
	"group_id" uuid NOT NULL,
	"kind" text DEFAULT 'payment' NOT NULL,
	"amount" integer NOT NULL,
	"mode" text DEFAULT 'cash' NOT NULL,
	"reference" text,
	"date" date NOT NULL,
	"note" text,
	"debit_note_id" uuid,
	"created_by" uuid,
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"reverse_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "amount_paid" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "returned_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "freight" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "other_charges" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "purchase_order_id" uuid;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "goods_receipt_id" uuid;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "opening_balance" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "opening_date" date;--> statement-breakpoint
CREATE INDEX "debit_notes_tenant_purchase_idx" ON "debit_notes" USING btree ("tenant_id","purchase_id");--> statement-breakpoint
CREATE INDEX "debit_notes_tenant_date_idx" ON "debit_notes" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "goods_receipts_tenant_po_idx" ON "goods_receipts" USING btree ("tenant_id","purchase_order_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_tenant_date_idx" ON "purchase_orders" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "purchase_orders_tenant_supplier_idx" ON "purchase_orders" USING btree ("tenant_id","supplier_id");--> statement-breakpoint
CREATE INDEX "purchase_payments_tenant_purchase_idx" ON "purchase_payments" USING btree ("tenant_id","purchase_id");--> statement-breakpoint
CREATE INDEX "purchase_payments_tenant_supplier_idx" ON "purchase_payments" USING btree ("tenant_id","supplier_id","date");--> statement-breakpoint
CREATE INDEX "purchase_payments_tenant_group_idx" ON "purchase_payments" USING btree ("tenant_id","group_id");
--> statement-breakpoint
-- Back-fill: the old boolean `paid` becomes a fully paid amount plus one payment row, so statements balance.
UPDATE "purchases" SET "amount_paid" = "total" WHERE "paid" = true AND "status" = 'recorded';--> statement-breakpoint
INSERT INTO "purchase_payments" ("tenant_id", "supplier_id", "purchase_id", "group_id", "kind", "amount", "mode", "date", "note", "created_by")
SELECT "tenant_id", "supplier_id", "id", gen_random_uuid(), 'payment', "total", 'cash', "date", 'Migrated from the paid flag', "created_by"
FROM "purchases" WHERE "paid" = true AND "status" = 'recorded' AND "total" > 0;
