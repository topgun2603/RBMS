CREATE TABLE "idempotency_keys" (
	"scope" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" integer,
	"body" text,
	"content_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "client" text;--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_scope_idx" ON "idempotency_keys" USING btree ("scope");