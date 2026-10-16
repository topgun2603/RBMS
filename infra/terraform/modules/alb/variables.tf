variable "name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "allowed_cidrs" {
  description = "Who may reach the load balancer. Narrow it (office/VPN IPs) to keep a staging site private."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "domain" {
  description = "Root domain (e.g. srikit.in). Empty = no-domain mode: plain HTTP, one listener port per app on the ALB DNS name."
  type        = string
  default     = ""
}

variable "certificate_names" {
  description = "Domain mode: names on the ACM certificate (the first is the primary)."
  type        = list(string)
  default     = []
}

variable "route53_zone_id" {
  description = "Domain mode: hosted zone for certificate validation and the alias records."
  type        = string
  default     = ""
}

variable "alias_records" {
  description = "Domain mode: record names that point at the load balancer (A + AAAA aliases)."
  type        = list(string)
  default     = []
}

variable "targets" {
  description = <<-EOT
    One target group per app. `port` is the container port; `health_path` the target health check;
    `listener_ports` the ALB ports in no-domain mode; `hosts` + `priority` the host-header rule in domain mode;
    `default` = the target of requests no host rule matches (the store: shop subdomains and custom domains).
  EOT
  type = map(object({
    port           = number
    health_path    = string
    listener_ports = list(number)
    hosts          = list(string)
    priority       = number
    default        = optional(bool, false)
  }))
}

variable "idle_timeout" {
  description = "Seconds. Long enough for the chat / live-inbox event streams between heartbeats."
  type        = number
  default     = 300
}

variable "deregistration_delay" {
  description = "Seconds a draining task keeps receiving in-flight requests. Short for staging (fast deploys)."
  type        = number
  default     = 30
}

variable "deletion_protection" {
  type    = bool
  default = false
}

variable "tags" {
  type    = map(string)
  default = {}
}
