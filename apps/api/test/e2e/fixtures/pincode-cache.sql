-- CI fixture: the PIN codes the e2e tests look up, so they don't depend on api.postalpincode.in (unreachable or slow
-- from CI runners; the API then falls back to the approximate prefix table with no city). Fresh fetched_at = the
-- API serves these from its 30-day pincode_cache. Apply after db:migrate:  psql "$DATABASE_URL" -f <this file>
INSERT INTO pincode_cache (pincode, found, city, district, state, state_code, fetched_at)
VALUES ('620001', true, 'Tiruchirappalli', 'Tiruchirappalli', 'Tamil Nadu', '33', now())
ON CONFLICT (pincode) DO UPDATE
SET found = EXCLUDED.found, city = EXCLUDED.city, district = EXCLUDED.district, state = EXCLUDED.state,
    state_code = EXCLUDED.state_code, fetched_at = EXCLUDED.fetched_at;
