# Two private buckets:
#
# uploads  STORAGE_DRIVER=s3. Browsers PUT to presigned URLs (hence CORS); private files are read via presigned GET
#          URLs; public files (product pictures, logos) through CloudFront with origin access control, since the
#          bucket blocks all public access. Note: the uploads module stores public and private files under the same
#          key prefix (t/<tenant>/...), so CloudFront can read any object whose key someone knows. Keys contain a
#          random UUID, the same exposure model as a public R2 bucket, which the module was written for. Follow-up:
#          put public files under their own prefix and limit the CloudFront origin to it (docs/deploy-aws.md).
# backups  pg_dump output of scripts/ops/backup-db.mjs (db/ prefix). Versioned, so a deleted or overwritten dump can
#          be recovered for 30 days; lifecycle moves old dumps to Standard-IA and expires them as a safety net.

locals {
  buckets = {
    uploads = "${var.name}-uploads"
    backups = "${var.name}-backups"
  }
}

resource "aws_s3_bucket" "this" {
  for_each      = local.buckets
  bucket        = each.value
  force_destroy = var.force_destroy
  tags          = merge(var.tags, { Purpose = each.key })
}

resource "aws_s3_bucket_public_access_block" "this" {
  for_each                = aws_s3_bucket.this
  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_cors_configuration" "uploads" {
  bucket = aws_s3_bucket.this["uploads"].id
  cors_rule {
    allowed_methods = ["PUT", "GET", "HEAD"]
    allowed_origins = var.cors_origins
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  bucket     = aws_s3_bucket.this["uploads"].id
  depends_on = [aws_s3_bucket_versioning.this]

  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  rule {
    id     = "expire-replaced-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
    expiration {
      expired_object_delete_marker = true
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket     = aws_s3_bucket.this["backups"].id
  depends_on = [aws_s3_bucket_versioning.this]

  rule {
    id     = "dumps"
    status = "Enabled"
    filter {
      prefix = var.backup_prefix
    }
    transition {
      days          = var.backup_ia_after_days
      storage_class = "STANDARD_IA"
    }
    expiration {
      days = var.backup_expire_after_days
    }
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# TLS only, on both buckets; uploads also lets CloudFront (this distribution only) read objects.
data "aws_iam_policy_document" "bucket" {
  for_each = aws_s3_bucket.this

  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [each.value.arn, "${each.value.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  dynamic "statement" {
    for_each = each.key == "uploads" && var.uploads_cdn_enabled ? [1] : []
    content {
      sid       = "CloudFrontRead"
      effect    = "Allow"
      actions   = ["s3:GetObject"]
      resources = ["${each.value.arn}/*"]
      principals {
        type        = "Service"
        identifiers = ["cloudfront.amazonaws.com"]
      }
      condition {
        test     = "StringEquals"
        variable = "AWS:SourceArn"
        values   = [aws_cloudfront_distribution.uploads[0].arn]
      }
    }
  }
}

resource "aws_s3_bucket_policy" "this" {
  for_each   = aws_s3_bucket.this
  bucket     = each.value.id
  policy     = data.aws_iam_policy_document.bucket[each.key].json
  depends_on = [aws_s3_bucket_public_access_block.this]
}

# ---------------------------------------------------------------- CloudFront for public uploads

resource "aws_cloudfront_origin_access_control" "uploads" {
  count                             = var.uploads_cdn_enabled ? 1 : 0
  name                              = "${var.name}-uploads"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_response_headers_policy" "cors" {
  name = "Managed-SimpleCORS"
}

resource "aws_cloudfront_distribution" "uploads" {
  count           = var.uploads_cdn_enabled ? 1 : 0
  enabled         = true
  comment         = "${var.name} public uploads"
  price_class     = var.uploads_cdn_price_class
  is_ipv6_enabled = true
  http_version    = "http2and3"

  origin {
    origin_id                = "uploads"
    domain_name              = aws_s3_bucket.this["uploads"].bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.uploads[0].id
  }

  default_cache_behavior {
    target_origin_id           = "uploads"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.cors.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = var.tags
}
