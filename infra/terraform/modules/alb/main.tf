# Internet-facing ALB in front of the API and the six Next apps.
#
# No-domain mode (domain = ""): plain HTTP on the ALB DNS name, one listener per app port, the same ports as in
#   development (api :4000, admin :3000 ... www :3005, and www also on :80). No certificate is possible without a
#   domain. Shop subdomains can't work on an AWS host name either: see docs/deploy-aws.md.
# Domain mode: HTTPS :443 with one ACM certificate (validated in Route 53), host-header rules per app, the store
#   as the default target (every shop subdomain and custom domain), and :80 redirecting to HTTPS.

locals {
  domain_mode = var.domain != ""
  # no-domain mode: listener port => target key
  port_targets   = merge([for k, t in var.targets : { for p in t.listener_ports : tostring(p) => k }]...)
  default_target = one([for k, t in var.targets : k if t.default])
}

resource "aws_security_group" "alb" {
  name        = "${var.name}-alb"
  description = "Public load balancer"
  vpc_id      = var.vpc_id
  tags        = merge(var.tags, { Name = "${var.name}-alb" })
}

resource "aws_vpc_security_group_ingress_rule" "alb" {
  for_each = {
    for pair in setproduct(local.domain_mode ? ["80", "443"] : keys(local.port_targets), var.allowed_cidrs) :
    "${pair[0]}-${pair[1]}" => { port = tonumber(pair[0]), cidr = pair[1] }
  }
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = each.value.cidr
  ip_protocol       = "tcp"
  from_port         = each.value.port
  to_port           = each.value.port
  description       = "listener ${each.value.port}"
}

resource "aws_vpc_security_group_egress_rule" "alb" {
  for_each          = toset(distinct([for t in var.targets : tostring(t.port)]))
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = data.aws_vpc.this.cidr_block
  ip_protocol       = "tcp"
  from_port         = tonumber(each.value)
  to_port           = tonumber(each.value)
  description       = "to tasks on ${each.value}"
}

data "aws_vpc" "this" {
  id = var.vpc_id
}

resource "aws_lb" "this" {
  name                       = var.name
  load_balancer_type         = "application"
  internal                   = false
  security_groups            = [aws_security_group.alb.id]
  subnets                    = var.public_subnet_ids
  idle_timeout               = var.idle_timeout
  drop_invalid_header_fields = true
  enable_deletion_protection = var.deletion_protection
  tags                       = var.tags
}

resource "aws_lb_target_group" "this" {
  for_each             = var.targets
  name                 = substr("${var.name}-${each.key}", 0, 32)
  port                 = each.value.port
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = var.vpc_id
  deregistration_delay = var.deregistration_delay

  health_check {
    path                = each.value.health_path
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = var.tags
}

# ---------------------------------------------------------------- no-domain mode: one HTTP listener per port

resource "aws_lb_listener" "port" {
  for_each          = local.domain_mode ? {} : local.port_targets
  load_balancer_arn = aws_lb.this.arn
  port              = tonumber(each.key)
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this[each.value].arn
  }

  tags = var.tags
}

# ---------------------------------------------------------------- domain mode: ACM + HTTPS + host rules

resource "aws_acm_certificate" "this" {
  count                     = local.domain_mode ? 1 : 0
  domain_name               = var.certificate_names[0]
  subject_alternative_names = slice(var.certificate_names, 1, length(var.certificate_names))
  validation_method         = "DNS"
  tags                      = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "validation" {
  # Keyed by the certificate name (known at plan time). "x.in" and "*.x.in" share one validation record, hence
  # allow_overwrite.
  for_each = local.domain_mode ? {
    for o in aws_acm_certificate.this[0].domain_validation_options : o.domain_name => o
  } : {}
  zone_id         = var.route53_zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  records         = [each.value.resource_record_value]
  ttl             = 300
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "this" {
  count                   = local.domain_mode ? 1 : 0
  certificate_arn         = aws_acm_certificate.this[0].arn
  validation_record_fqdns = [for r in aws_route53_record.validation : r.fqdn]
}

resource "aws_lb_listener" "https" {
  count             = local.domain_mode ? 1 : 0
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.this[0].certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this[local.default_target].arn
  }

  tags = var.tags
}

resource "aws_lb_listener" "http_redirect" {
  count             = local.domain_mode ? 1 : 0
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      protocol    = "HTTPS"
      port        = "443"
      status_code = "HTTP_301"
    }
  }

  tags = var.tags
}

resource "aws_lb_listener_rule" "host" {
  for_each     = local.domain_mode ? { for k, t in var.targets : k => t if length(t.hosts) > 0 } : {}
  listener_arn = aws_lb_listener.https[0].arn
  priority     = each.value.priority

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this[each.key].arn
  }

  condition {
    host_header {
      values = each.value.hosts
    }
  }

  tags = var.tags
}

resource "aws_route53_record" "alias" {
  for_each = local.domain_mode ? { for pair in setproduct(var.alias_records, ["A", "AAAA"]) : "${pair[0]}-${pair[1]}" => pair } : {}
  zone_id  = var.route53_zone_id
  name     = each.value[0]
  type     = each.value[1]

  alias {
    name                   = aws_lb.this.dns_name
    zone_id                = aws_lb.this.zone_id
    evaluate_target_health = false
  }
}
