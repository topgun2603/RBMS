output "primary_endpoint" {
  value = aws_elasticache_replication_group.this.primary_endpoint_address
}

output "redis_url" {
  description = "rediss://:<auth token>@<primary endpoint>:6379"
  value       = "rediss://:${random_password.auth.result}@${aws_elasticache_replication_group.this.primary_endpoint_address}:6379"
  sensitive   = true
}

output "security_group_id" {
  value = aws_security_group.redis.id
}

output "replication_group_id" {
  value = aws_elasticache_replication_group.this.id
}

output "member_clusters" {
  description = "Node ids (CloudWatch CacheClusterId dimension)."
  value       = aws_elasticache_replication_group.this.member_clusters
}
