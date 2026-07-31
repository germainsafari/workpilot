# ──────────────────────────────────────────────────────────────────────────────
# Outputs
# ──────────────────────────────────────────────────────────────────────────────

output "ecr_repository_url" {
  description = "ECR repository URL for the WorkPilot API image"
  value       = aws_ecr_repository.workpilot_api.repository_url
}

output "ecr_web_repository_url" {
  description = <<-EOT
    ECR repository URL for the WorkPilot web (vinext/Next.js) image.

    Build with --build-arg NEXT_PUBLIC_CONTROL_PLANE_URL=http://<alb_dns_name>
    (see the alb_dns_name output) so the browser calls the API through the ALB.
    That value bakes into the client bundle at build time, which is why it
    cannot simply be an environment variable on the running container.
  EOT
  value       = aws_ecr_repository.workpilot_web.repository_url
}

output "ecs_cluster_name" {
  description = "Name of the ECS cluster"
  value       = aws_ecs_cluster.main.name
}

output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer"
  value       = aws_lb.main.dns_name
}

output "vpc_id" {
  description = "ID of the VPC"
  value       = aws_vpc.main.id
}

output "private_subnet_ids" {
  description = "IDs of the three private subnets"
  value       = aws_subnet.private[*].id
}

output "public_subnet_ids" {
  description = "IDs of the three public subnets"
  value       = aws_subnet.public[*].id
}

output "secrets_database_url_arn" {
  description = "ARN of the Secrets Manager secret holding the database URL"
  value       = aws_secretsmanager_secret.database_url.arn
}

output "secrets_jwt_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the JWT signing key"
  value       = aws_secretsmanager_secret.jwt_secret.arn
}

output "secrets_bedrock_region_arn" {
  description = "ARN of the Secrets Manager secret holding the Bedrock region"
  value       = aws_secretsmanager_secret.bedrock_region.arn
}

output "cognito_user_pool_id" {
  description = "Cognito User Pool ID (set as WORKPILOT_COGNITO_USER_POOL_ID in the app)"
  value       = aws_cognito_user_pool.main.id
}

output "cognito_app_client_id" {
  description = "Cognito App Client ID for the frontend SPA"
  value       = aws_cognito_user_pool_client.spa.id
}
