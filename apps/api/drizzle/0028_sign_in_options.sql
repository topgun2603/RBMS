CREATE TABLE "auth_tenant_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"staff" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"customer" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
