# ElastiCache for BullMQ, the readiness probe and the chat/live pub-sub. TLS in transit plus an AUTH token, so
# REDIS_URL is rediss://:<token>@host:6379 and lives in a SecureString parameter. maxmemory-policy must be
# noeviction: BullMQ warns about (and can lose jobs on) a Redis that evicts keys.

locals {
  version = coalesce(var.engine_version, var.engine == "valkey" ? "8.0" : "7.1")
  family  = "${var.engine}${split(".", local.version)[0]}"
}

resource "random_password" "auth" {
  length  = 48
  special = false
}

resource "aws_elasticache_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.subnet_ids
  tags       = var.tags
}

resource "aws_security_group" "redis" {
  name        = "${var.name}-redis"
  description = "Redis from the app tasks"
  vpc_id      = var.vpc_id
  tags        = merge(var.tags, { Name = "${var.name}-redis" })
}

resource "aws_vpc_security_group_ingress_rule" "redis" {
  count                        = length(var.client_security_group_ids)
  security_group_id            = aws_security_group.redis.id
  referenced_security_group_id = var.client_security_group_ids[count.index]
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
  description                  = "redis from app tasks"
}

resource "aws_elasticache_parameter_group" "this" {
  name   = "${var.name}-${local.family}"
  family = local.family

  parameter {
    name  = "maxmemory-policy"
    value = "noeviction"
  }

  tags = var.tags
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id = var.name
  description          = "${var.name} jobs and pub-sub"
  engine               = var.engine
  engine_version       = local.version
  node_type            = var.node_type
  port                 = 6379

  num_cache_clusters         = 1 + var.replicas
  automatic_failover_enabled = var.replicas > 0
  multi_az_enabled           = var.replicas > 0

  subnet_group_name    = aws_elasticache_subnet_group.this.name
  security_group_ids   = [aws_security_group.redis.id]
  parameter_group_name = aws_elasticache_parameter_group.this.name

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.auth.result

  snapshot_retention_limit   = var.snapshot_retention_days
  snapshot_window            = "18:00-19:00"
  maintenance_window         = "sun:22:00-sun:23:00"
  auto_minor_version_upgrade = true
  apply_immediately          = true

  tags = var.tags
}
