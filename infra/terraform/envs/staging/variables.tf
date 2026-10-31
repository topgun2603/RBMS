# ---------------------------------------------------------------- account and naming

variable "aws_account_id" {
  description = "The AWS account this environment lives in. Terraform refuses any other credentials. Strongly recommended."
  type        = string
  default     = ""
}

variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "project" {
  type    = string
  default = "srikit"
}

variable "environment" {
  type    = string
  default = "staging"
}

# ---------------------------------------------------------------- domain (optional)

variable "domain" {
  description = <<-EOT
    Root domain, e.g. "rbms.in". Empty (default) = no-domain mode: plain HTTP on the load balancer's AWS name, one
    port per app. Set it to switch to HTTPS + host names: <domain> (www), api., admin., <shop>.billing., <shop>.shop.,
    <shop>.seller. and <shop>.<domain> (store).
  EOT
  type        = string
  default     = ""
}

variable "create_route53_zone" {
  description = "Domain mode: create the hosted zone here (then point the registrar's name servers at it, see the outputs)."
  type        = bool
  default     = true
}

variable "route53_zone_id" {
  description = "Domain mode with an existing hosted zone (create_route53_zone = false)."
  type        = string
  default     = ""
}

variable "allowed_cidrs" {
  description = "Who can reach the load balancer. Narrow it to office/VPN addresses to keep staging private."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

# ---------------------------------------------------------------- compute

variable "image_tag" {
  description = "Tag the services run. The deploy workflow moves this tag; rollback = move it back (docs/deploy-aws.md)."
  type        = string
  default     = "staging"
}

variable "desired_count" {
  description = "Tasks per service. 0 for the first apply (before any image is pushed) and to pause staging."
  type        = number
  default     = 1
}

variable "use_spot" {
  description = "Run the services on Fargate Spot (about 70% cheaper; a task can be stopped with 2 minutes' notice and is replaced)."
  type        = bool
  default     = true
}

variable "cpu_architecture" {
  description = "X86_64, or ARM64 (about 20% cheaper; needs linux/arm64 images, e.g. built on arm64 runners)."
  type        = string
  default     = "X86_64"
}

variable "worker_mode" {
  description = <<-EOT
    Where the background jobs run: "sidecar" = a second container in the API task (one task, one public IP; staging
    default), "service" = a separate worker service (scales and deploys on its own; production).
  EOT
  type        = string
  default     = "sidecar"
  validation {
    condition     = contains(["sidecar", "service"], var.worker_mode)
    error_message = "worker_mode must be sidecar or service."
  }
}

variable "web_groups" {
  description = <<-EOT
    Next apps per ECS service. Apps in one group run as containers of one task (shared CPU/memory, one public IP,
    deployed together). Staging: two groups. Production: one app per group. ECS allows 5 target groups per service.
  EOT
  type        = map(list(string))
  default = {
    console = ["admin", "billing", "shop", "seller"]
    sites   = ["store", "www"]
  }
  validation {
    condition = (
      length(flatten(values(var.web_groups))) == 6 &&
      length(distinct(flatten(values(var.web_groups)))) == 6 &&
      length(setsubtract(toset(flatten(values(var.web_groups))), toset(["admin", "billing", "shop", "store", "seller", "www"]))) == 0 &&
      alltrue([for apps in values(var.web_groups) : length(apps) >= 1 && length(apps) <= 5])
    )
    error_message = "Every app (admin, billing, shop, store, seller, www) must be in exactly one group, at most 5 per group."
  }
}

variable "task_sizes" {
  description = "Fargate CPU units / MiB per task (api, worker, each web group, migrate, backup). Missing web groups get 256/512."
  type = map(object({
    cpu    = number
    memory = number
  }))
  default = {
    api     = { cpu = 512, memory = 2048 } # api + worker sidecar, each with Chromium for PDFs
    worker  = { cpu = 256, memory = 1024 } # worker_mode = "service"
    console = { cpu = 256, memory = 2048 } # four Next servers, mostly client-rendered
    sites   = { cpu = 256, memory = 1024 } # store + www
    migrate = { cpu = 256, memory = 1024 }
    backup  = { cpu = 256, memory = 512 }
  }
}

variable "enable_execute_command" {
  description = "ECS Exec into running tasks (debugging, psql from inside the VPC)."
  type        = bool
  default     = true
}

variable "log_retention_days" {
  type    = number
  default = 14
}

# ---------------------------------------------------------------- data stores

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_allocated_storage" {
  type    = number
  default = 20
}

