output "service_name" {
  value = var.create_service ? aws_ecs_service.this[0].name : null
}

output "task_definition_arn" {
  value = aws_ecs_task_definition.this.arn
}

output "task_definition_family_arn" {
  description = "ARN without the revision: run-task and the scheduler then use the latest revision."
  value       = aws_ecs_task_definition.this.arn_without_revision
}

output "family" {
  value = aws_ecs_task_definition.this.family
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.this.name
}
