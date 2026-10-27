CREATE TABLE "payroll_advances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount" integer NOT NULL,
	"instalment" integer NOT NULL,
	"start_month" text NOT NULL,
	"method" text DEFAULT 'cash' NOT NULL,
	"reference" text,
	"reason" text,
	"status" text DEFAULT 'open' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_advances_amount_chk" CHECK ("payroll_advances"."amount" > 0 and "payroll_advances"."instalment" > 0)
);
--> statement-breakpoint
CREATE TABLE "payroll_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" text NOT NULL,
	"leave_type_id" uuid,
	"leave_request_id" uuid,
	"check_in" timestamp with time zone,
	"check_out" timestamp with time zone,
	"worked_minutes" integer DEFAULT 0 NOT NULL,
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"overtime_minutes" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'manager' NOT NULL,
	"note" text,
	"marked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_attendance_emp_date_uq" UNIQUE("tenant_id","employee_id","date"),
	CONSTRAINT "payroll_attendance_status_chk" CHECK ("payroll_attendance"."status" in ('present', 'absent', 'half_day', 'leave', 'week_off', 'holiday'))
);
--> statement-breakpoint
CREATE TABLE "payroll_attendance_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"changed_by" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_due_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"month" text NOT NULL,
	"date" date NOT NULL,
	"amount" integer NOT NULL,
	"method" text DEFAULT 'bank' NOT NULL,
	"reference" text,
	"status" text DEFAULT 'paid' NOT NULL,
	"paid_by" uuid,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_due_payments_amount_chk" CHECK ("payroll_due_payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "payroll_employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"user_id" uuid,
	"branch_id" uuid,
	"designation" text,
	"join_date" date NOT NULL,
	"leave_date" date,
	"status" text DEFAULT 'active' NOT NULL,
	"pay_type" text DEFAULT 'monthly' NOT NULL,
	"salary" jsonb NOT NULL,
	"shift_start" text,
	"shift_end" text,
	"week_offs" integer[],
	"pay_method" text DEFAULT 'cash' NOT NULL,
	"bank_name" text,
	"account_number" text,
	"ifsc" text,
	"upi_id" text,
	"uan" text,
	"esi_number" text,
	"pan" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_employees_tenant_code_uq" UNIQUE("tenant_id","code"),
	CONSTRAINT "payroll_employees_pay_type_chk" CHECK ("payroll_employees"."pay_type" in ('monthly', 'daily', 'hourly'))
);
--> statement-breakpoint
CREATE TABLE "payroll_holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_leave_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"opening" real DEFAULT 0 NOT NULL,
	"adjustment" real DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_leave_balances_uq" UNIQUE("tenant_id","employee_id","leave_type_id","year")
);
--> statement-breakpoint
CREATE TABLE "payroll_leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"half_day" boolean DEFAULT false NOT NULL,
	"days" real NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_leave_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"paid" boolean DEFAULT true NOT NULL,
	"yearly_days" real DEFAULT 0 NOT NULL,
	"carry_forward" boolean DEFAULT false NOT NULL,
	"max_carry_days" real DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_leave_types_tenant_code_uq" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
CREATE TABLE "payroll_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount" integer NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"status" text DEFAULT 'paid' NOT NULL,
	"paid_by" uuid,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_run_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"days" jsonb NOT NULL,
	"basis_days" real DEFAULT 0 NOT NULL,
	"paid_days" real DEFAULT 0 NOT NULL,
	"earnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deductions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"employer" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"heads" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"adjustments" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warnings" text[] DEFAULT '{}' NOT NULL,
	"gross" integer DEFAULT 0 NOT NULL,
	"total_deductions" integer DEFAULT 0 NOT NULL,
	"round_off" integer DEFAULT 0 NOT NULL,
	"net" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_run_lines_run_emp_uq" UNIQUE("run_id","employee_id")
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"month" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"totals" jsonb,
	"config" jsonb NOT NULL,
	"notes" text,
	"computed_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"finalized_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"next_employee_no" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "payroll_advances_tenant_emp_idx" ON "payroll_advances" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE INDEX "payroll_attendance_tenant_date_idx" ON "payroll_attendance" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "payroll_attendance_log_emp_idx" ON "payroll_attendance_log" USING btree ("tenant_id","employee_id","date");--> statement-breakpoint
CREATE INDEX "payroll_due_payments_tenant_idx" ON "payroll_due_payments" USING btree ("tenant_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_employees_tenant_user_uq" ON "payroll_employees" USING btree ("tenant_id","user_id") WHERE "payroll_employees"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "payroll_employees_tenant_status_idx" ON "payroll_employees" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "payroll_holidays_tenant_date_idx" ON "payroll_holidays" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "payroll_leave_requests_tenant_status_idx" ON "payroll_leave_requests" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "payroll_leave_requests_emp_idx" ON "payroll_leave_requests" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_payments_line_paid_uq" ON "payroll_payments" USING btree ("line_id") WHERE "payroll_payments"."status" = 'paid';--> statement-breakpoint
CREATE INDEX "payroll_payments_tenant_run_idx" ON "payroll_payments" USING btree ("tenant_id","run_id");--> statement-breakpoint
CREATE INDEX "payroll_run_lines_tenant_emp_idx" ON "payroll_run_lines" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_tenant_month_uq" ON "payroll_runs" USING btree ("tenant_id","month") WHERE "payroll_runs"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "payroll_runs_tenant_idx" ON "payroll_runs" USING btree ("tenant_id","month");