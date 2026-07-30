# ──────────────────────────────────────────────────────────────────────────────
# Secrets Manager secrets
# Populate values manually or via CI/CD after first apply.
# ──────────────────────────────────────────────────────────────────────────────

resource "aws_secretsmanager_secret" "database_url" {
  name                    = "workpilot/database-url"
  description             = "PostgreSQL connection URL for WorkPilot (Aurora in prod, Neon in dev)"
  recovery_window_in_days = 7

  tags = {
    Name = "${local.project}-${local.env}-secret-database-url"
  }
}

resource "aws_secretsmanager_secret" "jwt_secret" {
  name                    = "workpilot/jwt-secret"
  description             = "HS256 signing secret for WorkPilot JWT tokens"
  recovery_window_in_days = 7

  tags = {
    Name = "${local.project}-${local.env}-secret-jwt-secret"
  }
}

resource "aws_secretsmanager_secret" "bedrock_region" {
  name                    = "workpilot/bedrock-region"
  description             = "AWS region used for Bedrock API calls (e.g. us-east-1)"
  recovery_window_in_days = 7

  tags = {
    Name = "${local.project}-${local.env}-secret-bedrock-region"
  }
}

# Fernet key protecting third-party connection tokens (Scoro, Drive, …) at rest
# in the `connections` table.
#
# Deliberately separate from jwt-secret: app.crypto will derive a key from the
# JWT secret if this is unset, which means rotating the JWT secret would silently
# make every stored connection token undecryptable. Keep the two independent.
#
# Generate a value with:
#   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
resource "aws_secretsmanager_secret" "encryption_key" {
  name                    = "workpilot/encryption-key"
  description             = "Fernet key encrypting third-party connection credentials at rest"
  recovery_window_in_days = 7

  tags = {
    Name = "${local.project}-${local.env}-secret-encryption-key"
  }
}
