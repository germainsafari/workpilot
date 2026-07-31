variable "environment" {
  description = "Deployment environment (staging | production)"
  type        = string
  default     = "staging"

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be 'staging' or 'production'."
  }
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "api_cpu" {
  description = "vCPU units for the API Fargate task (256 | 512 | 1024 | 2048 | 4096)"
  type        = number
  default     = 512
}

variable "api_memory" {
  description = "Memory (MiB) for the API Fargate task"
  type        = number
  default     = 1024
}

variable "api_desired_count" {
  description = "Desired number of running API task instances"
  type        = number
  default     = 1
}

variable "web_cpu" {
  description = "vCPU units added to the shared task for the web (vinext/Next.js) container"
  type        = number
  default     = 512
}

variable "web_memory" {
  description = "Memory (MiB) added to the shared task for the web container"
  type        = number
  default     = 1024
}

variable "certificate_arn" {
  description = "ACM certificate ARN for the HTTPS listener. Leave empty to skip HTTPS."
  type        = string
  default     = ""
}

variable "agentcore_runtime_arn" {
  description = "Bedrock AgentCore runtime ARN for workflows with runtime_override=agentcore"
  type        = string
  default     = ""
}

variable "enable_private_egress" {
  description = <<-EOT
    Run Fargate tasks in private subnets, reaching AWS through a NAT gateway and
    five Interface VPC endpoints (ECR api/dkr, Secrets Manager, Logs, X-Ray).

    This costs roughly $153/month before any data transfer: ~$33 for the NAT
    gateway plus ~$24 per interface endpoint (each is billed per ENI per AZ, and
    there are three AZs). For a single 0.5-vCPU staging task that is around 80%
    of the total bill and it is redundant — the NAT and the endpoints are two
    ways to solve the same egress problem.

    When false (the default), tasks run in public subnets with a public IP and
    reach AWS over the internet gateway. This is not a security downgrade here:
    the task security group only admits port 8000 from the ALB's security group,
    so nothing is reachable from the internet. The free S3 gateway endpoint is
    kept either way.

    Set to true for production if egress must stay off the public internet — for
    example to satisfy a "no public IP on compute" control.
  EOT
  type        = bool
  default     = false
}
