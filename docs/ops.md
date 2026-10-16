# Operations: health, monitoring, backups (batch 6)

The safety net the AWS deployment (batch 7: RDS, ElastiCache, S3, ECS/App Runner) relies on. Everything below works
the same on a dev machine (docker compose Postgres + Redis) and in production.

## Endpoints

### API (`apps/api`, port 4000)

These routes sit outside the tenancy/auth pipeline, so they never wait on the session or tenant lookups.

| Route | Purpose | Answer |
|---|---|---|
| `GET /health` | Liveness: is the process up and serving? Touches no dependency. Use it for the container health check. | `200 {"ok":true}` |
| `GET /ready` | Readiness: Postgres (`select 1`), Redis (`PING` on a fail-fast connection) and the job queue (BullMQ connection ready, workers started), in parallel, each with `READY_TIMEOUT_MS`. Use it for the load balancer target group. | `200` / `503` with per-dependency status and latency (below) |
| `GET /version` | Build info. | `{"sha","buildTime","startedAt","node","env"}` |
| `GET /metrics` | Prometheus text format. Needs `Authorization: Bearer $METRICS_TOKEN`. Not registered at all (404) when `METRICS_TOKEN` is unset. | `200 text/plain; version=0.0.4` / `401` |

`/ready` example (Redis stopped):

```json
{
  "status": "fail",
  "checks": {
    "postgres": { "ok": true, "latencyMs": 1.8 },
    "redis": { "ok": false, "latencyMs": 0.3, "error": "Stream isn't writeable and enableOfflineQueue options is false" },
    "queue": { "ok": false, "latencyMs": 0.9, "error": "redis connection connect" }
  },
  "checkedAt": "2026-10-16T01:20:22.690Z"
}
```

(answered with HTTP 503 in 0.2 s; `/health` stayed 200, and `/ready` was 200 again a few seconds after Redis came back.)

Error texts are scrubbed: no connection strings, hosts or credentials. The checks never return config values.

Every response carries `x-request-id`. A caller-supplied `x-request-id` (8–128 chars of `[A-Za-z0-9._:-]`) is kept,
for example one from the load balancer. Otherwise the API generates a UUID. 500 bodies include the `requestId`, so a
user's screenshot is enough to find the log line and the error report.

### Next apps

Each app serves `GET /api/health` → `{"ok":true,"app":"<name>","sha":…}`. It is static and never calls the API.

| App | Port | App | Port |
|---|---|---|---|
| admin | 3000 | store | 3003 |
| billing | 3001 | seller | 3004 |
| shop | 3002 | www | 3005 |

## Metrics

Served by `@srirealtime/monitoring`, a small built-in registry with no prom-client dependency:

| Metric | Labels | Notes |
|---|---|---|
| `srikit_http_requests_total` | method, route, status | `route` is the pattern (`/v1/invoices/:id`); 404s are `unmatched`, which keeps cardinality bounded |
| `srikit_http_request_duration_seconds` (histogram) | method, route, status_class | buckets 5 ms … 10 s |
| `srikit_job_attempts_total` | job, outcome | outcome = `completed`, `retry` or `failed` (final attempt) |
| `srikit_job_duration_seconds` (histogram) | job | |
| `srikit_job_queue_jobs` | queue, state | BullMQ counts: waiting, active, delayed, failed, completed, paused, prioritized |
| `srikit_job_queue_depth` | queue | waiting + prioritized |
| `srikit_db_pool_max` | | pool size of this process (postgres.js exposes no live pool counters) |
| `srikit_db_connections` | state | `pg_stat_activity` for this database, all clients |
| `process_resident_memory_bytes`, `nodejs_heap_used_bytes`, `process_uptime_seconds`, `nodejs_eventloop_lag_p99_seconds` | | |
| `srikit_metrics_collector_error` | collector | `1` when a scrape-time collector (jobs, db, process) failed or timed out; the scrape itself still succeeds |

Counters are per process. Sum them across tasks in Prometheus or Grafana.

Scrape config:

```yaml
- job_name: srikit-api
  metrics_path: /metrics
  authorization: { type: Bearer, credentials: "<METRICS_TOKEN>" }
  static_configs: [{ targets: ["api.internal:4000"] }]
```

## Errors and logs

