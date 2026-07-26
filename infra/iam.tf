# ──────────────────────────────────────────────────────────────────────────────
# ECS Task Execution Role
# Allows ECS to pull images from ECR and read secrets at launch time.
# ──────────────────────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "ecs_task_execution_assume" {
  statement {
    sid     = "ECSAssumeRole"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_task_execution" {
  name               = "${local.project}-${local.env}-ecs-task-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_execution_assume.json

  tags = {
    Name = "${local.project}-${local.env}-ecs-task-execution-role"
  }
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_managed" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "ecs_task_execution_secrets" {
  statement {
    sid     = "AllowSecretsManagerRead"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      aws_secretsmanager_secret.database_url.arn,
      aws_secretsmanager_secret.jwt_secret.arn,
      aws_secretsmanager_secret.bedrock_region.arn,
    ]
  }
}

resource "aws_iam_role_policy" "ecs_task_execution_secrets" {
  name   = "${local.project}-${local.env}-allow-secrets-read"
  role   = aws_iam_role.ecs_task_execution.id
  policy = data.aws_iam_policy_document.ecs_task_execution_secrets.json
}

# ──────────────────────────────────────────────────────────────────────────────
# ECS Task Role
# Permissions the running container itself needs at runtime.
# ──────────────────────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "ecs_task_assume" {
  statement {
    sid     = "ECSAssumeRole"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_task" {
  name               = "${local.project}-${local.env}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume.json

  tags = {
    Name = "${local.project}-${local.env}-ecs-task-role"
  }
}

data "aws_iam_policy_document" "ecs_task" {
  statement {
    sid       = "AllowBedrockInvoke"
    actions   = ["bedrock:InvokeModel"]
    resources = ["*"]
  }

  statement {
    sid       = "AllowCloudWatchMetrics"
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"]
  }

  statement {
    sid = "AllowXRay"
    actions = [
      "xray:PutTraceSegments",
      "xray:GetSamplingRules",
    ]
    resources = ["*"]
  }

  statement {
    sid = "AllowCloudWatchLogs"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "ecs_task" {
  name   = "${local.project}-${local.env}-ecs-task-policy"
  role   = aws_iam_role.ecs_task.id
  policy = data.aws_iam_policy_document.ecs_task.json
}
