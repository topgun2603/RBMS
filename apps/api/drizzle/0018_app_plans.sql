ALTER TABLE "plans" ADD COLUMN "app_id" text;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "tier" text;--> statement-breakpoint
CREATE INDEX "plans_app_idx" ON "plans" USING btree ("app_id","tier");--> statement-breakpoint
-- Plans per app: the shared tiers become templates. Every app (app_profiles) gets its own copy of each tier
-- ("ph-pro" …), shops and subscriptions move to their app's copy of the plan they are on, and the shared plans stop
-- being offered to shops (they stay for history and for apps without plans of their own).
UPDATE "plans" SET "tier" = "id" WHERE "app_id" IS NULL AND "id" IN ('free', 'starter', 'pro', 'enterprise');--> statement-breakpoint
INSERT INTO "plans" ("id", "app_id", "tier", "name", "description", "price_monthly_paise", "price_yearly_paise", "modules", "limits", "features", "is_public", "sort")
SELECT lower(a."app_id") || '-' || p."id", a."app_id", p."id", p."name", p."description", p."price_monthly_paise", p."price_yearly_paise", p."modules", p."limits", p."features", p."is_public", p."sort"
FROM "plans" p CROSS JOIN "app_profiles" a
WHERE p."app_id" IS NULL AND p."id" IN ('free', 'starter', 'pro', 'enterprise')
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
UPDATE "tenants" t SET "plan_id" = lower(t."app_id") || '-' || t."plan_id"
WHERE t."app_id" IS NOT NULL AND t."plan_id" IN ('free', 'starter', 'pro', 'enterprise')
  AND EXISTS (SELECT 1 FROM "plans" q WHERE q."id" = lower(t."app_id") || '-' || t."plan_id");--> statement-breakpoint
UPDATE "subscriptions" s SET
  "plan_id" = CASE WHEN s."plan_id" IN ('free', 'starter', 'pro', 'enterprise') AND EXISTS (SELECT 1 FROM "plans" q WHERE q."id" = lower(t."app_id") || '-' || s."plan_id") THEN lower(t."app_id") || '-' || s."plan_id" ELSE s."plan_id" END,
  "pending_plan_id" = CASE WHEN s."pending_plan_id" IN ('free', 'starter', 'pro', 'enterprise') AND EXISTS (SELECT 1 FROM "plans" q WHERE q."id" = lower(t."app_id") || '-' || s."pending_plan_id") THEN lower(t."app_id") || '-' || s."pending_plan_id" ELSE s."pending_plan_id" END,
  "checkout_plan_id" = CASE WHEN s."checkout_plan_id" IN ('free', 'starter', 'pro', 'enterprise') AND EXISTS (SELECT 1 FROM "plans" q WHERE q."id" = lower(t."app_id") || '-' || s."checkout_plan_id") THEN lower(t."app_id") || '-' || s."checkout_plan_id" ELSE s."checkout_plan_id" END
FROM "tenants" t
WHERE t."id" = s."tenant_id" AND t."app_id" IS NOT NULL;--> statement-breakpoint
UPDATE "plans" SET "is_public" = false WHERE "app_id" IS NULL AND EXISTS (SELECT 1 FROM "plans" q WHERE q."app_id" IS NOT NULL);
