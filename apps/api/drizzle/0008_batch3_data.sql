-- Batch 3 data migration (docs/batch3.md §B3 branches).
-- Bills are now numbered per branch: invoice_series rows are keyed by (tenant, branch, FY). A shop's existing series
-- (branch_id NULL) belongs to its default (main) branch, so numbering continues there instead of restarting at 1.
-- Shops whose main branch doesn't exist yet are adopted lazily: the main branch is created on the first branches call,
-- and the first bill issued under it moves the shop's series row to it (packages/invoices allocateSeq), with the same
-- continuity rule. Bills issued before branches keep branch_id NULL ("no branch" in reports).
UPDATE "invoice_series" AS s
SET "branch_id" = b."id", "updated_at" = now()
FROM "branches" AS b
WHERE b."tenant_id" = s."tenant_id"
  AND b."is_default" = true
  AND s."branch_id" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "invoice_series" AS x
    WHERE x."tenant_id" = s."tenant_id" AND x."fy" = s."fy" AND x."branch_id" = b."id"
  );
