# Least-privilege roles:
#   execution  ECS agent: pull images, write logs, read this environment's SSM parameters (secrets injection).
#   api_task   API, worker, migrate/seed: objects in the uploads bucket only.
#   backup     pg_dump task: list/read/write/delete under db/ in the backups bucket only.
#   web_task   Next apps: nothing (only ECS Exec when enabled).
#   scheduler  EventBridge Scheduler: run the backup task definition.
# ECS Exec adds the ssmmessages channel permissions to the task roles.

data "aws_iam_policy_document" "ecs_tasks_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

locals {
  ssm_arn_prefix = "arn:${data.aws_partition.current.partition}:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${local.ssm_prefix}"
}

# ---------------------------------------------------------------- execution role

resource "aws_iam_role" "execution" {
  name               = "${local.name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_trust.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    sid       = "ReadEnvironmentParameters"
    actions   = ["ssm:GetParameters"]
    resources = ["${local.ssm_arn_prefix}/*"]
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# ---------------------------------------------------------------- ECS Exec (shared statement)

data "aws_iam_policy_document" "exec" {
  statement {
    sid = "EcsExec"
    actions = [
      "ssmmessages:CreateControlChannel",
      "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel",
      "ssmmessages:OpenDataChannel",
    ]
    resources = ["*"] # these actions have no resource-level permissions
  }
}

# ---------------------------------------------------------------- API / worker / migrate

resource "aws_iam_role" "api_task" {
  name               = "${local.name}-api-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_trust.json
}

data "aws_iam_policy_document" "api_task" {
  statement {
    sid       = "UploadsObjects"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${module.storage.uploads_bucket_arn}/*"]
  }
  # HeadObject on a missing key returns 403 instead of 404 without ListBucket; the uploads module treats both as
  # "not there yet", but ListBucket keeps the answer precise.
  statement {
    sid       = "UploadsList"
    actions   = ["s3:ListBucket"]
    resources = [module.storage.uploads_bucket_arn]
  }
}

resource "aws_iam_role_policy" "api_task" {
  name   = "uploads"
  role   = aws_iam_role.api_task.id
  policy = data.aws_iam_policy_document.api_task.json
}

resource "aws_iam_role_policy" "api_exec" {
  count  = var.enable_execute_command ? 1 : 0
  name   = "ecs-exec"
  role   = aws_iam_role.api_task.id
  policy = data.aws_iam_policy_document.exec.json
}

# ---------------------------------------------------------------- backup

resource "aws_iam_role" "backup_task" {
  name               = "${local.name}-backup-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_trust.json
}

data "aws_iam_policy_document" "backup_task" {
  statement {
    sid       = "ListBackups"
    actions   = ["s3:ListBucket"]
    resources = [module.storage.backups_bucket_arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["db/", "db/*"]
    }
  }
  statement {
    sid       = "ReadWriteBackups"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${module.storage.backups_bucket_arn}/db/*"]
  }
}

resource "aws_iam_role_policy" "backup_task" {
  name   = "backups"
  role   = aws_iam_role.backup_task.id
  policy = data.aws_iam_policy_document.backup_task.json
}

# ---------------------------------------------------------------- Next apps

resource "aws_iam_role" "web_task" {
  count              = var.enable_execute_command ? 1 : 0
  name               = "${local.name}-web-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_trust.json
}

resource "aws_iam_role_policy" "web_exec" {
  count  = var.enable_execute_command ? 1 : 0
  name   = "ecs-exec"
  role   = aws_iam_role.web_task[0].id
  policy = data.aws_iam_policy_document.exec.json
}

# ---------------------------------------------------------------- scheduler (nightly backup)

data "aws_iam_policy_document" "scheduler_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "${local.name}-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_trust.json
}

data "aws_iam_policy_document" "scheduler" {
  statement {
    sid       = "RunBackupTask"
    actions   = ["ecs:RunTask"]
    resources = ["${module.backup.task_definition_family_arn}:*"]
    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [aws_ecs_cluster.this.arn]
    }
  }
  statement {
    sid       = "PassBackupRoles"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.execution.arn, aws_iam_role.backup_task.arn]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "scheduler" {
  name   = "run-backup"
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.scheduler.json
}
