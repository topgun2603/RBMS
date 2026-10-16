variable "name" {
  description = "Service and task family name, e.g. srikit-staging-console."
  type        = string
}

variable "cluster_arn" {
  type = string
}

variable "create_service" {
  description = "false = task definition only (one-off and scheduled tasks: migrate, backup)."
  type        = bool
  default     = true
}

variable "cpu" {
  description = "Task CPU units (256 = 0.25 vCPU)."
  type        = number
}

variable "memory" {
  description = "Task memory in MiB."
  type        = number
}

variable "cpu_architecture" {
  description = "X86_64, or ARM64 (Graviton, about 20% cheaper; build the images for linux/arm64)."
  type        = string
  default     = "X86_64"
}

variable "containers" {
  description = <<-EOT
    Containers of the task, by name. All share the task's network namespace, so ports must differ.
    `secrets` maps an env var name to an SSM parameter (or Secrets Manager) ARN; ECS injects the value at start.
    `health_path` adds a container health check (wget on 127.0.0.1:<port><path>).
  EOT
  type = map(object({
    image              = string
    port               = optional(number)
    command            = optional(list(string))
    environment        = optional(map(string), {})
    secrets            = optional(map(string), {})
    health_path        = optional(string)
    memory_reservation = optional(number)
  }))
}

variable "target_groups" {
  description = "Container name => target group ARN (at most 5 per service: an ECS limit)."
  type        = map(string)
  default     = {}
}

variable "subnet_ids" {
  type = list(string)
}

variable "security_group_ids" {
  type = list(string)
}

variable "assign_public_ip" {
  description = "Public subnets without a NAT gateway need a public IP for egress (ECR, SSM, providers)."
  type        = bool
  default     = true
}

variable "execution_role_arn" {
  type = string
}

variable "task_role_arn" {
  type    = string
  default = null
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "use_spot" {
  description = "Run on FARGATE_SPOT (about 70% cheaper, can be interrupted with 2 minutes' notice; ECS replaces the task)."
  type        = bool
  default     = false
}

variable "enable_execute_command" {
  description = "ECS Exec (aws ecs execute-command) for debugging; the task role needs the ssmmessages permissions."
  type        = bool
  default     = false
}

variable "health_check_grace_period" {
  type    = number
  default = 90
}

variable "log_retention_days" {
  type    = number
  default = 14
}

variable "tags" {
  type    = map(string)
  default = {}
}
