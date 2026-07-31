# ──────────────────────────────────────────────────────────────────────────────
# Security group — Application Load Balancer
# ──────────────────────────────────────────────────────────────────────────────

resource "aws_security_group" "alb" {
  name        = "${local.project}-${local.env}-sg-alb"
  description = "Allow HTTP/HTTPS inbound from the internet to the ALB"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP from internet"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS from internet"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.project}-${local.env}-sg-alb"
  }
}

# ──────────────────────────────────────────────────────────────────────────────
# Application Load Balancer
# ──────────────────────────────────────────────────────────────────────────────

resource "aws_lb" "main" {
  name               = "${local.project}-${local.env}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  enable_deletion_protection = false

  tags = {
    Name = "${local.project}-${local.env}-alb"
  }
}

# ──────────────────────────────────────────────────────────────────────────────
# Target Group
# ──────────────────────────────────────────────────────────────────────────────

resource "aws_lb_target_group" "api" {
  name        = "${local.project}-${local.env}-api-tg"
  port        = 8000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip" # Required for Fargate awsvpc network mode

  health_check {
    path                = "/health"
    protocol            = "HTTP"
    healthy_threshold   = 2
    unhealthy_threshold = 2
    interval            = 30
    timeout             = 5
    matcher             = "200"
  }

  tags = {
    Name = "${local.project}-${local.env}-api-tg"
  }
}

# The frontend (vinext/Next.js) container. It shares the API's Fargate task
# rather than getting its own service — that avoids a second ALB or a second
# task's worth of vCPU/memory, at the cost of the two scaling together.
resource "aws_lb_target_group" "web" {
  name        = "${local.project}-${local.env}-web-tg"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    # /login renders without touching the database or Cognito, so it is cheap
    # and always 200 once the Node process is up.
    path                = "/login"
    protocol            = "HTTP"
    healthy_threshold   = 2
    unhealthy_threshold = 4
    interval            = 30
    timeout             = 10
    matcher             = "200"
  }

  deregistration_delay = 15

  tags = {
    Name = "${local.project}-${local.env}-web-tg"
  }
}

# ──────────────────────────────────────────────────────────────────────────────
# Listeners
#
# Routing: anything under /v1, /health, /docs, /openapi.json or /redoc goes to
# the FastAPI container; everything else (the default action) goes to the UI.
# ──────────────────────────────────────────────────────────────────────────────

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = "80"
  protocol          = "HTTP"

  # Default action is the UI, not the API — see aws_lb_listener_rule.api below
  # for what routes to the API instead.
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }

  tags = {
    Name = "${local.project}-${local.env}-listener-http"
  }
}

resource "aws_lb_listener_rule" "api_http" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  # ALB caps path-pattern conditions at 5 values per rule.
  condition {
    path_pattern {
      values = ["/v1/*", "/health", "/docs*", "/openapi.json", "/redoc*"]
    }
  }
}

# HTTPS listener — only created when a certificate_arn is supplied.
resource "aws_lb_listener" "https" {
  count = var.certificate_arn != "" ? 1 : 0

  load_balancer_arn = aws_lb.main.arn
  port              = "443"
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }

  tags = {
    Name = "${local.project}-${local.env}-listener-https"
  }
}

resource "aws_lb_listener_rule" "api_https" {
  count = var.certificate_arn != "" ? 1 : 0

  listener_arn = aws_lb_listener.https[0].arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  condition {
    path_pattern {
      values = ["/v1/*", "/health", "/docs*", "/openapi.json", "/redoc*"]
    }
  }
}
