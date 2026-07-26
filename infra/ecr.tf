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
