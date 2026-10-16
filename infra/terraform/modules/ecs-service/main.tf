# A Fargate task definition with one or more containers, a log group, and (optionally) a service behind the ALB.
# Images are referenced by a moving tag (`:staging`, `:migrate`); the deploy workflow pushes the new image under that
# tag and forces a new deployment, so Terraform and CI never fight over task definition revisions.

data "aws_region" "current" {}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/${var.name}"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

locals {
  container_definitions = [
    for name, c in var.containers : merge(
      {
        name         = name
        image        = c.image
        essential    = true
        stopTimeout  = 30
        environment  = [for k in sort(keys(c.environment)) : { name = k, value = c.environment[k] }]
        secrets      = [for k in sort(keys(c.secrets)) : { name = k, valueFrom = c.secrets[k] }]
        portMappings = c.port == null ? [] : [{ containerPort = c.port, protocol = "tcp", name = name }]
        logConfiguration = {
          logDriver = "awslogs"
          options = {
            awslogs-group         = aws_cloudwatch_log_group.this.name
            awslogs-region        = data.aws_region.current.region
            awslogs-stream-prefix = name
          }
        }
      },
      c.command == null ? {} : { command = c.command },
      c.memory_reservation == null ? {} : { memoryReservation = c.memory_reservation },
      c.health_path == null || c.port == null ? {} : {
        healthCheck = {
          command     = ["CMD-SHELL", "wget -q -O /dev/null http://127.0.0.1:${c.port}${c.health_path} || exit 1"]
          interval    = 15
          timeout     = 5
          retries     = 3
          startPeriod = 30
        }
      },
    )
  ]
}

resource "aws_ecs_task_definition" "this" {
  family                   = var.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn
  container_definitions    = jsonencode(local.container_definitions)

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }

  tags = var.tags
}

resource "aws_ecs_service" "this" {
  count                   = var.create_service ? 1 : 0
  name                    = var.name
  cluster                 = var.cluster_arn
  task_definition         = aws_ecs_task_definition.this.arn
  desired_count           = var.desired_count
  enable_execute_command  = var.enable_execute_command
  propagate_tags          = "SERVICE"
  enable_ecs_managed_tags = true

  # Rolling deploy: start the new task, wait until healthy, then stop the old one. Roll back automatically when the
  # new tasks never become healthy.
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  health_check_grace_period_seconds = length(var.target_groups) > 0 ? var.health_check_grace_period : null

  capacity_provider_strategy {
    capacity_provider = var.use_spot ? "FARGATE_SPOT" : "FARGATE"
    weight            = 1
  }

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = var.security_group_ids
    assign_public_ip = var.assign_public_ip
  }

  dynamic "load_balancer" {
    for_each = var.target_groups
    content {
      target_group_arn = load_balancer.value
      container_name   = load_balancer.key
      container_port   = var.containers[load_balancer.key].port
    }
  }

  tags = var.tags
}
