variable "name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "client_security_group_ids" {
  type = list(string)
}

variable "engine" {
  description = "redis (Redis OSS 7) or valkey (Redis-compatible, about 20% cheaper per node)."
  type        = string
  default     = "redis"
  validation {
    condition     = contains(["redis", "valkey"], var.engine)
    error_message = "The engine must be redis or valkey."
  }
}

variable "engine_version" {
  description = "Default: 7.1 for redis, 8.0 for valkey."
  type        = string
  default     = null
}

variable "node_type" {
  type    = string
  default = "cache.t4g.micro"
}

variable "replicas" {
  description = "Replicas (0 = one node, no failover). Production: 1 or more, with automatic failover."
  type        = number
  default     = 0
}

variable "snapshot_retention_days" {
  description = "Daily snapshots. Queue contents are transient, so 0 or 1 is enough."
  type        = number
  default     = 1
}

variable "tags" {
  type    = map(string)
  default = {}
}
