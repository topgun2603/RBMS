# AWS deployment (batch 7): staging on ECS Fargate

A lean staging environment in **ap-south-1 (Mumbai)**, about **$85–90 a month** on Fargate Spot. Everything is
prepared in the repo; **nothing has been created in AWS**. Terraform has only been run as `fmt`, `init -backend=false`
and `validate`.

| Path | What |
|---|---|
| `docker/api.Dockerfile` | API image: esbuild bundle, pruned production `node_modules`, Chromium (PDFs), `pg_dump` 17, non-root, tini |
| `docker/next.Dockerfile` | One recipe for all six Next apps (`--build-arg APP=store`), Next `output: "standalone"` |
| `.dockerignore` | Keeps `node_modules`, `.next*`, `.env*`, `.git`, `infra/` and docs out of the build context |
| `docker-compose.prod.yml` | Runs the built images locally against the dev Postgres/Redis (smoke test) |
| `apps/api/build.mjs`, `apps/api/src/migrate.ts` | Production bundle (`pnpm --filter @rbms/api build`), and a migration runner that doesn't need drizzle-kit |
| `infra/terraform/bootstrap/` | Run once: S3 state bucket + DynamoDB lock table |
| `infra/terraform/modules/` | `network`, `ecr`, `alb`, `ecs-service`, `database`, `cache`, `storage`, `monitoring`, `github-oidc` |
| `infra/terraform/envs/staging/` | The staging root: variables, `terraform.tfvars.example`, `backend.tf` (commented template) |
| `.github/workflows/deploy.yml` | Manual deploy: build → push → migrate → update services. Off until `AWS_DEPLOY_ENABLED=true` |

## Architecture

```
                       Internet
                          │
                ┌─────────┴─────────┐  ALB (2 AZs, public subnets)
                │  no domain: HTTP, one port per app      │
                │  domain:    HTTPS *.domain, host rules  │
                └──┬──────────────┬──────────────┬────────┘
     api :4000     │  console     │  sites       │
  ┌────────────────┴─┐ ┌──────────┴───────────┐ ┌┴────────────────┐   ECS Fargate (Spot), public subnets,
  │ task "api"       │ │ task "console"       │ │ task "sites"    │   public IP for egress, inbound only
  │  api    :4000    │ │ admin :3000          │ │ store :3003     │   from the ALB security group
  │  worker :4001    │ │ billing :3001        │ │ www   :3005     │
  │ (JOBS_WORKERS)   │ │ shop :3002 seller:3004│ └─────────────────┘
  └──┬──────┬────────┘ └──────────────────────┘
     │      │                           one-off tasks: migrate / seed (api image), backup (02:30 IST, Scheduler)
     │      │  private subnets (no internet route)
  ┌──┴───┐ ┌┴──────────────┐        S3: uploads (private; CloudFront+OAC for public files), backups (versioned)
  │ RDS  │ │ ElastiCache   │        SSM SecureString: every secret  ·  CloudWatch: logs, alarms → SNS email
  │ PG 17│ │ Redis 7 (TLS) │        ECR: srikit-staging/{api,admin,billing,shop,store,seller,www}
  └──────┘ └───────────────┘
```

### Decisions and trade-offs

**No NAT gateway.** A NAT gateway costs about $41/month in Mumbai before data, which is half the budget. Instead the
Fargate tasks run in the **public subnets with a public IP**, and their security groups accept connections only from
the load balancer. Nothing can reach a task directly, but each task's public IP costs $3.65/month (AWS's IPv4
charge). RDS and Redis sit in **private subnets with no internet route** at all. The tasks need outbound internet
anyway: ECR, SSM and CloudWatch Logs, plus MSG91, Resend, Razorpay, WhatsApp, Sentry and the PIN-code lookup. So
VPC interface endpoints (about $8 per endpoint per AZ a month) wouldn't remove the need for egress. The free S3 gateway
endpoint is in place, so image layers, uploads and backups don't travel over the internet.

| Egress option | Monthly | Notes |
|---|---|---|
| **Public subnets + public IP per task** (chosen) | ~$11 for 3 tasks | simplest; the security groups do the isolating |
| NAT instance (t4g.nano, e.g. fck-nat) | ~$7 | cheapest with private tasks, but one more instance to patch and a single point of failure |
| NAT gateway (1 AZ) | ~$41 + $0.056/GB | production choice: tasks in private subnets |
| VPC interface endpoints | ~$8 per endpoint per AZ | still needs a NAT for the providers |

**Few tasks.** Every task costs vCPU, memory and a public IP, so staging packs containers into **three tasks**:

- `api`: the API, plus the **worker** as a sidecar container. It's the same image with `JOBS_WORKERS=true` on port 4001.
- `console`: admin, billing, shop and seller.
- `sites`: store and www.

ECS allows at most 5 target groups per service, so six apps need at least two groups. With `worker_mode = "service"`
and one app per `web_groups` entry, you get the production layout of one service per app and a separate worker
service.

