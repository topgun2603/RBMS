variable "name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  description = "Private subnets (at least 2 AZs)."
  type        = list(string)
}

variable "client_security_group_ids" {
  description = "Security groups allowed to connect on 5432 (API, worker, migrate/backup tasks)."
  type        = list(string)
}

variable "engine_version" {
  description = "PostgreSQL major (or major.minor). Must match the pg_dump in the API image (postgresql17-client)."
  type        = string
  default     = "17"
}

variable "instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "allocated_storage" {
  description = "GiB of gp3."
  type        = number
  default     = 20
}

variable "max_allocated_storage" {
  description = "Storage autoscaling ceiling in GiB (0 = off)."
  type        = number
  default     = 50
}

variable "database_name" {
  type    = string
  default = "srikit"
}

variable "username" {
  type    = string
  default = "srikit"
}

variable "multi_az" {
  type    = bool
  default = false
}

variable "backup_retention_days" {
  type    = number
  default = 7
}

variable "deletion_protection" {
  type    = bool
  default = true
}

variable "tags" {
  type    = map(string)
  default = {}
}
