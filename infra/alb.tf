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

# ──────────────────────────────────────────────────────────────────────────────
# Listeners
# ──────────────────────────────────────────────────────────────────────────────

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  tags = {
    Name = "${local.project}-${local.env}-listener-http"
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
    target_group_arn = aws_lb_target_group.api.arn
  }

  tags = {
    Name = "${local.project}-${local.env}-listener-https"
  }
}
