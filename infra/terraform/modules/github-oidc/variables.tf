variable "name" {
  type = string
}

variable "create_provider" {
  description = "Create the account's GitHub OIDC provider. Set false when the account already has one (only one per URL)."
  type        = bool
  default     = true
}

variable "github_repository" {
  description = "owner/repo allowed to assume the role."
  type        = string
}

variable "github_environment" {
  description = "Only workflow jobs running in this GitHub environment can assume the role (protect it with reviewers)."
  type        = string
  default     = "staging"
}

variable "ecr_repository_arns" {
  type = list(string)
}

variable "ecs_cluster_arn" {
  type = string
}

variable "ecs_service_names" {
  type = list(string)
}

variable "run_task_family_arns" {
  description = "Task families the workflow may run (the migrate task), ARNs without revision."
  type        = list(string)
}

variable "pass_role_arns" {
  description = "Execution and task roles that run-task passes to ECS."
  type        = list(string)
}

variable "config_parameter_arn" {
  description = "The SSM parameter with the deploy configuration (cluster, services, subnets, build args)."
  type        = string
}

variable "log_group_arns" {
  description = "Log groups the workflow may read (migration output)."
  type        = list(string)
  default     = []
}

variable "tags" {
  type    = map(string)
  default = {}
}