**Worker split (new flag).** `apps/api/src/main.ts` starts the job workers via the jobs module's `start()`, and
`kit.start()` registers the cron schedules. The new **`JOBS_WORKERS`** flag (default `true`, so dev and CI behave as
before) controls both:

- `JOBS_WORKERS=false`: the process only enqueues. It runs no BullMQ workers and registers no schedules, and
  `/ready` still checks the queue connection.
- `JOBS_WORKERS=true`: the process also runs the workers and owns the schedules.

The flag is one env var plus about ten lines in `packages/jobs` and `kit.ts`. Verified locally: the API reports
`runsWorkers:false, workers:0` and the worker reports `runsWorkers:true, workers:24`.

**Fargate Spot** (`use_spot = true`) is about 70% cheaper. AWS can stop a Spot task with two minutes' notice, and ECS
starts a replacement. BullMQ re-queues jobs that were running in a stopped task. That's acceptable for staging. For
production, use `use_spot = false`, or a capacity-provider mix with a FARGATE base.

**Images use moving tags.** Task definitions reference `:staging` for the services and the backup, and `:migrate` for
the migrate task. The workflow pushes `:<git sha>`, then moves the tag and forces a new deployment. Terraform and CI
never fight over task-definition revisions. Every sha stays in ECR for rollback (the newest 20 per repository).
ECS resolves the tag to a digest when a deployment starts, so all tasks in a deployment run the same image.

**Migrations are a separate one-off task** (`node dist/migrate.mjs`), never run on boot. It uses drizzle-orm's
migrator with the same journal and `drizzle.__drizzle_migrations` table as `drizzle-kit migrate`. Against the
existing dev database it was a no-op: "12 migrations recorded".

**CloudFront for store and www: not built.** The store is server-rendered per host and its pages aren't
cacheable across shops. The only cacheable part is `/_next/static`, which is small for staging traffic. A CDN in front
also needs a us-east-1 certificate, Host-header forwarding and an origin hostname. For production, put CloudFront
in front of the ALB for `*.domain` and the apex to get edge-cached static assets, compression, WAF and DDoS
protection. Use cache policies that include the Host header and honour Next's `Cache-Control`.
CloudFront *is* used for **public uploads**, see Storage.

## Images

Both Dockerfiles use `node:24-alpine3.22`. They're multi-stage builds that `pnpm fetch` against the lockfile into a
BuildKit cache, run as the non-root `node` user, use tini as PID 1 and have a `HEALTHCHECK`.

- **API** (`docker/api.Dockerfile`):
  - `build.mjs` bundles `src/` together with the TypeScript workspace packages into `dist/*.mjs` with esbuild.
    Third-party packages stay external.
  - A separate stage runs `pnpm install --prod --frozen-lockfile --filter @rbms/api...` with hoisting, then
    drops type packages, glibc builds of sharp and docs.
  - `pnpm deploy` isn't used: in pnpm 9 it re-resolves versions without the lockfile. `node-linker=hoisted` with
    `--filter` would install the whole workspace, Next included.
  - The runtime layout mirrors the repo, so `scripts/ops/*.mjs` and the documents module's font lookup resolve their
    packages.
  - Chromium is included because invoice PDFs need it. `--build-arg WITH_CHROMIUM=false` builds an image without PDFs.
  - `postgresql17-client` is included because the backup task needs `pg_dump`.
  - The image's command decides the role:

    | Role | Command |
    |---|---|
    | API or worker | `node dist/main.mjs` |
    | Migrations | `node dist/migrate.mjs` |
    | Seed | `node dist/seed.mjs` |
    | Run one job now | `node dist/run-job.mjs <name>` |
    | Backup | `node /app/scripts/ops/backup-db.mjs --local` |

- **Next apps** (`docker/next.Dockerfile --build-arg APP=<app>`):
  - `NEXT_OUTPUT=standalone` switches `next.config.ts` to `output: "standalone"`, with the repo root as the tracing
    root. Only the `next build` phase with that variable set uses it, so `next dev`, CI's `next start` and Windows
    builds are unchanged. Standalone output fails on Windows without Developer Mode because it copies pnpm symlinks.
  - `NEXT_PUBLIC_*` values are build arguments and are compiled into the bundles, so an image belongs to one
    environment. Terraform computes them per app (`next_build_args`).
  - Runtime-only: `PORT`, `API_URL` (server-side calls to the API), `DEFAULT_TENANT` (store) and `GIT_SHA`.

**Sizes** (local build, linux/amd64). "Compressed" is what ECR stores and Fargate pulls; "on disk" is the unpacked
image.

| Image | Compressed | On disk |
|---|---|---|
| api (with Chromium + pg_dump) | 396 MB | ~1.1 GB |
| api, `WITH_CHROMIUM=false` | 90 MB | ~320 MB |
| admin / billing / shop / store / seller / www | 82–84 MB each | ~260 MB each |

Chromium and its libraries are about 260 MB of the API image; the production `node_modules` is 126 MB.

### Local smoke test

