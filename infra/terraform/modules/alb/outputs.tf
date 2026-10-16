output "dns_name" {
  value = aws_lb.this.dns_name
}

output "arn_suffix" {
  description = "CloudWatch LoadBalancer dimension."
  value       = aws_lb.this.arn_suffix
}

output "security_group_id" {
  value = aws_security_group.alb.id
}

output "target_group_arns" {
  value = { for k, tg in aws_lb_target_group.this : k => tg.arn }
}

output "target_group_arn_suffixes" {
  description = "CloudWatch TargetGroup dimension."
  value       = { for k, tg in aws_lb_target_group.this : k => tg.arn_suffix }
}

output "certificate_arn" {
  value = var.domain != "" ? aws_acm_certificate.this[0].arn : null
}
