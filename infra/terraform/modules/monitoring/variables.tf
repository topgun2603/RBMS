variable "name" {
  type = string
}

variable "alarm_emails" {
  description = "Subscribed to the alarm topic (each address confirms by email)."
  type        = list(string)
  default     = []
}

variable "alb_arn_suffix" {
  type = string
}

variable "target_group_arn_suffixes" {
  description = "Target key => arn suffix; each gets an unhealthy-hosts alarm."
  type        = map(string)
}

variable "api_target_key" {
  description = "The API's target group (its health check is /ready): no healthy target = readiness failing."
  type        = string
  default     = "api"
}

variable "db_identifier" {
  type = string
}

variable "db_allocated_storage_gib" {
  type = number
}

variable "cache_cluster_ids" {
  type    = list(string)
  default = []
}

variable "api_log_group_names" {
  description = "Log groups of the API/worker containers (pino JSON); `error captured` lines are counted."
  type        = list(string)
  default     = []
}

variable "ecs_cluster_arn" {
  type = string
}

variable "watched_task_families" {
  description = "Task families (migrate, backup) whose failed runs (exit code != 0) notify the topic."
  type        = list(string)
  default     = []
}

variable "tags" {
  type    = map(string)
  default = {}
}
