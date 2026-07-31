# ──────────────────────────────────────────────────────────────────────────────
# ECR Repository
# ──────────────────────────────────────────────────────────────────────────────

resource "aws_ecr_repository" "workpilot_api" {
  name                 = "workpilot-api"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name = "workpilot-api"
  }
}

resource "aws_ecr_lifecycle_policy" "workpilot_api" {
  repository = aws_ecr_repository.workpilot_api.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 images; expire anything older"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

resource "aws_ecr_repository" "workpilot_web" {
  name                 = "workpilot-web"
  image_tag_mutability = "MUTABLE"

  # Off, unlike the API repo: this image is 700+MB of Node/Next build output
  # with no third-party dependency surface worth scanning per push, and
  # scanning it repeatedly has a real (if small) cost.
  image_scanning_configuration {
    scan_on_push = false
  }

  tags = {
    Name = "workpilot-web"
  }
}

resource "aws_ecr_lifecycle_policy" "workpilot_web" {
  repository = aws_ecr_repository.workpilot_web.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 5 images; expire anything older"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 5
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}
