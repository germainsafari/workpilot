terraform {
  required_version = "~> 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Uncomment to use remote S3 state. Create the bucket first — see README.md.
  # backend "s3" {
  #   bucket  = "workpilot-tfstate-<AWS_ACCOUNT_ID>"
  #   key     = "workpilot/terraform.tfstate"
  #   region  = "eu-central-1"
  #   encrypt = true
  # }
}

provider "aws" {
  region = "eu-central-1"

  default_tags {
    tags = {
      Project     = local.project
      Environment = local.env
      ManagedBy   = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  region     = "eu-central-1"
  project    = "workpilot"
  env        = var.environment
}
