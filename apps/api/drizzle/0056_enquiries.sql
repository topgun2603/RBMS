CREATE TABLE "enquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"enquiry_no" integer NOT NULL,
	"number" text NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"topic" text,
	"student_name" text,
	"option" text,
	"message" text,
	"source" text,
	"notice_version" text,
	"status" text DEFAULT 'new' NOT NULL,
	"note" text,
	"contacted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enquiries_tenant_no_uq" UNIQUE("tenant_id","enquiry_no")
);
--> statement-breakpoint
CREATE INDEX "enquiries_tenant_created_idx" ON "enquiries" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "enquiries_tenant_status_idx" ON "enquiries" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "enquiries_tenant_phone_idx" ON "enquiries" USING btree ("tenant_id","phone");