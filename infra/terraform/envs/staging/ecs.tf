# ECS: one cluster; services for the API (+ worker sidecar), an optional separate worker, and the Next apps in
# `web_groups`; task definitions for the one-off migrate/seed task and the nightly backup; the backup schedule; and
# the deploy configuration parameter the GitHub workflow reads.

resource "aws_ecs_cluster" "this" {
  name = local.name

  setting {
    name  = "containerInsights"
    value = "disabled" # about $3-10/month extra; CloudWatch alarms below cover staging
  }

  tags = local.tags
}

resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name       = aws_ecs_cluster.this.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = var.use_spot ? "FARGATE_SPOT" : "FARGATE"
    weight            = 1
  }
}

locals {
  image = { for k, url in module.ecr.repository_urls : k => "${url}:${var.image_tag}" }

  # API container (also the base of the worker, migrate and seed containers).
  api_container = {
    image       = local.image["api"]
    port        = 4000
    environment = local.api_environment
    secrets     = local.api_secrets
    health_path = "/health"
  }

  api_containers = merge(
    { api = merge(local.api_container, { memory_reservation = var.worker_mode == "sidecar" ? 768 : null }) },
    var.worker_mode == "sidecar" ? {
      # Same image, same task: runs the BullMQ workers and the cron schedules. Listens on 4001 (only for its own
      # health check) because the task's containers share one network namespace.
      worker = merge(local.api_container, {
        port               = 4001
        environment        = merge(local.api_environment, { JOBS_WORKERS = "true", PORT = "4001" })
        memory_reservation = 768
      })
    } : {},
  )

  web_size = { for g, _ in var.web_groups : g => lookup(var.task_sizes, g, { cpu = 256, memory = 512 }) }

  service_names = concat(
    [module.api.service_name],
    var.worker_mode == "service" ? [module.worker[0].service_name] : [],
    [for g, m in module.web : m.service_name],
  )
}

module "api" {
  source                 = "../../modules/ecs-service"
  name                   = "${local.name}-api"
  cluster_arn            = aws_ecs_cluster.this.arn
  cpu                    = var.task_sizes["api"].cpu
  memory                 = var.task_sizes["api"].memory
  cpu_architecture       = var.cpu_architecture
  containers             = local.api_containers
  target_groups          = { api = module.alb.target_group_arns["api"] }
  subnet_ids             = module.network.public_subnet_ids
  security_group_ids     = [aws_security_group.api.id]
  execution_role_arn     = aws_iam_role.execution.arn
  task_role_arn          = aws_iam_role.api_task.arn
  desired_count          = var.desired_count
  use_spot               = var.use_spot
  enable_execute_command = var.enable_execute_command
  log_retention_days     = var.log_retention_days
  tags                   = local.tags
}

module "worker" {
  count              = var.worker_mode == "service" ? 1 : 0
  source             = "../../modules/ecs-service"
  name               = "${local.name}-worker"
  cluster_arn        = aws_ecs_cluster.this.arn
  cpu                = var.task_sizes["worker"].cpu
  memory             = var.task_sizes["worker"].memory
  cpu_architecture   = var.cpu_architecture
  containers         = { worker = merge(local.api_container, { environment = merge(local.api_environment, { JOBS_WORKERS = "true" }) }) }
  subnet_ids         = module.network.public_subnet_ids
  security_group_ids = [aws_security_group.jobs.id]
  execution_role_arn = aws_iam_role.execution.arn
  task_role_arn      = aws_iam_role.api_task.arn
  desired_count      = var.desired_count
  # Jobs are retried on another task if Spot reclaims this one (BullMQ stalled-job recovery).
  use_spot               = var.use_spot
  enable_execute_command = var.enable_execute_command
  log_retention_days     = var.log_retention_days
  tags                   = local.tags
}

module "web" {
  for_each         = var.web_groups
  source           = "../../modules/ecs-service"
  name             = "${local.name}-${each.key}"
  cluster_arn      = aws_ecs_cluster.this.arn
  cpu              = local.web_size[each.key].cpu
  memory           = local.web_size[each.key].memory
  cpu_architecture = var.cpu_architecture
  containers = {
    for app in each.value : app => {
      image       = local.image[app]
      port        = local.ports[app]
      environment = local.next_runtime_env[app]
      health_path = "/api/health"
    }
  }
  target_groups          = { for app in each.value : app => module.alb.target_group_arns[app] }
  subnet_ids             = module.network.public_subnet_ids
  security_group_ids     = [aws_security_group.web.id]
  execution_role_arn     = aws_iam_role.execution.arn
  task_role_arn          = var.enable_execute_command ? aws_iam_role.web_task[0].arn : null
  desired_count          = var.desired_count
  use_spot               = var.use_spot
  enable_execute_command = var.enable_execute_command
  log_retention_days     = var.log_retention_days
  tags                   = local.tags
}

# ---------------------------------------------------------------- one-off: migrations (and seed via an override)

