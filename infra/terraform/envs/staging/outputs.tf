output "load_balancer_dns" {
  description = "The ALB's AWS name. No-domain mode: the apps are on its ports (see urls)."
  value       = module.alb.dns_name
}

output "urls" {
  description = "Where each app is. {slug} = a shop's subdomain (domain mode)."
  value       = local.urls
}

output "route53_name_servers" {
  description = "Domain mode with create_route53_zone: set these as the domain's name servers at the registrar."
  value       = local.domain_mode && var.create_route53_zone ? aws_route53_zone.this[0].name_servers : []
}

output "ecr_repositories" {
  value = module.ecr.repository_urls
}

output "ecs_cluster" {
  value = aws_ecs_cluster.this.name
}

output "ecs_services" {
  value = local.service_names
}

output "migrate_task_family" {
  value = module.migrate.family
}

output "run_task_network" {
  description = "--network-configuration for aws ecs run-task (migrate, seed)."
  value       = "awsvpcConfiguration={subnets=[${join(",", module.network.public_subnet_ids)}],securityGroups=[${aws_security_group.jobs.id}],assignPublicIp=ENABLED}"
}

output "ssm_prefix" {
  description = "Secret parameters live under this path."
  value       = local.ssm_prefix
}

output "deploy_config_parameter" {
  value = aws_ssm_parameter.deploy_config.name
}

output "github_deploy_role_arn" {
  value = var.github_repository == "" ? null : module.github_oidc[0].role_arn
}

output "next_build_args" {
  description = "NEXT_PUBLIC_* build arguments per app (also in the deploy config parameter)."
  value       = local.next_build_args
}

output "database_endpoint" {
  value = module.database.address
}

output "redis_endpoint" {
  value = module.cache.primary_endpoint
}

output "uploads_bucket" {
  value = module.storage.uploads_bucket
}

output "backups_bucket" {
  value = module.storage.backups_bucket
}

output "uploads_cdn_url" {
  value = module.storage.uploads_public_base_url
}

output "alarm_topic_arn" {
  value = module.monitoring.topic_arn
}
