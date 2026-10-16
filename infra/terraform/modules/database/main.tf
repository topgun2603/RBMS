# RDS PostgreSQL: single-AZ for staging, encrypted, 7 days of automated backups (point-in-time restore), deletion
# protection on, a final snapshot on delete. The master password is generated here and leaves Terraform only as
# the DATABASE_URL SecureString parameter (envs/staging/secrets.tf). It is in the Terraform state, so keep the state
# bucket private and encrypted (bootstrap/ does both).

resource "random_password" "master" {
  length  = 32
  special = false # it goes into a URL
}

resource "aws_db_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.subnet_ids
  tags       = var.tags
}

resource "aws_security_group" "db" {
  name        = "${var.name}-db"
  description = "PostgreSQL from the app tasks"
  vpc_id      = var.vpc_id
  tags        = merge(var.tags, { Name = "${var.name}-db" })
}

resource "aws_vpc_security_group_ingress_rule" "db" {
  count                        = length(var.client_security_group_ids)
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = var.client_security_group_ids[count.index]
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "postgres from app tasks"
}

resource "aws_db_parameter_group" "this" {
  name   = "${var.name}-pg${split(".", var.engine_version)[0]}"
  family = "postgres${split(".", var.engine_version)[0]}"

  # TLS only (already the default on RDS PostgreSQL 15+). DATABASE_URL carries sslmode=require.
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  # Log statements slower than 1 s.
  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }

  tags = var.tags
}

resource "aws_db_instance" "this" {
  identifier     = var.name
  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class

  db_name  = var.database_name
  username = var.username
  password = random_password.master.result
  port     = 5432

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage > 0 ? var.max_allocated_storage : null
  storage_type          = "gp3"
  storage_encrypted     = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.db.id]
  parameter_group_name   = aws_db_parameter_group.this.name
  publicly_accessible    = false
  multi_az               = var.multi_az

  backup_retention_period  = var.backup_retention_days
  backup_window            = "19:30-20:30" # UTC = 01:00-02:00 IST, before the 02:30 IST pg_dump task
  maintenance_window       = "sun:21:00-sun:22:00"
  copy_tags_to_snapshot    = true
  delete_automated_backups = false

  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.name}-final"

  auto_minor_version_upgrade      = true
  allow_major_version_upgrade     = false
  apply_immediately               = false
  enabled_cloudwatch_logs_exports = ["postgresql"]
  performance_insights_enabled    = false

  tags = var.tags
}