# Runs `node dist/migrate.mjs` from the `:migrate` tag, which the deploy workflow moves to the new API image before
# the services are updated. The same task with a command override runs the seed:
#   aws ecs run-task ... --overrides '{"containerOverrides":[{"name":"migrate","command":["node","dist/seed.mjs"]}]}'
module "migrate" {
  source           = "../../modules/ecs-service"
  name             = "${local.name}-migrate"
  create_service   = false
  cluster_arn      = aws_ecs_cluster.this.arn
  cpu              = var.task_sizes["migrate"].cpu
  memory           = var.task_sizes["migrate"].memory
  cpu_architecture = var.cpu_architecture
  containers = {
    migrate = merge(local.api_container, {
      image       = "${module.ecr.repository_urls["api"]}:migrate"
      port        = null
      health_path = null
      command     = ["node", "dist/migrate.mjs"]
    })
  }
  subnet_ids         = module.network.public_subnet_ids
  security_group_ids = [aws_security_group.jobs.id]
  execution_role_arn = aws_iam_role.execution.arn
  task_role_arn      = aws_iam_role.api_task.arn
  log_retention_days = var.log_retention_days
  tags               = local.tags
}

# ---------------------------------------------------------------- nightly pg_dump to S3

module "backup" {
  source           = "../../modules/ecs-service"
  name             = "${local.name}-backup"
  create_service   = false
  cluster_arn      = aws_ecs_cluster.this.arn
  cpu              = var.task_sizes["backup"].cpu
  memory           = var.task_sizes["backup"].memory
  cpu_architecture = var.cpu_architecture
  containers = {
    backup = {
      image   = local.image["api"]
      command = ["node", "/app/scripts/ops/backup-db.mjs", "--local"]
      environment = {
        BACKUP_S3_BUCKET    = module.storage.backups_bucket
        BACKUP_S3_PREFIX    = "db/"
        BACKUP_S3_REGION    = var.region
        BACKUP_KEEP_DAILY   = "7"
        BACKUP_KEEP_MONTHLY = "12"
      }
      secrets = { DATABASE_URL = aws_ssm_parameter.generated["DATABASE_URL"].arn }
    }
  }
  subnet_ids         = module.network.public_subnet_ids
  security_group_ids = [aws_security_group.jobs.id]
  execution_role_arn = aws_iam_role.execution.arn
  task_role_arn      = aws_iam_role.backup_task.arn
  log_retention_days = 30
  tags               = local.tags
}

resource "aws_scheduler_schedule" "backup" {
  name                         = "${local.name}-backup"
  description                  = "Nightly pg_dump of RDS to s3://${module.storage.backups_bucket}/db/ (docs/ops.md)"
  schedule_expression          = var.backup_schedule
  schedule_expression_timezone = "Asia/Kolkata"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_ecs_cluster.this.arn
    role_arn = aws_iam_role.scheduler.arn

    ecs_parameters {
      # Terraform owns every revision of this family (the image is a moving tag), so this is always the latest.
      task_definition_arn = module.backup.task_definition_arn
      launch_type         = "FARGATE"
      task_count          = 1

      network_configuration {
        subnets          = module.network.public_subnet_ids
        security_groups  = [aws_security_group.jobs.id]
        assign_public_ip = true
      }
    }

    retry_policy {
      maximum_retry_attempts       = 2
      maximum_event_age_in_seconds = 3600
    }
  }
}

# ---------------------------------------------------------------- what the deploy workflow needs

resource "aws_ssm_parameter" "deploy_config" {
  name        = "${local.ssm_prefix}/deploy/config"
  description = "Read by .github/workflows/deploy.yml: where to push and what to update."
  type        = "String"
  tier        = "Standard"
  value = jsonencode({
    region         = var.region
    cluster        = aws_ecs_cluster.this.name
    registry       = module.ecr.registry
    repositories   = module.ecr.repository_urls
    image_tag      = var.image_tag
    services       = local.service_names
    migrate_family = module.migrate.family
    migrate_log    = module.migrate.log_group_name
    subnets        = module.network.public_subnet_ids
    security_group = aws_security_group.jobs.id
    platform       = var.cpu_architecture == "ARM64" ? "linux/arm64" : "linux/amd64"
    build_args     = local.next_build_args
    urls           = local.urls
  })
}

# ---------------------------------------------------------------- configuration checks (warnings, not errors)

check "kyc_provider" {
  assert {
    condition     = contains(keys(local.api_environment), "KYC_BASE_URL") && contains(var.provider_secrets, "KYC_TOKEN")
    error_message = "The API refuses to start with NODE_ENV=production unless KYC_BASE_URL (api_environment) and KYC_TOKEN (provider_secrets) are set; the mock KYC provider is development-only. See docs/deploy-aws.md."
  }
}

check "razorpay_all_or_none" {
  assert {
    condition     = contains([0, 3], length(setintersection(toset(var.provider_secrets), toset(["PLATFORM_RAZORPAY_KEY_ID", "PLATFORM_RAZORPAY_KEY_SECRET", "PLATFORM_RAZORPAY_WEBHOOK_SECRET"]))))
    error_message = "Set all three PLATFORM_RAZORPAY_* secrets or none (the API rejects a partial set at boot)."
  }
}