```powershell
pnpm infra:up                                            # dev Postgres + Redis
docker compose -f docker-compose.prod.yml build          # 7 images (api first; ~2 min per Next app cold)
docker compose -f docker-compose.prod.yml run --rm migrate
docker compose -f docker-compose.prod.yml up -d          # host ports = dev ports + 10000
curl localhost:14000/ready
curl -H "Host: e2e-store.localhost" localhost:13003/
curl localhost:13005/pricing
docker compose -f docker-compose.prod.yml run --rm backup  # pg_dump into ./backups
docker compose -f docker-compose.prod.yml down
```

Last run (2026-10-16, against the dev database):

| Check | Result |
|---|---|
| `migrate` | `[migrate] up to date: 12 migrations recorded (123 ms)` |
| API `/health` | 200 |
| API `/ready` | 200: postgres, redis, queue ok, `runsWorkers:false` |
| API `/version` | `env:"production"`, sha set |
| API `/metrics` | 401 without the token; 258 `srikit_*` series with it |
| worker `/ready` (inside the container) | 200, 24 workers |
| `/api/health` of all 6 apps | 200, each with the sha |
| store `/` and `/products` (e2e-store), `/` (anbu) | 200, titles "E2E Store", "All products · E2E Store", "Anbu Fashions" |
| www `/pricing` | 200, "Pricing: simple plans for shops", ₹0 / ₹499 / ₹1,499 |
| Invoice PDF (OTP sign-in → `GET /v1/documents/invoice/<id>.pdf`) | 200 `application/pdf`, 75 KB, 1.3 s (Chromium + embedded Tamil fonts) |
| Backup | pg_dump 17.11 in the image, 769.5 KiB dump in 1.7 s |

The first API start failed with `kyc: the mock provider is disabled`. In production the API refuses to boot without a
KYC provider (see "Decide before applying"). The smoke file sets an unreachable placeholder (`KYC_BASE_URL=https://kyc.invalid`).

## URLs: no domain now, a domain later

The apps find the shop from the subdomain (`raja.billing.example.in`), so **billing, shop and seller need a domain**.
An AWS-generated name (`srikit-staging-123.ap-south-1.elb.amazonaws.com`) has no wildcard subdomains. Neither do
CloudFront names, and sslip.io/nip.io need a fixed IP, which an ALB doesn't have.

**No-domain mode** (`domain = ""`, the default): plain HTTP, every app on its development port of the ALB name.