**Error reporter** (`@srirealtime/monitoring`, created in `apps/api/src/kit-ops.ts`):

- **When it fires:**
  - 5xx responses (unknown errors and `AppError`s with status ≥ 500), never 4xx;
  - BullMQ jobs that fail their **final** attempt (retries are only counted in the metrics);
  - uncaught exceptions and unhandled rejections (reported, then the process exits as before).
- **What it attaches:**
  - request id, tenant id, user id, route, method and status;
  - for jobs: job name, job id, attempt and `tenantId` when the job data has one. The job data itself is never sent.
- **Drivers:**
  - **console** (default): a scrubbed `error captured` line in the API log;
  - **Sentry-compatible**, enabled by `SENTRY_DSN`: the same log line, plus a POST to the DSN's `/api/<project>/envelope/`. This is a minimal envelope sender (plain `fetch`, no `@sentry/node`). Sends are fire-and-forget with a 5 s timeout and at most 20 in flight, and are flushed on shutdown. A failed send logs a warning and never affects the request or job. Any Sentry-protocol server works, e.g. Sentry, GlitchTip or self-hosted Sentry.
- **Scrubbing**, applied before anything is logged or sent (`scrub.ts`):
  - keys: authorization, cookie, password, `*token`, `*secret`, otp, pin, api keys, signatures, DSNs and database/Redis URLs;
  - inside strings: Bearer/Basic values, JWTs, `sk_…` keys, `user:pass@` in URLs, `?token=`/`?otp=`/`?code=` query params, and "OTP is 123456" style messages.

**Logs** (pino):

- One line per request, `request`, with `reqId`, method, route pattern, path (query string dropped), status, ms, `tenantId` and `userId`.
- Ops routes log at debug, so in production (`info`) health checks don't flood the log. 5xx lines are logged at error.
- `redact` (`LOG_REDACT_PATHS`) filters auth/cookie/API-key/webhook-signature headers and `otp`, `token`, `password`, `secret`, `apiKey` (and similar) fields up to two levels deep.
- `LOG_LEVEL` overrides the level.

## Environment variables

