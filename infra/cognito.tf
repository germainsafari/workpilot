# ──────────────────────────────────────────────────────────────────────────────
# Cognito User Pool
# ──────────────────────────────────────────────────────────────────────────────

resource "aws_cognito_user_pool" "main" {
  name = "${local.project}-${local.env}"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  schema {
    name                     = "tenant_id"
    attribute_data_type      = "String"
    mutable                  = true
    developer_only_attribute = false

    string_attribute_constraints {
      min_length = 1
      max_length = 64
    }
  }

  schema {
    name                     = "role"
    attribute_data_type      = "String"
    mutable                  = true
    developer_only_attribute = false

    string_attribute_constraints {
      min_length = 1
      max_length = 32
    }
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  tags = {
    Name = "${local.project}-${local.env}-cognito-pool"
  }
}

# ──────────────────────────────────────────────────────────────────────────────
# App Client (used by the frontend SPA — no client secret)
# ──────────────────────────────────────────────────────────────────────────────

resource "aws_cognito_user_pool_client" "spa" {
  name         = "${local.project}-${local.env}-spa"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret = false

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  access_token_validity  = 60   # minutes
  id_token_validity      = 60   # minutes
  refresh_token_validity = 30   # days

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  read_attributes = [
    "email",
    "email_verified",
    "custom:tenant_id",
    "custom:role",
  ]

  write_attributes = [
    "email",
    "custom:tenant_id",
    "custom:role",
  ]
}
