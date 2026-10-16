# Public URLs, the API's environment and the Next apps' build arguments, for both modes. The table in
# docs/deploy-aws.md ("Environment variables") is the readable version of this file.

locals {
  name        = "${var.project}-${var.environment}" # srikit-staging
  ssm_prefix  = "/${var.project}/${var.environment}"
  domain_mode = var.domain != ""
  d           = var.domain
  alb         = module.alb.dns_name
  base        = "http://${module.alb.dns_name}"

  tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
  }

  apps = ["admin", "billing", "shop", "store", "seller", "www"]
  # Container ports = the development ports, so the apps of one task never collide.
  ports = { api = 4000, admin = 3000, billing = 3001, shop = 3002, store = 3003, seller = 3004, www = 3005 }

  # What a browser opens. {slug} = the shop's subdomain.
  urls = local.domain_mode ? {
    api     = "https://api.${local.d}"
    admin   = "https://admin.${local.d}"
    billing = "https://{slug}.billing.${local.d}"
    shop    = "https://{slug}.shop.${local.d}"
    seller  = "https://{slug}.seller.${local.d}"
    store   = "https://{slug}.${local.d}"
    www     = "https://${local.d}"
    } : {
    # No domain: every app on its own port of the load balancer; no shop subdomains (see the deploy doc).
    api     = "${local.base}:4000"
    admin   = "${local.base}:3000"
    billing = "${local.base}:3001"
    shop    = "${local.base}:3002"
    seller  = "${local.base}:3004"
    store   = "${local.base}:3003"
    www     = local.base
  }

  # Each app's root domain for shop subdomains (NEXT_PUBLIC_ROOT_DOMAIN): <slug>.<root>.
  app_roots = local.domain_mode ? {
    admin   = local.d
    billing = "billing.${local.d}"
    shop    = "shop.${local.d}"
    seller  = "seller.${local.d}"
    store   = local.d
    www     = local.d
  } : { for a in local.apps : a => local.alb }

  root_domain = local.domain_mode ? local.d : local.alb

  cors_origins = local.domain_mode ? [
    "https://${local.d}",
    "https://www.${local.d}",
    "https://admin.${local.d}",
    "https://*.billing.${local.d}",
    "https://*.shop.${local.d}",
    "https://*.seller.${local.d}",
    "https://*.${local.d}",
    ] : [
    local.base,
    "${local.base}:3000",
    "${local.base}:3001",
    "${local.base}:3002",
    "${local.base}:3003",
    "${local.base}:3004",
    "${local.base}:3005",
  ]

  app_public_url     = "BL=${local.urls.billing},EC=${local.urls.shop}"
  billing_public_url = "BL=${local.urls.billing},EC=${local.urls.shop}/billing"

  # ---------------------------------------------------------------- API / worker / migrate environment (plain)
  api_environment = merge(
    {
      NODE_ENV           = "production"
      PORT               = "4000"
      API_PUBLIC_URL     = local.urls.api
      ROOT_DOMAIN        = local.root_domain
      CORS_ORIGINS       = join(",", local.cors_origins)
      WWW_PUBLIC_URL     = local.urls.www
      APP_PUBLIC_URL     = local.app_public_url
      BILLING_PUBLIC_URL = local.billing_public_url
      STORE_PUBLIC_URL   = local.urls.store
      CNAME_TARGET       = local.domain_mode ? "stores.${local.d}" : local.alb
      STORAGE_DRIVER     = "s3"
      S3_REGION          = var.region
      S3_BUCKET          = module.storage.uploads_bucket
      SENTRY_ENVIRONMENT = var.environment
      LOG_LEVEL          = "info"
      READY_TIMEOUT_MS   = "2000"
      JOBS_WORKERS       = "false"
    },
    module.storage.uploads_public_base_url == null ? {} : { PUBLIC_UPLOAD_BASE_URL = module.storage.uploads_public_base_url },
    var.api_environment,
  )

  # ---------------------------------------------------------------- Next apps: build-time (NEXT_PUBLIC_*) arguments
  store_template = local.urls.store
  store_domain   = local.domain_mode ? local.d : "${local.alb}:3003"

  next_build_args = {
    for app in local.apps : app => merge(
      {
        NEXT_PUBLIC_API_URL     = local.urls.api
        NEXT_PUBLIC_ROOT_DOMAIN = local.app_roots[app]
      },
      contains(["admin", "www"], app) ? { NEXT_PUBLIC_APP_URLS = local.app_public_url } : {},
      contains(["billing", "shop", "seller"], app) ? {
        NEXT_PUBLIC_STORE_URL    = local.store_template
        NEXT_PUBLIC_STORE_DOMAIN = local.store_domain
      } : {},
      app == "store" && var.store_default_tenant != "" && !local.domain_mode ? { NEXT_PUBLIC_DEFAULT_TENANT = var.store_default_tenant } : {},
      app == "www" ? {
        NEXT_PUBLIC_SITE_URL    = local.urls.www
        NEXT_PUBLIC_SHOP_DOMAIN = local.domain_mode ? local.d : local.alb
      } : {},
      var.next_public,
    )
  }

  # Runtime (server-side) environment of each Next container.
  next_runtime_env = {
    for app in local.apps : app => merge(
      {
        PORT     = tostring(local.ports[app])
        HOSTNAME = "0.0.0.0"
        # Server-side calls (store/www SSR) to the API. Through the load balancer, which is simple and costs no
        # extra service discovery; production can use ECS Service Connect or an internal ALB instead.
        API_URL = local.urls.api
      },
      app == "store" && var.store_default_tenant != "" ? { DEFAULT_TENANT = var.store_default_tenant } : {},
    )
  }

  # ---------------------------------------------------------------- load balancer targets
  alb_targets = {
    api     = { port = 4000, health_path = "/ready", listener_ports = [4000], hosts = local.domain_mode ? ["api.${local.d}"] : [], priority = 10 }
    admin   = { port = 3000, health_path = "/api/health", listener_ports = [3000], hosts = local.domain_mode ? ["admin.${local.d}"] : [], priority = 20 }
    billing = { port = 3001, health_path = "/api/health", listener_ports = [3001], hosts = local.domain_mode ? ["*.billing.${local.d}"] : [], priority = 30 }
    shop    = { port = 3002, health_path = "/api/health", listener_ports = [3002], hosts = local.domain_mode ? ["*.shop.${local.d}"] : [], priority = 40 }
    seller  = { port = 3004, health_path = "/api/health", listener_ports = [3004], hosts = local.domain_mode ? ["*.seller.${local.d}"] : [], priority = 50 }
    www     = { port = 3005, health_path = "/api/health", listener_ports = [80, 3005], hosts = local.domain_mode ? [local.d, "www.${local.d}"] : [], priority = 60 }
    # Everything else: <shop>.<domain> and verified custom domains.
    store = { port = 3003, health_path = "/api/health", listener_ports = [3003], hosts = [], priority = 100, default = true }
  }

  dns_names = local.domain_mode ? [local.d, "*.${local.d}", "*.billing.${local.d}", "*.shop.${local.d}", "*.seller.${local.d}"] : []
}
