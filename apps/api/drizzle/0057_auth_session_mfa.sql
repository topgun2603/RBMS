ALTER TABLE "auth_handoffs" ADD COLUMN "mfa_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "mfa_at" timestamp with time zone;