| Variable | Where | Default | Meaning |
|---|---|---|---|
| `SENTRY_DSN` | api | unset | Sentry-compatible DSN; unset = console driver only |
| `SENTRY_ENVIRONMENT` | api | `NODE_ENV` | environment tag on reports |
| `METRICS_TOKEN` | api | unset | bearer token for `/metrics` (16+ chars); unset = `/metrics` is disabled |
| `GIT_SHA`, `BUILD_TIME` | api, Next apps (`GIT_SHA`) | unset | shown by `/version` and `/api/health`; `GIT_SHA` is also the error-report release. Set by the image build. |
| `READY_TIMEOUT_MS` | api | 2000 | per-dependency timeout of `/ready` |
| `LOG_LEVEL` | api | debug (dev) / info | pino level |
| `BACKUP_S3_BUCKET` | scripts | unset | upload backups here; unset = `./backups` |
| `BACKUP_S3_PREFIX` | scripts | `db/` | key prefix |
| `BACKUP_S3_REGION` | scripts | `ap-south-1` | |
| `BACKUP_S3_ENDPOINT` | scripts | unset | S3-compatible endpoint (MinIO, R2); enables path-style addressing |
| `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | scripts | unset | optional; otherwise the default AWS chain (env, profile, ECS task role) |
| `BACKUP_KEEP_DAILY` | scripts | 7 | keep the newest backup of each of the last N days |
| `BACKUP_KEEP_MONTHLY` | scripts | 12 | keep the newest backup of each of the last M months |
| `BACKUP_COMPOSE_SERVICE` | scripts | `postgres` | docker compose service used when `pg_dump`/`pg_restore` are not on PATH |
| `RESTORE_DATABASE_URL` | scripts | unset | default `--target` of the restore script |

The scripts read `DATABASE_URL` and the variables above from the environment, then from `apps/api/.env`.

## Backups

```sh
pnpm ops:backup                       # node scripts/ops/backup-db.mjs
pnpm ops:backup -- --dry-run-prune    # back up, then show what retention would delete
```

What a backup run does:

1. `pg_dump -Fc -Z0` of `DATABASE_URL`, gzipped, written to `<db>-<UTC yyyymmddThhmmssZ>.dump.gz`. This is custom format, compressed once by gzip, so `pg_restore` can still select objects. The password goes in `PGPASSWORD` and is never on the command line.
2. If `pg_dump` isn't on PATH and the database is the local one, the dump runs inside the compose container (`docker compose exec -T postgres pg_dump …`). This is the case on Windows dev machines. Force a mode with `--docker` or `--local`. The local client must be the same major version as the server (Postgres 17) or newer.
3. With `BACKUP_S3_BUCKET` set, the dump is uploaded to S3 with SSE-AES256 and its sha256 in the object metadata, and the local file is removed (`--keep-local` keeps it). Without the bucket, it stays in `./backups` (gitignored).
4. Retention pruning, on S3 or in `./backups`:
   - keep the newest backup of each of the last `BACKUP_KEEP_DAILY` days that have a backup;
   - keep the newest of each of the last `BACKUP_KEEP_MONTHLY` months;
   - always keep the newest backup overall;
   - days and months are IST calendar days and months;
   - files that don't match the backup name pattern are never touched. `--no-prune` skips this step.

In production (batch 7), run it as a scheduled ECS task (EventBridge, nightly at 02:30 IST) with an IAM role that can
`s3:PutObject/ListBucket/DeleteObject` on the backup prefix. RDS automated snapshots stay on as well. These dumps are the
portable, cross-account copy and are what the drill tests.

## Restore

```sh
# into a scratch database (the name must end in _restore)
pnpm ops:restore -- latest --target postgres://srikit:srikit@localhost:5432/srikit_restore --fresh
pnpm ops:restore -- backups/srikit-20261016T011454Z.dump.gz --target postgres://…/srikit_restore
pnpm ops:restore -- s3://srikit-backups/db/srikit-20261016T011454Z.dump.gz --target postgres://…/srikit_restore
```

- The source can be a file path, `s3://bucket/key`, or `latest`: the newest backup on S3 when `BACKUP_S3_BUCKET` is set, otherwise in `./backups`.
- The script refuses a target whose database name doesn't end in `_restore`. Pass `--force` only for a deliberate recovery over a live database.
- `--fresh` drops and recreates the target first, terminating its connections. Without it the database is created if missing, and `pg_restore --clean --if-exists` replaces the objects.
- The restore always runs with `--no-owner --no-acl`, so it works under another role (e.g. the RDS master user).

**Recovering production**, in order:

