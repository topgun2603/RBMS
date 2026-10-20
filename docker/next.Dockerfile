# syntax=docker/dockerfile:1.7
#
# One image recipe for every Next.js app (docs/deploy-aws.md). APP = admin | billing | shop | store | seller | www | pharmacy | restaurant | services.
#
#   docker build -f docker/next.Dockerfile --build-arg APP=store \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.example.in --build-arg NEXT_PUBLIC_ROOT_DOMAIN=example.in \
#     -t srikit-store .
#
# NEXT_PUBLIC_* values are compiled into the JavaScript at build time (browser and server bundles), so an image is
# built for one environment. Server-only values (API_URL, DEFAULT_TENANT, GIT_SHA) are read at runtime.
# Every app listens on container port 3000.

ARG NODE_VERSION=24
ARG ALPINE_VERSION=3.22

FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

FROM base AS fetch
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch

FROM fetch AS build
ARG APP
RUN test -n "$APP" || (echo "Pass --build-arg APP=<admin|billing|shop|store|seller|www|pharmacy|restaurant|services>" && exit 1)
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline --filter "@srirealtime/${APP}..."

# Build-time public configuration (unset = the app's localhost default).
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_ROOT_DOMAIN
ARG NEXT_PUBLIC_APP_URLS
ARG NEXT_PUBLIC_STORE_URL
ARG NEXT_PUBLIC_STORE_DOMAIN
ARG NEXT_PUBLIC_SHOP_DOMAIN
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_DEFAULT_TENANT
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID
ARG NEXT_PUBLIC_CONTACT_EMAIL
ARG NEXT_PUBLIC_CONTACT_WHATSAPP
# next.config.ts switches to output: "standalone" only when this is set (not in dev, CI `next start` or on Windows).
ENV NEXT_OUTPUT=standalone \
    NODE_OPTIONS=--max-old-space-size=3072 \
    NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_ROOT_DOMAIN=${NEXT_PUBLIC_ROOT_DOMAIN} \
    NEXT_PUBLIC_APP_URLS=${NEXT_PUBLIC_APP_URLS} \
    NEXT_PUBLIC_STORE_URL=${NEXT_PUBLIC_STORE_URL} \
    NEXT_PUBLIC_STORE_DOMAIN=${NEXT_PUBLIC_STORE_DOMAIN} \
    NEXT_PUBLIC_SHOP_DOMAIN=${NEXT_PUBLIC_SHOP_DOMAIN} \
    NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    NEXT_PUBLIC_DEFAULT_TENANT=${NEXT_PUBLIC_DEFAULT_TENANT} \
    NEXT_PUBLIC_GOOGLE_CLIENT_ID=${NEXT_PUBLIC_GOOGLE_CLIENT_ID} \
    NEXT_PUBLIC_CONTACT_EMAIL=${NEXT_PUBLIC_CONTACT_EMAIL} \
    NEXT_PUBLIC_CONTACT_WHATSAPP=${NEXT_PUBLIC_CONTACT_WHATSAPP}
RUN pnpm --filter "@srirealtime/${APP}" build \
 && test -f "apps/${APP}/.next/standalone/apps/${APP}/server.js"

FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS runtime
ARG APP
RUN apk add --no-cache tini \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn*
WORKDIR /app
# The standalone server (traced node_modules + the app's server files), then the static assets it doesn't copy.
COPY --from=build /repo/apps/${APP}/.next/standalone ./
COPY --from=build /repo/apps/${APP}/.next/static ./apps/${APP}/.next/static

ARG GIT_SHA=""
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1 \
    GIT_SHA=${GIT_SHA} \
    APP=${APP}

USER node
WORKDIR /app/apps/${APP}
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/api/health" || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
