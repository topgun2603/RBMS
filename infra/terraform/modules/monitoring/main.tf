# One SNS topic; CloudWatch alarms for the load balancer (5xx, unhealthy targets, the API's /ready), RDS (CPU,
# storage, memory), ElastiCache (memory, CPU), reported errors in the API logs, and an EventBridge rule for failed
# migrate/backup runs. All alarms also notify when they recover.

resource "aws_sns_topic" "alarms" {
  name = "${var.name}-alarms"
  tags = var.tags
}

resource "aws_sns_topic_subscription" "email" {
  for_each  = toset(var.alarm_emails)
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = each.value
}

data "aws_iam_policy_document" "topic" {
  statement {
    sid       = "CloudWatchAndEventBridge"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.alarms.arn]
    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com", "events.amazonaws.com"]
    }
  }
}

resource "aws_sns_topic_policy" "alarms" {
  arn    = aws_sns_topic.alarms.arn
  policy = data.aws_iam_policy_document.topic.json
}

locals {
  actions = [aws_sns_topic.alarms.arn]
}

# ---------------------------------------------------------------- load balancer

resource "aws_cloudwatch_metric_alarm" "target_5xx" {
  alarm_name          = "${var.name}-target-5xx"
  alarm_description   = "Apps/API answered 10+ 5xx responses in 5 minutes. Look up the requestId in the logs (docs/ops.md)."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  dimensions          = { LoadBalancer = var.alb_arn_suffix }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 10
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
  ok_actions          = local.actions
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "elb_5xx" {
  alarm_name          = "${var.name}-alb-5xx"
  alarm_description   = "The load balancer itself answered 10+ 5xx in 5 minutes (502/503/504: no healthy target, timeouts)."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_ELB_5XX_Count"
  dimensions          = { LoadBalancer = var.alb_arn_suffix }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 10
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
  ok_actions          = local.actions
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "unhealthy" {
  for_each            = var.target_group_arn_suffixes
  alarm_name          = "${var.name}-${each.key}-unhealthy"
  alarm_description   = "A ${each.key} target failed its health check for 3 of the last 5 minutes."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "UnHealthyHostCount"
  dimensions          = { LoadBalancer = var.alb_arn_suffix, TargetGroup = each.value }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
  ok_actions          = local.actions
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "api_not_ready" {
  alarm_name          = "${var.name}-api-not-ready"
  alarm_description   = "No API task passes GET /ready (Postgres, Redis or the job queue failing) for 3 minutes. curl /ready shows which."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HealthyHostCount"
  dimensions          = { LoadBalancer = var.alb_arn_suffix, TargetGroup = var.target_group_arn_suffixes[var.api_target_key] }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.actions
  ok_actions          = local.actions
  tags                = var.tags
}

# ---------------------------------------------------------------- RDS

resource "aws_cloudwatch_metric_alarm" "db_cpu" {
  alarm_name          = "${var.name}-db-cpu"
  alarm_description   = "RDS CPU above 80% for 15 minutes (t4g burst credits drain at sustained load)."
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  dimensions          = { DBInstanceIdentifier = var.db_identifier }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = local.actions
  ok_actions          = local.actions
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "db_storage" {
  alarm_name          = "${var.name}-db-storage"
  alarm_description   = "Less than 15% of the RDS storage is free."
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  dimensions          = { DBInstanceIdentifier = var.db_identifier }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 1
  threshold           = floor(var.db_allocated_storage_gib * 0.15 * 1024 * 1024 * 1024)
  comparison_operator = "LessThanThreshold"
  alarm_actions       = local.actions
  ok_actions          = local.actions
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "db_memory" {
  alarm_name          = "${var.name}-db-memory"
  alarm_description   = "RDS freeable memory under 64 MiB for 10 minutes."
  namespace           = "AWS/RDS"
  metric_name         = "FreeableMemory"
  dimensions          = { DBInstanceIdentifier = var.db_identifier }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 64 * 1024 * 1024
  comparison_operator = "LessThanThreshold"
  alarm_actions       = local.actions
  ok_actions          = local.actions
  tags                = var.tags
}

# ---------------------------------------------------------------- ElastiCache

resource "aws_cloudwatch_metric_alarm" "redis_memory" {
  for_each            = toset(var.cache_cluster_ids)
  alarm_name          = "${var.name}-redis-memory-${each.key}"
  alarm_description   = "Redis memory above 80%. With noeviction, a full Redis rejects new jobs."
  namespace           = "AWS/ElastiCache"
  metric_name         = "DatabaseMemoryUsagePercentage"
  dimensions          = { CacheClusterId = each.key }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = local.actions
  ok_actions          = local.actions
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "redis_cpu" {
  for_each            = toset(var.cache_cluster_ids)
  alarm_name          = "${var.name}-redis-cpu-${each.key}"
  alarm_description   = "Redis engine CPU above 80% for 15 minutes."
  namespace           = "AWS/ElastiCache"
  metric_name         = "EngineCPUUtilization"
  dimensions          = { CacheClusterId = each.key }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = local.actions
  ok_actions          = local.actions
  tags                = var.tags
}

# ---------------------------------------------------------------- reported errors in the API logs

resource "aws_cloudwatch_log_metric_filter" "errors" {
  for_each       = toset(var.api_log_group_names)
  name           = "${var.name}-errors-captured"
  log_group_name = each.value
  # The error reporter's line (docs/ops.md): 5xx responses, final job failures, crashes.
  pattern = "{ $.msg = \"error captured*\" }"
  metric_transformation {
    namespace     = "Srikit/${var.name}"
    name          = "ErrorsCaptured"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "errors" {
  count               = length(var.api_log_group_names) > 0 ? 1 : 0
  alarm_name          = "${var.name}-errors-captured"
  alarm_description   = "5+ reported errors (5xx, final job failures) in 5 minutes. Search the logs for 'error captured'."
  namespace           = "Srikit/${var.name}"
  metric_name         = "ErrorsCaptured"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
  ok_actions          = local.actions
  tags                = var.tags
}

# ---------------------------------------------------------------- failed one-off / scheduled tasks

resource "aws_cloudwatch_event_rule" "task_failed" {
  count       = length(var.watched_task_families) > 0 ? 1 : 0
  name        = "${var.name}-task-failed"
  description = "A migrate or backup task stopped with a non-zero exit code."
  event_pattern = jsonencode({
    source        = ["aws.ecs"]
    "detail-type" = ["ECS Task State Change"]
    detail = {
      clusterArn = [var.ecs_cluster_arn]
      lastStatus = ["STOPPED"]
      group      = [for f in var.watched_task_families : "family:${f}"]
      containers = { exitCode = [{ "anything-but" = 0 }] }
    }
  })
  tags = var.tags
}

resource "aws_cloudwatch_event_target" "task_failed" {
  count     = length(var.watched_task_families) > 0 ? 1 : 0
  rule      = aws_cloudwatch_event_rule.task_failed[0].name
  target_id = "sns"
  arn       = aws_sns_topic.alarms.arn
  input_transformer {
    input_paths = {
      group  = "$.detail.group"
      reason = "$.detail.stoppedReason"
      task   = "$.detail.taskArn"
    }
    input_template = "\"<group> failed: <reason> (task <task>). The task's log group is /ecs/<family name>.\""
  }
}
