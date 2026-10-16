# Every secret API variable is an SSM SecureString parameter under /<project>/<env>/ (standard tier: free; encrypted
# with the account's aws/ssm key). ECS injects them as environment variables at task start, so they never appear
# in task definitions, images or logs. Generated values and the database/Redis URLs are in the Terraform state:
# keep it in the encrypted, private state bucket.

resource "random_password" "app_secret" {
  length  = 64
  special = false
}

resource "random_password" "chat_stream_secret" {
  length  = 48
  special = false
}

resource "random_password" "whatsapp_secret_key" {
  length  = 48
  special = false
}

resource "random_password" "metrics_token" {
  length  = 40
  special = false
}

locals {
  generated_secrets = {
    DATABASE_URL        = module.database.database_url
    REDIS_URL           = module.cache.redis_url
    APP_SECRET          = random_password.app_secret.result
    CHAT_STREAM_SECRET  = random_password.chat_stream_secret.result
    WHATSAPP_SECRET_KEY = random_password.whatsapp_secret_key.result
    METRICS_TOKEN       = random_password.metrics_token.result
  }
}

resource "aws_ssm_parameter" "generated" {
  for_each    = nonsensitive(toset(keys(local.generated_secrets)))
  name        = "${local.ssm_prefix}/${each.key}"
  description = "${each.key} for ${local.name} (Terraform-managed)"
  type        = "SecureString"
  value       = local.generated_secrets[each.key]
}

# Provider credentials: created with a placeholder; set the real value outside Terraform:
#   aws ssm put-parameter --name /srikit/staging/RESEND_API_KEY --type SecureString --overwrite --value 're_...'
resource "aws_ssm_parameter" "provider" {
  for_each    = toset(var.provider_secrets)
  name        = "${local.ssm_prefix}/${each.key}"
  description = "${each.key} for ${local.name} (value set by hand)"
  type        = "SecureString"
  value       = "CHANGE_ME"

  lifecycle {
    ignore_changes = [value]
  }
}

locals {
  # Env var name => parameter ARN, for the task definitions.
  api_secrets = merge(
    { for k, p in aws_ssm_parameter.generated : k => p.arn },
    { for k, p in aws_ssm_parameter.provider : k => p.arn },
  )
}
