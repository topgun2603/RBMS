# Operations

## CI

`.github/workflows/ci.yml` runs on every push to `main`, on pull requests and on demand (`workflow_dispatch`). Three
jobs run in parallel on `ubuntu-latest`, each with the pnpm store and the Turborepo cache (`.turbo/cache`) cached:

| Job | What it does |
|---|---|
| **check** | `pnpm install --frozen-lockfile`, then `turbo run typecheck test --concurrency=2` across the repo (vitest unit tests, no database). |
| **build** | `turbo run build --filter="./apps/*"`: `next build` for admin, billing, shop, store, seller and www. |
| **e2e** | Postgres 17 + Redis 7 service containers (same images as `docker-compose.yml`). `db:migrate`, `seed`, `seed:e2e`, then the API (`pnpm --filter @srirealtime/api start`), store (`next start` :3003) and www (`next start` :3005) in the background; waits for `/health` and both sites, runs `test:e2e:all` (batch1, batch2, billing, batch3, batch5 + the storefront browser test) and the www browser test. On failure it uploads `e2e-artifacts` (server logs, test output, screenshots). |

Parallelism is capped (`--concurrency=2`, `NODE_OPTIONS=--max-old-space-size=3072`): the full parallel run runs out of
memory. In CI `E2E_REQUIRE_BROWSER=1` makes `run-all.mjs` fail instead of skip when the store browser test can't run.
`*.localhost` shop hosts are added to `/etc/hosts` for Node's `fetch`; Chrome resolves them itself. The e2e job loads
`apps/api/test/e2e/fixtures/pincode-cache.sql` after migrating, because the API's live PIN lookup
(api.postalpincode.in) doesn't answer from GitHub runners and the tests expect the city for 620001.

Timing: about 8 minutes with a cold cache (check is the slowest), about 2.5 minutes when the Turborepo cache hits.

### Secrets

None. The API runs in development mode (`NODE_ENV` unset), so every external provider is the mock (payments, KYC,
WhatsApp, e-invoice, plan subscriptions) and notifications go to the console driver. The fixed test OTP
(`TEST_OTP_CODE=123456`, `TEST_OTP_TARGETS=+9199990*,e2e-*@example.com`) signs in the e2e identities.
`APP_SECRET`, `CHAT_STREAM_SECRET` and `WHATSAPP_SECRET_KEY` are generated per run (`openssl rand -hex 32`).

### Reproduce locally

```powershell
pnpm install --frozen-lockfile
$env:NODE_OPTIONS = "--max-old-space-size=3072"
pnpm turbo run typecheck test --concurrency=2          # check
pnpm turbo run build --filter="./apps/*" --concurrency=2  # build (writes .next; dev servers use .next-dev)

# e2e: infra up, a clean database, then the same sequence as the job
pnpm infra:up
pnpm --filter @srirealtime/api db:migrate
# optional: the PIN codes the tests look up, if api.postalpincode.in isn't reachable (CI always loads this)
docker compose exec -T postgres psql -U srikit -d srikit -f - < apps/api/test/e2e/fixtures/pincode-cache.sql
pnpm --filter @srirealtime/api seed
pnpm --filter @srirealtime/api seed:e2e
pnpm --filter @srirealtime/api start      # terminal 1 (or `pnpm dev`)
pnpm --filter @srirealtime/store start    # terminal 2, after building store
pnpm --filter @srirealtime/www start      # terminal 3, after building www
$env:E2E_REQUIRE_BROWSER = "1"
pnpm --filter @srirealtime/api test:e2e:all
pnpm --filter @srirealtime/www test:e2e
pnpm --filter @srirealtime/api cleanup:e2e-data   # optional: remove test data from a shared dev database
```

The API needs `TEST_OTP_CODE` / `TEST_OTP_TARGETS` (as in `apps/api/.env`). The browser tests find Chrome at the usual
path for the OS; set `CHROME_PATH` otherwise, and `SHOTS_DIR` to keep screenshots somewhere specific. `API_URL`,
`STORE_URL` and `WWW_URL` point the tests at other ports.
