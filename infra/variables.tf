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

variable "certificate_arn" {
  description = "ACM certificate ARN for the HTTPS listener. Leave empty to skip HTTPS."
  type        = string
  default     = ""
}
