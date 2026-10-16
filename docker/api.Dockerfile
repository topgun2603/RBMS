# syntax=docker/dockerfile:1.7
#
# The API image (docs/deploy-aws.md). One image, four uses (the command decides):
#   API service      node dist/main.mjs                 (default CMD; JOBS_WORKERS=false behind the load balancer)
#   worker service   node dist/main.mjs                 (JOBS_WORKERS=true, no load balancer)
#   migrations       node dist/migrate.mjs              (one-off task before each rollout; never on boot)
#   nightly backup   node /app/scripts/ops/backup-db.mjs (scheduled task; pg_dump 17 is installed below)
#   seed             node dist/seed.mjs                 (one-off: plans + app profiles, see the deploy doc)
#
# Build from the repo root:
#   docker build -f docker/api.Dockerfile -t srikit-api --build-arg GIT_SHA=$(git rev-parse HEAD) .
#
# Layout at runtime mirrors the repo, so scripts/ops (which resolve postgres and the S3 SDK from the workspace) and
# the documents module (fonts via require.resolve) find their packages in the hoisted /app/node_modules.

ARG NODE_VERSION=24
ARG ALPINE_VERSION=3.22

# ---------------------------------------------------------------- base: node + pnpm
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 TURBO_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

# ---------------------------------------------------------------- fetch: every package in the lockfile (cached layer)
FROM base AS fetch
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch

# ---------------------------------------------------------------- build: bundle src + the workspace packages it uses
FROM fetch AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store     pnpm install --frozen-lockfile --offline --filter "@srirealtime/api..."
RUN pnpm --filter @srirealtime/api build

# ---------------------------------------------------------------- prod-deps: the pruned node_modules
# Production dependencies of the API and of the workspace packages it bundles, from the frozen lockfile: no
# devDependencies, nothing of the Next apps. Every package is hoisted to /repo/node_modules (symlinks into .pnpm), so
# the bundle in apps/api/dist resolves them by walking up. (pnpm 9's `pnpm deploy` re-resolves versions without the
# lockfile, and `node-linker=hoisted` with --filter installs the whole workspace, so neither is used.)
# Then: drop the workspace links (their code is in the bundle), glibc builds of sharp, type packages and docs.
FROM fetch AS prod-deps
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline --prod --ignore-scripts --config.shamefully-hoist=true --filter "@srirealtime/api..." \
 && rm -rf node_modules/@srirealtime apps/api/node_modules/@srirealtime node_modules/.cache \
 && find node_modules/.pnpm -maxdepth 1 \( -name "@types+*" -o \( -name "@img+sharp-*linux-*" ! -name "*linuxmusl*" \) \) -exec rm -rf {} + \
 && find node_modules/.pnpm -type f \( -name "*.md" -o -name "*.map" -o -name "*.d.ts" -o -name "*.d.mts" -o -name "*.d.cts" -o -name "CHANGELOG*" \) -delete \
 && mkdir -p apps/api/node_modules

# ---------------------------------------------------------------- runtime
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS runtime
# chromium: the documents module renders invoice/receipt PDFs with puppeteer-core (fonts are embedded, so no font
#   packages are needed). Build with --build-arg WITH_CHROMIUM=false for a ~300 MB smaller image without PDFs.
# postgresql17-client: pg_dump / pg_restore for scripts/ops (backup task). Same major version as RDS.
# tini: PID 1 that reaps Chromium's child processes and forwards SIGTERM.
ARG WITH_CHROMIUM=true
RUN apk add --no-cache tini postgresql17-client \
 && if [ "$WITH_CHROMIUM" = "true" ]; then apk add --no-cache chromium; fi \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn*

WORKDIR /app
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=prod-deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/drizzle ./apps/api/drizzle
COPY --from=build /repo/scripts/ops ./scripts/ops
COPY --from=build /repo/package.json ./package.json
# Writable folders for the non-root user: local uploads (STORAGE_DRIVER=local, smoke tests only) and backup scratch.
RUN mkdir -p /app/apps/api/.uploads /app/backups && chown node:node /app/apps/api/.uploads /app/backups

ARG GIT_SHA=""
ARG BUILD_TIME=""
ENV NODE_ENV=production \
    PORT=4000 \
    NODE_OPTIONS=--enable-source-maps \
    CHROME_PATH=/usr/bin/chromium-browser \
    GIT_SHA=${GIT_SHA} \
    BUILD_TIME=${BUILD_TIME}

USER node
WORKDIR /app/apps/api
EXPOSE 4000
# Liveness only (touches no dependency). The load balancer uses /ready.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health" || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.mjs"]
