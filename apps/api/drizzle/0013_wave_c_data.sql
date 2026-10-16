-- Seller products that were already live before the review step: record them as approved so they stay live.
INSERT INTO "vendor_product_reviews" ("tenant_id", "vendor_id", "product_id", "status", "product_name", "product_image", "submitted_at", "reviewed_at")
SELECT p."tenant_id", p."vendor_id", p."id", 'approved', p."name", p."images"->0->>'url', p."created_at", now()
FROM "catalog_products" p
JOIN "vendors" v ON v."id" = p."vendor_id" AND v."tenant_id" = p."tenant_id"
WHERE p."vendor_id" IS NOT NULL AND p."deleted_at" IS NULL AND p."status" = 'active'
ON CONFLICT ("tenant_id", "product_id") DO NOTHING;
--> statement-breakpoint
-- Plan changes stored before upgrades waited for payment were all downgrades (applied at period end).
UPDATE "subscriptions" SET "pending_reason" = 'downgrade' WHERE "pending_plan_id" IS NOT NULL AND "pending_reason" IS NULL;
