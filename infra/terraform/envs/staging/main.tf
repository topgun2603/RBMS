# Staging: one VPC (2 AZs, no NAT), an ALB, ECS Fargate (API + worker, two web tasks), RDS PostgreSQL 17,
# ElastiCache, S3 (uploads + backups), SSM parameters for secrets, CloudWatch alarms. docs/deploy-aws.md walks
# through the first apply.

data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

module "network" {
  source = "../../modules/network"
  name   = local.name
  tags   = local.tags
}

module "ecr" {
  source       = "../../modules/ecr"
  name         = local.name
  repositories = concat(["api"], local.apps)
  tags         = local.tags
}

# ---------------------------------------------------------------- DNS (domain mode)

resource "aws_route53_zone" "this" {
  count   = local.domain_mode && var.create_route53_zone ? 1 : 0
  name    = var.domain
  comment = "${local.name}: point the registrar's name servers here"
}

locals {
  zone_id = local.domain_mode ? (var.create_route53_zone ? aws_route53_zone.this[0].zone_id : var.route53_zone_id) : ""
}

# ---------------------------------------------------------------- load balancer

module "alb" {
  source            = "../../modules/alb"
  name              = local.name
  vpc_id            = module.network.vpc_id
  public_subnet_ids = module.network.public_subnet_ids
  allowed_cidrs     = var.allowed_cidrs
  domain            = var.domain
  certificate_names = local.dns_names
  route53_zone_id   = local.zone_id
  alias_records     = local.dns_names
  targets           = local.alb_targets
  tags              = local.tags
}

# ---------------------------------------------------------------- task security groups

# API (and the worker sidecar): only the load balancer may connect, on 4000.
resource "aws_security_group" "api" {
  name        = "${local.name}-api"
  description = "API tasks"
  vpc_id      = module.network.vpc_id
  tags        = merge(local.tags, { Name = "${local.name}-api" })
}

resource "aws_vpc_security_group_ingress_rule" "api_from_alb" {
  security_group_id            = aws_security_group.api.id
  referenced_security_group_id = module.alb.security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 4000
  to_port                      = 4000
  description                  = "from the load balancer"
}

# Next apps: only the load balancer, on the app ports.
resource "aws_security_group" "web" {
  name        = "${local.name}-web"
  description = "Next.js app tasks"
  vpc_id      = module.network.vpc_id
  tags        = merge(local.tags, { Name = "${local.name}-web" })
}

resource "aws_vpc_security_group_ingress_rule" "web_from_alb" {
  security_group_id            = aws_security_group.web.id
  referenced_security_group_id = module.alb.security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3005
  description                  = "from the load balancer"
}

# Worker service, migrate, seed and backup tasks: no inbound traffic at all.
resource "aws_security_group" "jobs" {
  name        = "${local.name}-jobs"
  description = "Worker and one-off tasks (no inbound)"
  vpc_id      = module.network.vpc_id
  tags        = merge(local.tags, { Name = "${local.name}-jobs" })
}

# Egress: tasks need the internet (ECR, SSM, CloudWatch Logs, S3, the providers) and the VPC (RDS, Redis).
resource "aws_vpc_security_group_egress_rule" "all" {
  for_each          = { api = aws_security_group.api.id, web = aws_security_group.web.id, jobs = aws_security_group.jobs.id }
  security_group_id = each.value
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
  description       = "all outbound"
}

# ---------------------------------------------------------------- data stores

module "database" {
  source                    = "../../modules/database"
  name                      = local.name
  vpc_id                    = module.network.vpc_id
  subnet_ids                = module.network.private_subnet_ids
  client_security_group_ids = [aws_security_group.api.id, aws_security_group.jobs.id]
  instance_class            = var.db_instance_class
  allocated_storage         = var.db_allocated_storage
  multi_az                  = var.db_multi_az
  deletion_protection       = var.db_deletion_protection
  tags                      = local.tags
}

module "cache" {
  source                    = "../../modules/cache"
  name                      = local.name
  vpc_id                    = module.network.vpc_id
  subnet_ids                = module.network.private_subnet_ids
  client_security_group_ids = [aws_security_group.api.id, aws_security_group.jobs.id]
  engine                    = var.redis_engine
  node_type                 = var.redis_node_type
  tags                      = local.tags
}

module "storage" {
  source              = "../../modules/storage"
  name                = "${local.name}-${data.aws_caller_identity.current.account_id}"
  cors_origins        = local.cors_origins
  uploads_cdn_enabled = var.uploads_cdn_enabled
  tags                = local.tags
}

# ---------------------------------------------------------------- alarms

module "monitoring" {
  source                    = "../../modules/monitoring"
  name                      = local.name
  alarm_emails              = var.alarm_emails
  alb_arn_suffix            = module.alb.arn_suffix
  target_group_arn_suffixes = module.alb.target_group_arn_suffixes
  db_identifier             = module.database.identifier
  db_allocated_storage_gib  = var.db_allocated_storage
  cache_cluster_ids         = module.cache.member_clusters
  api_log_group_names       = compact([module.api.log_group_name, var.worker_mode == "service" ? module.worker[0].log_group_name : ""])
  ecs_cluster_arn           = aws_ecs_cluster.this.arn
  watched_task_families     = [module.migrate.family, module.backup.family]
  tags                      = local.tags
}

# ---------------------------------------------------------------- GitHub Actions deploy role (OIDC)

module "github_oidc" {
  count                = var.github_repository == "" ? 0 : 1
  source               = "../../modules/github-oidc"
  name                 = local.name
  create_provider      = var.create_github_oidc_provider
  github_repository    = var.github_repository
  github_environment   = var.environment
  ecr_repository_arns  = module.ecr.repository_arns
  ecs_cluster_arn      = aws_ecs_cluster.this.arn
  ecs_service_names    = local.service_names
  run_task_family_arns = [module.migrate.task_definition_family_arn]
  pass_role_arns = compact([
    aws_iam_role.execution.arn,
    aws_iam_role.api_task.arn,
  ])
  config_parameter_arn = aws_ssm_parameter.deploy_config.arn
  log_group_arns       = [for g in [module.migrate.log_group_name] : "arn:${data.aws_partition.current.partition}:logs:${var.region}:${data.aws_caller_identity.current.account_id}:log-group:${g}"]
  tags                 = local.tags
}
