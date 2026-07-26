# ──────────────────────────────────────────────────────────────────────────────
# ECS Cluster
# ──────────────────────────────────────────────────────────────────────────────

resource "aws_ecs_cluster" "main" {
  name = "${local.project}-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Name = "${local.project}-${local.env}-ecs-cluster"
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name = aws_ecs_cluster.main.name

  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    base              = 1
    weight            = 100
    capacity_provider = "FARGATE"
  }
}

# ──────────────────────────────────────────────────────────────────────────────
# CloudWatch Log Group
# ──────────────────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "api" {
  name              = "/workpilot/${var.environment}/api"
  retention_in_days = 30

  tags = {
    Name = "${local.project}-${local.env}-log-group-api"
  }
}

resource "aws_cloudwatch_log_group" "adot" {
  name              = "/workpilot/${var.environment}/adot"
  retention_in_days = 7

  tags = {
    Name = "${local.project}-${local.env}-log-group-adot"
  }
}

# ──────────────────────────────────────────────────────────────────────────────
# Security group — ECS tasks
# ──────────────────────────────────────────────────────────────────────────────

resource "aws_security_group" "ecs_tasks" {
  name        = "${local.project}-${local.env}-sg-ecs-tasks"
  description = "Allow port 8000 from the ALB; allow all outbound"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "API traffic from ALB"
    from_port       = 8000
    to_port         = 8000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.project}-${local.env}-sg-ecs-tasks"
  }
}

# ──────────────────────────────────────────────────────────────────────────────
# Task Definition
# ──────────────────────────────────────────────────────────────────────────────

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.project}-${local.env}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.api_cpu)
  memory                   = tostring(var.api_memory)
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "api"
      image     = "${aws_ecr_repository.workpilot_api.repository_url}:latest"
      essential = true

      portMappings = [
        {
          containerPort = 8000
          protocol      = "tcp"
        }
      ]

      environment = [
        {
          name  = "WORKPILOT_ENVIRONMENT"
          value = var.environment
        },
        {
          name  = "AWS_DEFAULT_REGION"
          value = local.region
        },
        {
          name  = "WORKPILOT_OTEL_ENABLED"
          value = "true"
        },
        {
          name  = "WORKPILOT_OTEL_EXPORTER_ENDPOINT"
          value = "http://localhost:4317"
        },
        {
          name  = "WORKPILOT_COGNITO_REGION"
          value = local.region
        },
        {
          name  = "WORKPILOT_COGNITO_USER_POOL_ID"
          value = aws_cognito_user_pool.main.id
        },
        {
          name  = "WORKPILOT_COGNITO_APP_CLIENT_ID"
          value = aws_cognito_user_pool_client.spa.id
        },
        {
          name  = "WORKPILOT_LOCAL_AUTH_ENABLED"
          value = "false"
        },
        {
          name  = "WORKPILOT_AGENT_RUNTIME"
          value = "bedrock_langgraph"
        },
        {
          name  = "WORKPILOT_BEDROCK_REGION"
          value = local.region
        }
      ]

      secrets = [
        {
          name      = "WORKPILOT_DATABASE_URL"
          valueFrom = aws_secretsmanager_secret.database_url.arn
        },
        {
          name      = "WORKPILOT_JWT_SECRET"
          valueFrom = aws_secretsmanager_secret.jwt_secret.arn
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = local.region
          "awslogs-stream-prefix" = "ecs"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:8000/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    },
    {
      name      = "adot-collector"
      image     = "public.ecr.aws/aws-observability/aws-otel-collector:latest"
      essential = false

      command = ["--config=env:AOT_CONFIG_CONTENT"]

      environment = [
        {
          name = "AOT_CONFIG_CONTENT"
          value = yamlencode({
            receivers = {
              otlp = {
                protocols = {
                  grpc = { endpoint = "0.0.0.0:4317" }
                  http = { endpoint = "0.0.0.0:4318" }
                }
              }
            }
            processors = {
              batch = {}
              resourcedetection = { detectors = ["env", "ecs"] }
            }
            exporters = {
              awsxray = { region = local.region }
            }
            service = {
              pipelines = {
                traces = {
                  receivers  = ["otlp"]
                  processors = ["resourcedetection", "batch"]
                  exporters  = ["awsxray"]
                }
              }
            }
          })
        }
      ]

      portMappings = [
        { containerPort = 4317, protocol = "tcp" },
        { containerPort = 4318, protocol = "tcp" }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.adot.name
          "awslogs-region"        = local.region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])

  tags = {
    Name = "${local.project}-${local.env}-task-def-api"
  }
}

# ──────────────────────────────────────────────────────────────────────────────
# ECS Service
# ──────────────────────────────────────────────────────────────────────────────

resource "aws_ecs_service" "api" {
  name                               = "${local.project}-${local.env}-api"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.api.arn
  desired_count                      = var.api_desired_count
  launch_type                        = "FARGATE"
  health_check_grace_period_seconds  = 60

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 8000
  }

  # Ensure listener exists before service registers targets
  depends_on = [aws_lb_listener.http]

  tags = {
    Name = "${local.project}-${local.env}-ecs-service-api"
  }

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }
}