| App | URL | Works without a domain? |
|---|---|---|
| api | `http://<alb>:4000` | yes |
| www | `http://<alb>/` (and `:3005`) | yes: landing, pricing, sign-up (the "open your shop" link can't open a shop subdomain) |
| admin | `http://<alb>:3000` | yes (platform admin; picks shops itself) |
| store | `http://<alb>:3003` | one shop: `store_default_tenant` (e.g. `anbu`) on the bare host |
| billing / shop / seller | `http://<alb>:3001` / `:3002` / `:3004` | health checks only. Opening a shop needs `<slug>.<root>`. |

There's no TLS without a domain, because ACM needs one. Narrow `allowed_cidrs` so staging isn't open to the world.
Sessions still work over HTTP: the session cookie is `Secure` only on HTTPS requests.

**Domain mode** (`domain = "example.in"`): one ACM certificate validated in Route 53, covering `example.in`,
`*.example.in`, `*.billing.example.in`, `*.shop.example.in` and `*.seller.example.in`. Port 443 uses host rules, and
port 80 redirects to HTTPS:

| Host | Goes to | Root domain the app uses |
|---|---|---|
| `example.in`, `www.example.in` | www | |
| `api.example.in` | api | |
| `admin.example.in` | admin | |
| `<shop>.billing.example.in` | billing | `billing.example.in` |
| `<shop>.shop.example.in` | shop (store admin) | `shop.example.in` |
| `<shop>.seller.example.in` | seller | `seller.example.in` |
| `<shop>.example.in`, anything else (custom domains) | store (default) | `example.in` |

`billing`, `shop`, `seller`, `api`, `admin`, `www` and `stores` are already reserved shop slugs, so they never clash
with a shop. A shop's custom domain uses `CNAME` to `stores.example.in`, which the wildcard covers. Serving a custom
domain over HTTPS also needs a certificate for that domain on the listener: an ACM certificate per domain, 25 per ALB
by default, or CloudFront with per-tenant certificates. That's the next step after batch 7 and isn't in this
Terraform.

## First deploy, step by step

You need: the AWS CLI v2, Terraform ≥ 1.10, Docker, `jq`, and the account you choose below.

1. **Pick the account.** Use a dedicated AWS account for srikit, ideally in an AWS Organization with a separate
   `srikit-staging` account. **Do not use the credentials already on this machine** (IAM user `buildr-deploy`); they
   belong to an unrelated account. Set `aws_account_id` in tfvars: the provider then refuses to run against any
   other account.

2. **Give yourself access.** Preferably IAM Identity Center (SSO) with a permission set for Terraform
   (AdministratorAccess while you set up; tighten later):
   ```powershell
   aws configure sso --profile srikit-staging   # region ap-south-1
   aws sso login --profile srikit-staging
   $env:AWS_PROFILE = "srikit-staging"; aws sts get-caller-identity   # check the account id
   ```
   Without SSO, create an IAM user for yourself with MFA (not access keys on a shared machine). CI never uses a user:
   it assumes the GitHub OIDC role from step 9.

3. **Bootstrap the state (once per account).**
   ```powershell
   cd infra/terraform/bootstrap
   terraform init
   terraform apply -var state_bucket=srikit-tfstate-<account id>
   ```
   Then uncomment `envs/staging/backend.tf` and fill in the bucket. The state contains the generated database
   password, Redis token and app secrets: keep that bucket private (it is: TLS-only, public access blocked,
   versioned).

4. **Fill in the variables.**
   ```powershell
   cd ../envs/staging
   copy terraform.tfvars.example terraform.tfvars    # gitignored
   ```
   Set `aws_account_id`, `alarm_emails`, `allowed_cidrs`, `github_repository`, the KYC settings (see "Decide before
   applying"), `store_default_tenant = "anbu"` and **`desired_count = 0`** (no images exist yet).

5. **First apply** (infrastructure only, no tasks):
   ```powershell
   terraform init
   terraform plan -out tfplan      # review it: VPC, ALB, ECS, RDS, ElastiCache, S3, IAM, SSM, alarms
   terraform apply tfplan
   terraform output                # urls, ecr_repositories, run_task_network, github_deploy_role_arn, ...
   ```
   RDS takes about 10 minutes and ElastiCache about 8. Confirm the SNS subscription email.

6. **Set the provider secrets** listed in `provider_secrets`. Each was created as `CHANGE_ME`:
   ```powershell
   aws ssm put-parameter --name /srikit/staging/KYC_TOKEN --type SecureString --overwrite --value "<token>"
   ```
   `APP_SECRET`, `CHAT_STREAM_SECRET`, `WHATSAPP_SECRET_KEY`, `METRICS_TOKEN`, `DATABASE_URL` and `REDIS_URL` are
   generated by Terraform. Read one with `aws ssm get-parameter --with-decryption --name /srikit/staging/METRICS_TOKEN`.

7. **Build and push the images.** The ALB name now exists, so the `NEXT_PUBLIC_*` values are known.
   - **With GitHub** (recommended), do the setup in step 9, then run *Deploy (AWS)* from the Actions tab. It builds,
     pushes, migrates and deploys. Skip steps 8 and 10.
   - **By hand**, from a machine with Docker:
     ```bash
     cd <repo root>; export AWS_PROFILE=srikit-staging
     SHA=$(git rev-parse HEAD); TF="terraform -chdir=infra/terraform/envs/staging"
     REG=$($TF output -json ecr_repositories | jq -r '.api' | cut -d/ -f1)
     aws ecr get-login-password | docker login --username AWS --password-stdin "$REG"
     docker build -f docker/api.Dockerfile --build-arg GIT_SHA=$SHA -t $REG/srikit-staging/api:$SHA .
     for app in admin billing shop store seller www; do
       args=$($TF output -json next_build_args | jq -r --arg a $app '.[$a] | to_entries[] | "--build-arg \(.key)=\(.value)"')
       docker build -f docker/next.Dockerfile --build-arg APP=$app --build-arg GIT_SHA=$SHA $args -t $REG/srikit-staging/$app:$SHA .
     done
     for img in api admin billing shop store seller www; do
       docker push $REG/srikit-staging/$img:$SHA
       docker tag  $REG/srikit-staging/$img:$SHA $REG/srikit-staging/$img:staging && docker push $REG/srikit-staging/$img:staging
     done
     docker tag $REG/srikit-staging/api:$SHA $REG/srikit-staging/api:migrate && docker push $REG/srikit-staging/api:migrate
     ```

8. **Migrate** (by hand; the workflow does this itself):
   ```bash
   NET=$($TF output -raw run_task_network)
   aws ecs run-task --cluster srikit-staging --task-definition srikit-staging-migrate --launch-type FARGATE \
     --network-configuration "$NET" --query 'tasks[0].taskArn'
   aws logs tail /ecs/srikit-staging-migrate --follow     # "[migrate] up to date: N migrations recorded"
   ```

9. **GitHub deploy setup** (optional until you want CI deploys):
   - Set `github_repository = "owner/repo"` and apply. If the account already has a GitHub OIDC provider, also set
     `create_github_oidc_provider = false`.
   - In the repo, create the environment **staging** (add yourself as a required reviewer). Give it these variables:
     - `AWS_DEPLOY_ROLE_ARN`: from `terraform output github_deploy_role_arn`;
     - `AWS_REGION`: `ap-south-1`;
     - `DEPLOY_CONFIG_PARAM`: `/srikit/staging/deploy/config`.
   - Set the repository variable `AWS_DEPLOY_ENABLED` to `true`. Until then every job is skipped. The workflow has
     no push trigger at all.

10. **Seed.** Use the migrate task with a command override. Which seed scripts are safe:

    | Script | In production / staging |
    |---|---|
    | `dist/seed.mjs` with `SEED_DEMO=false` | **Safe.** Upserts plans and app profiles and makes `SEED_SUPERADMIN` super-admin. Idempotent. A re-run resets the plan definitions to the ones in code, overwriting price or limit edits made in admin, so run it on first deploy and after plan changes in code. |
    | `dist/seed.mjs` (demo on) | **Staging only.** Also creates demo shops raja, kumar and anbu with catalogues and placeholder pictures (written to S3). Never in production. |
    | `seed:e2e`, `cleanup:e2e-data` | **Never.** Development databases only; `seed:e2e` refuses `NODE_ENV=production`. Neither is in the image. |
    | `migrate:items`, `migrate:locations`, `migrate:search` | One-off backfills for old data; not needed on a fresh database. Not in the image (`dist/run-job.mjs` runs scheduled jobs). |

    ```bash
    aws ecs run-task --cluster srikit-staging --task-definition srikit-staging-migrate --launch-type FARGATE \
      --network-configuration "$NET" --overrides '{"containerOverrides":[{"name":"migrate","command":["node","dist/seed.mjs"],
        "environment":[{"name":"SEED_SUPERADMIN","value":"+91XXXXXXXXXX"},{"name":"SEED_DEMO","value":"true"}]}]}'
    ```

11. **Start the services:** set `desired_count = 1` and run `terraform apply`. That's the 3 services.

12. **Check:**
    - `curl http://<alb>:4000/ready` returns `{"status":"ok"}`;
    - `http://<alb>/pricing` renders;
    - `http://<alb>:3003/` shows the anbu store;
    - `aws ecs describe-services --cluster srikit-staging --services srikit-staging-api srikit-staging-console srikit-staging-sites`
      shows each service with 1 running task;
    - the CloudWatch alarms are `OK` after a few minutes.

    The nightly backup runs at 02:30 IST. To run it now, use
    `aws ecs run-task --task-definition srikit-staging-backup ...` with the same network, then check with
    `aws s3 ls s3://srikit-staging-<account>-backups/db/`.

### Pointing a domain later

1. Buy the domain (any registrar). Set `domain = "example.in"` (and keep `create_route53_zone = true`, or give
   `route53_zone_id` of an existing zone), `terraform apply`.
2. Set the registrar's name servers to `terraform output route53_name_servers`. ACM validates once DNS has
   propagated, which can take minutes to hours. Re-run `apply` if it timed out waiting.
3. Run the deploy workflow. The `NEXT_PUBLIC_*` URLs change, so the images must be rebuilt. The API's
   `CORS_ORIGINS`, `ROOT_DOMAIN`, `*_PUBLIC_URL` and the S3 CORS rules are recomputed by the same apply.
4. `store_default_tenant` no longer applies: every shop is `<slug>.example.in`.
5. Optional: drop `allowed_cidrs` to the world, and add Google sign-in (`GOOGLE_CLIENT_ID`,
   `NEXT_PUBLIC_GOOGLE_CLIENT_ID`) with the new origins.

## Day-2 operations

- **Logs:** run `aws logs tail /ecs/srikit-staging-api --follow` (also `-console`, `-sites`, `-migrate`, `-backup`).
  Streams are named `<container>/<container>/<task id>`.
- **Shell in a task (ECS Exec):**
  ```
  aws ecs execute-command --cluster srikit-staging --task <id> --container api --interactive --command sh
  ```
  It needs the Session Manager plugin. `psql` is in the API image (`psql "$DATABASE_URL"`).
- **Pause staging** with `desired_count = 0` and apply, or `aws ecs update-service --desired-count 0`. Also stop RDS
  (`aws rds stop-db-instance`; it restarts by itself after 7 days). The ALB, Redis and NAT-free networking keep
  costing about $35/month.
- **Alarms** go to the SNS topic:
  - load balancer 5xx and ELB 5xx;
  - unhealthy targets per app;
  - `api-not-ready` (no API task passes `/ready`);
  - RDS CPU, storage and memory;
  - Redis memory and CPU;
  - `errors-captured` (5+ `error captured` log lines in 5 minutes);
  - a failed migrate or backup run (EventBridge).
- **Metrics:** `/metrics` is on the public API URL behind `METRICS_TOKEN`. In production, scrape it from inside the VPC.

## Rollback

| What went wrong | Do this |
|---|---|
| New tasks never become healthy | Nothing: the deployment circuit breaker rolls the service back to the previous task set automatically. The workflow's wait step fails. |
| A release is live but bad | Run *Deploy (AWS)* with `rollback_to = <previous good sha>`. That moves `:staging` back to that image (which is still in ECR) and redeploys, skipping build and migrations. By hand: `aws ecr batch-get-image` the old manifest, `put-image` it as `staging`, then `aws ecs update-service --force-new-deployment` for each service. |
| A migration broke something | Migrations only go forward. Ship a fix-forward migration. If data is damaged, restore (next row). Rolling back the image is safe only if the old code still works with the new schema; keep migrations additive (add, backfill, then drop in a later release) to keep it so. |
| Data loss or corruption | Point-in-time restore of RDS to a new instance (any second in the last 7 days): `aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier srikit-staging --target-db-instance-identifier srikit-staging-pitr --use-latest-restorable-time` (or `--restore-time`). Then either point `DATABASE_URL` at it, or dump and restore into the original. Alternatively restore a nightly dump: `restore-db.mjs` from the API image, the procedure in docs/ops.md "Recovering production". |
| An infrastructure change went wrong | `git revert` the Terraform change, then `terraform plan` and `terraform apply`. RDS has deletion protection and a final snapshot. The S3 buckets are versioned, and replaced objects stay for 30 days. |
| A secret was rotated wrongly | SSM keeps parameter history: `aws ssm get-parameter-history --name /srikit/staging/X --with-decryption`. Put the old value back, then force a new deployment. |

## Monthly cost (ap-south-1, estimate)

These are approximate on-demand list prices as of 2026, for staging traffic. Check them in the AWS Pricing
Calculator; Spot prices float.

| Resource | Size | On-demand | With Spot (default) |
|---|---|---|---|
| Fargate `api` (api + worker) | 0.5 vCPU / 2 GB | $22.4 | ~$7 |
| Fargate `console` (4 apps) | 0.25 vCPU / 2 GB | $14.6 | ~$4.5 |
| Fargate `sites` (store + www) | 0.25 vCPU / 1 GB | $11.2 | ~$3.5 |
| One-off tasks (nightly backup, migrations) | 5 min/day | <$0.3 | <$0.3 |
| Public IPv4 | 3 tasks + 2 for the ALB | $18.3 | $18.3 |
| Application Load Balancer | 1 ALB, ~1 LCU | $17.5 + ~$3 | $20.5 |
| RDS PostgreSQL 17 | db.t4g.micro, 20 GB gp3, single-AZ, 7-day backups | ~$16 | ~$16 |
| ElastiCache Redis 7 | cache.t4g.micro, 1 node (Valkey: about -20%) | ~$12.8 | ~$12.8 |
| CloudWatch | ~3 GB logs, 17 alarms | ~$3.5 | ~$3.5 |
| ECR | ~5–8 GB of images (20 per repository) | ~$0.7 | ~$0.7 |
| S3 uploads + backups, CloudFront for uploads | small; CloudFront's free tier is 1 TB/month | ~$0.5 | ~$0.5 |
| SSM parameters (standard), EventBridge Scheduler, SNS | | $0 | $0 |
| Route 53 zone (domain mode only) | | $0.5 | $0.5 |
| State bucket + lock table | | <$0.1 | <$0.1 |
| **Total** | | **~$121** | **~$88** |

Ways to reduce it:

- `cpu_architecture = "ARM64"` saves about $10 on-demand (about $3 on Spot), but needs arm64 images: arm64 runners,
  or slow QEMU builds.
- `redis_engine = "valkey"` saves about $2.5.
- Pausing staging at night (desired count 0, RDS stopped) saves about $25.
- Turning off ECS Exec changes nothing in cost.
- The biggest fixed items are the ALB, the IPv4 addresses and RDS.

## Production: what changes for high availability

- **Network:** private subnets for the tasks, with a NAT gateway per AZ (or one to start). Run 3 AZs if the budget
  allows.
- **Compute:**
  - `worker_mode = "service"` and one app per `web_groups` entry, so services deploy and scale independently;
  - `desired_count >= 2` per service, spread over AZs, with ECS service auto-scaling on CPU and ALB request count;
  - on-demand Fargate as the base, with Spot only above it;
  - more CPU and memory for the API.
- **Database:**
  - `db_multi_az = true` and a larger class (db.t4g.small/medium, or db.m7g);
  - Performance Insights and 14–35 days of backups;
  - automated snapshot copies to a second region or account;
  - `sslmode=verify-full` with the RDS CA bundle;
  - RDS Proxy if connections grow (each task holds a pool of 10).
- **Redis:** `replicas = 1` (automatic failover, Multi-AZ).
- **Edge:**
  - CloudFront in front of the ALB (static caching, WAF with the AWS managed rule groups, rate limiting on
    `/v1/auth/*`);
  - per-domain certificates for shops' custom domains.
- **Secrets:** a customer-managed KMS key; Secrets Manager rotation where the provider supports it.
- **Delivery:**
  - a separate `production` environment and account (copy `envs/staging` to `envs/production` with its own tfvars
    and state key);
  - immutable sha tags for production, and required reviewers on the GitHub environment;
  - deploy staging first, then promote the same sha.
- **Observability:** Container Insights, a Sentry DSN, Prometheus scraping `/metrics` from inside the VPC, and a
  synthetic check of `/ready` and the store.
- **Data protection:** uploads replicated to another region, and backup bucket object lock.

## Environment variables

### API, worker, migrate (`apps/api/src/env.ts`)

How values are provided:

- **Computed:** set by Terraform from the URL scheme (`envs/staging/locals.tf`).
- **Generated:** a random value in SSM, created by Terraform.
- **Secret:** a `provider_secrets` entry. It's created as `CHANGE_ME`; you set the real value.
- **Plain:** an `api_environment` entry.

| Variable | Staging value / source | Notes |
|---|---|---|
| `NODE_ENV` | `production` (computed) | real providers only; mocks refused |
| `PORT` | `4000`; worker sidecar `4001` (computed) | |
| `JOBS_WORKERS` | API `false`, worker `true` (computed) | new in batch 7 |
| `APP_NAME` | default `Srirealtime` (plain to override) | |
| `API_PUBLIC_URL` | `urls.api` (computed) | |
| `ROOT_DOMAIN` | domain or ALB name (computed) | |
| `CORS_ORIGINS` | all app origins incl. `https://*.billing.<domain>` (computed) | |
| `WWW_PUBLIC_URL`, `APP_PUBLIC_URL`, `BILLING_PUBLIC_URL`, `STORE_PUBLIC_URL` | computed from the URL scheme | |
| `CNAME_TARGET` | `stores.<domain>` (computed) | |
| `DATABASE_URL` | generated: `postgres://…rds…/srikit?sslmode=require` | |
| `REDIS_URL` | generated: `rediss://:<token>@…:6379` | TLS + AUTH |
| `APP_SECRET`, `CHAT_STREAM_SECRET`, `WHATSAPP_SECRET_KEY` | generated, 48–64 chars | |
| `METRICS_TOKEN` | generated | |
| `STORAGE_DRIVER` | `s3` (computed) | |
| `S3_BUCKET`, `S3_REGION` | uploads bucket, `ap-south-1` (computed) | credentials from the task role |
| `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | unset | only for R2/MinIO |
| `PUBLIC_UPLOAD_BASE_URL` | the CloudFront URL (computed) | |
| `STORAGE_LOCAL_DIR` | unused | |
| `KYC_BASE_URL`, `KYC_PROVIDER_NAME` | plain | **required** to boot in production |
| `KYC_TOKEN` | secret | **required** to boot in production |
| `MSG91_AUTH_KEY` | secret | unset = SMS to the console log |
| `MSG91_SENDER_ID`, `MSG91_OTP_FLOW_ID` | plain | |
| `RESEND_API_KEY` | secret | unset = email to the console log |
| `EMAIL_FROM` | plain | |
| `WHATSAPP_TOKEN` | secret | |
| `WHATSAPP_PHONE_NUMBER_ID` | plain | |
| `FCM_SERVICE_ACCOUNT_JSON` | secret | |
| `EINVOICE_GSP_BASE_URL`, `EINVOICE_GSP_SANDBOX_URL`, `EINVOICE_GSP_CLIENT_ID` | plain | |
| `EINVOICE_GSP_CLIENT_SECRET` | secret | |
| `PLATFORM_RAZORPAY_KEY_ID`, `_KEY_SECRET`, `_WEBHOOK_SECRET` | secret (all three or none) | none = online plan payments answer 503 |
| `PLATFORM_LEGAL_NAME`, `PLATFORM_GSTIN`, `PLATFORM_STATE_CODE`, `PLATFORM_ADDRESS`, `PLATFORM_INVOICE_PREFIX` | plain (defaults otherwise) | |
| `GOOGLE_CLIENT_ID` | plain | |
| `SENTRY_DSN` | secret | |
| `SENTRY_ENVIRONMENT` | `staging` (computed) | |
| `LOG_LEVEL`, `READY_TIMEOUT_MS` | `info`, `2000` (computed) | |
| `GIT_SHA`, `BUILD_TIME` | image build arguments | shown by `/version` |
| `SESSION_TTL_DAYS`, `OTP_TTL_MINUTES` | defaults (plain to change) | |
| `TRUST_PROXY_HOPS` | default `1` (the ALB) | proxies in front of the API; the client IP (rate limits, audit, sign-in records) is the `X-Forwarded-For` entry this many hops from the right, so client-written entries are ignored. Raise it only if another proxy (CDN) is added in front of the ALB |
| `SEED_SUPERADMIN`, `SEED_DEMO` | only as overrides of a seed run | |
| `TEST_OTP_CODE`, `TEST_OTP_TARGETS` | never set | ignored in production anyway |
| `CHROME_PATH` | `/usr/bin/chromium-browser` (image) | |
| `BACKUP_S3_BUCKET`, `BACKUP_S3_PREFIX`, `BACKUP_S3_REGION`, `BACKUP_KEEP_*` | backup task only (computed) | |

### Next apps

`NEXT_PUBLIC_*` values are build arguments (`terraform output next_build_args`, also in the deploy config
parameter). The rest are runtime environment variables.

| Variable | Apps | No-domain value | Domain value |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | all | `http://<alb>:4000` | `https://api.<d>` |
| `NEXT_PUBLIC_ROOT_DOMAIN` | all | `<alb>` | store/www/admin `<d>`; billing `billing.<d>`; shop `shop.<d>`; seller `seller.<d>` |
| `NEXT_PUBLIC_APP_URLS` | admin, www | `BL=http://<alb>:3001,EC=http://<alb>:3002` | `BL=https://{slug}.billing.<d>,EC=https://{slug}.shop.<d>` |
| `NEXT_PUBLIC_STORE_URL`, `NEXT_PUBLIC_STORE_DOMAIN` | billing, shop, seller | `http://<alb>:3003`, `<alb>:3003` | `https://{slug}.<d>`, `<d>` |
| `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SHOP_DOMAIN` | www | `http://<alb>`, `<alb>` | `https://<d>`, `<d>` |
| `NEXT_PUBLIC_DEFAULT_TENANT` | store | `store_default_tenant` | unset |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_CONTACT_*` | admin, www | `next_public` | `next_public` |
| `PORT` | all (runtime) | 3000–3005, the dev ports | same |
| `API_URL` | store, www (runtime, server-side) | `http://<alb>:4000` | `https://api.<d>` |
| `TRUST_PROXY_HOPS` | store, www (runtime) | default `1` | default `1` |
| `DEFAULT_TENANT` | store (runtime) | `store_default_tenant` | unset |
| `GIT_SHA` | all (build) | the commit | the commit |

**Client IPs through the store and www proxies.** Their `/api/v1/*` proxies forward one `X-Forwarded-For` entry: the
visitor's address as the ALB saw it (`TRUST_PROXY_HOPS` hops from the right). The API then trusts one hop. While
`API_URL` points back at the public ALB, the ALB appends the store task's own address, so the API sees the store task
as the client for proxied shopper calls (they share one per-IP budget). Point `API_URL` at a direct route (ECS Service
Connect or an internal ALB that the store reaches without the public one) to keep per-shopper limits; do not raise the
API's `TRUST_PROXY_HOPS` to 2 for this, because direct browser calls would then trust a client-written entry.

## Decide before applying

1. **The AWS account and who applies Terraform** (steps 1 and 2). Not the `buildr-deploy` account.
2. **A domain.** Without one, billing, shop and seller can't open a shop on staging, there's no HTTPS, and Google
   sign-in won't accept the HTTP origins. A `.in` domain costs about ₹800 a year. Recommendation: buy one before
   relying on staging.
3. **KYC.** The API refuses to start in production without `KYC_BASE_URL` + `KYC_TOKEN`; the mock is
   development-only. Terraform's `check "kyc_provider"` warns about this. Options:
   - provider sandbox credentials (recommended);
   - an unreachable placeholder, as in the smoke test, where KYC checks then fail;
   - a code change that makes KYC optional in production. That's not done here, because it is application logic.
4. **SMS and email.** Without `MSG91_AUTH_KEY` or `RESEND_API_KEY`, sign-in codes go to the console driver and are
   written to CloudWatch Logs in plain text. Anyone who can read the logs can sign in as anyone. That's tolerable
   only on a locked-down staging (`allowed_cidrs`, restricted log access). Otherwise configure the providers.
5. **Public uploads.** The uploads module keeps public and private files under one key prefix (`t/<tenant>/…`), so
   the CloudFront origin can serve any object whose key is known. Keys contain a random UUID; this is the exposure
   model of a public R2 bucket, which the module was built for. Private files are otherwise only reachable through
   presigned URLs. Hardening means putting public files under a `public/` prefix and limiting CloudFront to it. That's
   a small change in `packages/uploads`, not made here.
6. **Cost posture:**
   - Spot (default) vs on-demand;
   - the sidecar worker (default) vs a separate service;
   - the web groups;
   - x86 (default) vs ARM64.
7. **Exposure:** `allowed_cidrs` open to the world, or limited to office/VPN addresses.
8. **Alarm recipients** (`alarm_emails`), and GitHub: the repository, environment reviewers, and when to set
   `AWS_DEPLOY_ENABLED`.
9. **Demo data on staging** (seed with `SEED_DEMO=true`, needed for `store_default_tenant = "anbu"`), and the
   super-admin identity (`SEED_SUPERADMIN`).
10. **Terraform state holds secrets** (database password, Redis token, app secrets). Decide who can read the state
    bucket.

## Verification done while preparing

- `terraform fmt -recursive`; `terraform init -backend=false` + `terraform validate` in `bootstrap/` and
  `envs/staging/`. Both passed: "Success! The configuration is valid." This ran with the AWS environment variables
  cleared and no AWS calls. tflint and checkov aren't installed, so they weren't run.
- `pnpm turbo run typecheck` (62 packages); unit tests of jobs, db and api; `turbo run build --filter=./apps/*` (the
  CI build job, which now also bundles the API); `pnpm --filter @rbms/api test:e2e:all` against the running
  dev servers.
- The local Docker smoke test above.