1. Restore into `srikit_restore` on the same server.
2. Check it (the drill's checks, plus the app pointed at it).
3. Stop the API and worker tasks.
4. Either rename the databases (`alter database srikit rename to srikit_old; alter database srikit_restore rename to srikit;`) or use `restore-db --force --fresh` into `srikit`.
5. Start the tasks, then check `/ready`.

## Restore drill

```sh
pnpm ops:drill            # node scripts/ops/restore-drill.mjs [--keep] [--keep-dump] [--json]
```

What the drill does, in order:

1. Opens a read-only `REPEATABLE READ` transaction on the source and exports its snapshot.
2. Inside that snapshot, counts the rows of every table and reads the drizzle migrations and a sample tenant (the oldest).
3. Runs `pg_dump --snapshot=…`, so the dump and the counts see exactly the same data even while the API keeps writing.
4. Restores into a fresh `<db>_restore` on the same server.
5. Repeats the checks on the copy. They must match exactly: row counts of every table, the `drizzle.__drizzle_migrations` rows (hash and time), and the sample tenant's row plus its row count in every `tenant_id` table.
6. Prints a report, drops the copy and deletes the dump.

Exit code 0 = passed. Run it after schema changes and at least monthly in production, against a restore target on a
scratch RDS instance.

Last run (local docker Postgres, 2026-10-16, with the API running):

```
RESTORE DRILL PASSED
source db        srikit  →  srikit_restore (dropped after the drill)
dump             srikit-20261016T012841Z.dump.gz  727.6 KiB  via docker
tables           112/112 row counts match  (11525 rows in total)
migrations       12 in source, 12 in restore  match
sample tenant    smoke-mv86ssuf (1c3e3c59-…)  reads identically
timings          dump 1.3 s, restore 2.5 s, checks 1.0 s, total 5.0 s
```

## Audit trail

The audit module records security-relevant events. Platform events with no shop (a sign-in without a shop, platform
roles, plan definitions) are stored with a null `tenant_id` (migration `0011_audit_platform_events`) and are listed by
`GET /v1/audit/platform` for super-admins; shops never see them. The admin app has no screen for that list yet. Each event and its action name:

| Event | Action |
|---|---|
| Sign-in (OTP or Google) | `auth.login` |
| Login handoff (create / redeem) | `auth.handoff.create`, `auth.handoff.redeem` |
| Staff roles and members | `staff.role.*`, `staff.member.*` (before/after) |
| Shop members | `tenancy.member.add`, `tenancy.member.roles`, `tenancy.member.remove` (old → new roles) |
| Platform roles and user status | `auth.user.platform_roles`, `auth.user.status` |
| Plan, status and app changes of a shop (super-admin) | `tenancy.tenant.plan`, `tenancy.tenant.status`, `tenancy.tenant.app` (before/after, recorded against the shop) |
| Plan overrides and plan definitions | `plans.override.set` (the shop), `plans.plan.upsert`, `plans.plan.delete` (platform) |
| Self-serve plan change, checkout, cancel, resume | `subscription.*` (recorded once, by the subscriptions service) |
| API keys | `developer.key.create`, `developer.key.rename`, `developer.key.revoke` |
| Subscription admin actions | `subscription.comp`, `subscription.extend_trial`, `subscription.invoice_void` |
| KYC review | `kyc.review.approve`, `kyc.review.reject` (the check's shop; actor = reviewer; no reason text or document numbers) |

Summaries and before/after snapshots never contain secrets, OTPs or tokens.

## On-call checklist

**Something is down or slow:**

1. `curl -s https://api…/ready | jq`: which dependency fails, and how slow it is (`latencyMs`).
   - **postgres** failing: check the RDS status, connections (`srikit_db_connections` near `max_connections`?), storage and CPU. Restarting API tasks does not fix a DB outage.
   - **redis** or **queue** failing: check ElastiCache. The API keeps serving reads and writes, but jobs (notifications, webhooks, reports) wait. BullMQ catches up when Redis returns, so nothing needs replaying.
2. `/health` 200 but `/ready` 503: the load balancer has taken the task out, as intended. Fix the dependency.
3. `/health` failing: the process is wedged or crashed. Check the task logs (`error captured`, `fatal`) and the event-loop lag metric.

**Errors spike:**

1. Look in Sentry (or the log `error captured` lines) by `request_id`, `tenant_id` and `route`.
2. One tenant or every tenant?
3. Did it start with a deploy? `/version` shows the running `sha`.
4. A user reports "Something went wrong": the response body has the `requestId`. Search the logs for `reqId`.

**Jobs pile up:**

- `srikit_job_queue_depth` growing, or `srikit_job_attempts_total{outcome="failed"}` rising: find the job name, look up its final-failure error report (tag `job`), fix the cause, then re-run it (`pnpm --filter @srirealtime/api job <name>` for scheduled jobs).

**Before risky changes** (migrations, data fixes):

1. Run `pnpm ops:backup`.
2. Run `pnpm ops:drill` on staging.
3. Keep the backup's S3 key in the change ticket.

**Monthly:**

- Run the restore drill against the production backup. Record the report and duration; the duration is your restore-time estimate.
- Check that the bucket's object list matches the retention (≈7 daily + 12 monthly).

**Suspicious activity:**

- Query `GET /v1/audit/platform` as a super-admin (or a shop's audit log), filtering by action (`auth.login`, `developer.key.*`, `auth.user.platform_roles`, `subscription.*`) and by actor.
- To revoke API keys, use the shop's Developer settings. To end a user's sessions, block the user (`auth.user.status`).

## Tests

- `pnpm --filter @srirealtime/monitoring test`: scrubbing, the Sentry envelope, readiness and metrics.
- `pnpm --filter @srirealtime/jobs test`: the job observer and queue counts.
- `pnpm --filter @srirealtime/api test`: the server's 5xx-only reporting, `/health` while the pipeline fails, `/ready` 503, `/metrics` auth, and log redaction.
- `pnpm test:ops`: backup names and the retention policy.