variable "db_multi_az" {
  type    = bool
  default = false
}

variable "db_deletion_protection" {
  type    = bool
  default = true
}

variable "redis_engine" {
  description = "redis (Redis OSS 7.1) or valkey (8.0, Redis-compatible, cheaper)."
  type        = string
  default     = "redis"
}

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.micro"
}

variable "uploads_cdn_enabled" {
  description = "CloudFront in front of the private uploads bucket for public files (product pictures, logos)."
  type        = bool
  default     = true
}

variable "backup_schedule" {
  description = "EventBridge Scheduler expression for the pg_dump task, in Asia/Kolkata time."
  type        = string
  default     = "cron(30 2 * * ? *)"
}

# ---------------------------------------------------------------- application configuration

variable "store_default_tenant" {
  description = "No-domain mode: the shop slug the store shows on the bare load balancer host (e.g. anbu from the demo seed)."
  type        = string
  default     = ""
}

variable "api_environment" {
  description = <<-EOT
    Extra plain (non-secret) API variables, e.g. PLATFORM_LEGAL_NAME, PLATFORM_GSTIN, PLATFORM_ADDRESS, EMAIL_FROM,
    MSG91_SENDER_ID, MSG91_OTP_FLOW_ID, WHATSAPP_PHONE_NUMBER_ID, GOOGLE_CLIENT_ID, KYC_BASE_URL, KYC_PROVIDER_NAME,
    EINVOICE_GSP_BASE_URL, EINVOICE_GSP_CLIENT_ID, SENTRY_ENVIRONMENT. They override the computed ones.
  EOT
  type        = map(string)
  default     = {}
}

variable "provider_secrets" {
  description = <<-EOT
    Secret API variables of the providers you use. Each gets a SecureString parameter /<project>/<env>/<NAME> with
    the placeholder value CHANGE_ME, injected into the API, worker and migrate tasks. Put the real value with
    `aws ssm put-parameter --overwrite` before deploying (Terraform ignores later value changes). Leave a provider
    out to keep its mock/console driver.
  EOT
  type        = list(string)
  default     = []
  validation {
    condition = length(setsubtract(toset(var.provider_secrets), toset([
      "SENTRY_DSN", "MSG91_AUTH_KEY", "RESEND_API_KEY", "WHATSAPP_TOKEN", "FCM_SERVICE_ACCOUNT_JSON", "KYC_TOKEN",
      "EINVOICE_GSP_CLIENT_SECRET", "PLATFORM_RAZORPAY_KEY_ID", "PLATFORM_RAZORPAY_KEY_SECRET",
      "PLATFORM_RAZORPAY_WEBHOOK_SECRET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY",
    ]))) == 0
    error_message = "Unknown secret name. See docs/deploy-aws.md (environment variables)."
  }
}

variable "next_public" {
  description = "Extra NEXT_PUBLIC_* build arguments for every app, e.g. NEXT_PUBLIC_GOOGLE_CLIENT_ID, NEXT_PUBLIC_CONTACT_EMAIL."
  type        = map(string)
  default     = {}
}

# ---------------------------------------------------------------- alerts and CI

variable "alarm_emails" {
  type    = list(string)
  default = []
}

variable "github_repository" {
  description = "owner/repo of the deploy workflow. Empty = no GitHub OIDC role."
  type        = string
  default     = ""
}

variable "create_github_oidc_provider" {
  description = "false when the account already has the token.actions.githubusercontent.com provider."
  type        = bool
  default     = true
}
