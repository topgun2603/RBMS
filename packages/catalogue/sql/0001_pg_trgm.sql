-- @rbms/catalogue search (docs/commerce-batch2.md §3). Run before the migration that adds
-- catalog_products.search_text / search_vector and their GIN indexes (catalog_products_search_trgm_idx uses gin_trgm_ops).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
