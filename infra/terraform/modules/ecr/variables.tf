variable "name" {
  description = "Repository name prefix, e.g. srikit-staging (repos become srikit-staging/api, srikit-staging/www, ...)."
  type        = string
}

variable "repositories" {
  description = "Repository suffixes."
  type        = list(string)
}

variable "keep_images" {
  description = "How many sha-tagged images to keep per repository."
  type        = number
  default     = 20
}

variable "tags" {
  type    = map(string)
  default = {}
}
