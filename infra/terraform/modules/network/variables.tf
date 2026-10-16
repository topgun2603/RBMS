variable "name" {
  description = "Name prefix, e.g. srikit-staging."
  type        = string
}

variable "cidr" {
  description = "VPC CIDR. /16 leaves room for more subnets later."
  type        = string
  default     = "10.40.0.0/16"
}

variable "az_count" {
  description = "Availability zones (RDS and the ALB need at least 2)."
  type        = number
  default     = 2
  validation {
    condition     = var.az_count >= 2 && var.az_count <= 3
    error_message = "Use 2 or 3 availability zones."
  }
}

variable "tags" {
  type    = map(string)
  default = {}
}
