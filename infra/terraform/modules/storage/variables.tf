variable "name" {
  description = "Bucket name prefix; must be globally unique, e.g. srikit-staging-<account id>."
  type        = string
}

variable "cors_origins" {
  description = "Browser origins that PUT files with the presigned upload URLs (the app origins)."
  type        = list(string)
}

variable "uploads_cdn_enabled" {
  description = "CloudFront (origin access control) in front of the private uploads bucket, for public files (PUBLIC_UPLOAD_BASE_URL)."
  type        = bool
  default     = true
}

variable "uploads_cdn_price_class" {
  description = "PriceClass_200 includes the India edge locations."
  type        = string
  default     = "PriceClass_200"
}

variable "backup_prefix" {
  type    = string
  default = "db/"
}

variable "backup_ia_after_days" {
  description = "Move dumps to Standard-IA after this many days (the monthly ones that the retention keeps)."
  type        = number
  default     = 30
}

variable "backup_expire_after_days" {
  description = "Safety net behind the script's own retention (7 daily + 12 monthly): delete dumps older than this."
  type        = number
  default     = 400
}

variable "force_destroy" {
  description = "Allow terraform destroy to delete non-empty buckets. Keep false outside throwaway environments."
  type        = bool
  default     = false
}

variable "tags" {
  type    = map(string)
  default = {}
}
