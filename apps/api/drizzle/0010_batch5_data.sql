-- Batch 5 data migration (docs/batch5.md): every existing shop gets a subscription so nothing expires.
-- Shops on a paid plan keep it as an `active`, open-ended (no period end) subscription with provider `manual` (no
-- charge); shops on the free plan (or none) get an active free subscription without a provider. Idempotent: shops
-- that already have a subscription are left alone (the API also creates missing rows lazily the same way).
INSERT INTO "subscriptions" ("tenant_id", "plan_id", "interval", "status", "provider", "current_period_start")
SELECT t."id",
       COALESCE(t."plan_id", 'free'),
       'monthly',
       'active',
       CASE WHEN p."id" IS NOT NULL AND (p."price_monthly_paise" > 0 OR p."price_yearly_paise" > 0) THEN 'manual' ELSE NULL END,
       now()
FROM "tenants" AS t
LEFT JOIN "plans" AS p ON p."id" = t."plan_id"
WHERE NOT EXISTS (SELECT 1 FROM "subscriptions" AS s WHERE s."tenant_id" = t."id");
--> statement-breakpoint
-- Plan & billing is part of every app profile (plans grant it as a core module of the plans package).
UPDATE "app_profiles"
SET "features" = array_append("features", 'subscriptions'), "updated_at" = now()
WHERE NOT ('subscriptions' = ANY("features"));
