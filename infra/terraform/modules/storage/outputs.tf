output "uploads_bucket" {
  value = aws_s3_bucket.this["uploads"].id
}

output "uploads_bucket_arn" {
  value = aws_s3_bucket.this["uploads"].arn
}

output "backups_bucket" {
  value = aws_s3_bucket.this["backups"].id
}

output "backups_bucket_arn" {
  value = aws_s3_bucket.this["backups"].arn
}

output "uploads_public_base_url" {
  description = "PUBLIC_UPLOAD_BASE_URL: the CloudFront URL, or null without the CDN."
  value       = var.uploads_cdn_enabled ? "https://${aws_cloudfront_distribution.uploads[0].domain_name}" : null
}
