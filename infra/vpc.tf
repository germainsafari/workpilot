# ──────────────────────────────────────────────────────────────────────────────
# VPC — 3 public + 3 private subnets across eu-central-1a/b/c
# ──────────────────────────────────────────────────────────────────────────────

locals {
  azs             = ["eu-central-1a", "eu-central-1b", "eu-central-1c"]
  public_subnets  = [for i in range(3) : cidrsubnet(var.vpc_cidr, 8, i)]
  private_subnets = [for i in range(3) : cidrsubnet(var.vpc_cidr, 8, i + 10)]
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "${local.project}-${local.env}-vpc"
  }
}

# ──────────────────────────────────────────────────────────────────────────────
# Subnets
# ──────────────────────────────────────────────────────────────────────────────

resource "aws_subnet" "public" {
  count = 3

  vpc_id                  = aws_vpc.main.id
  cidr_block              = local.public_subnets[count.index]
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name = "${local.project}-${local.env}-public-${local.azs[count.index]}"
    Tier = "public"
  }
}

resource "aws_subnet" "private" {
  count = 3

  vpc_id            = aws_vpc.main.id
  cidr_block        = local.private_subnets[count.index]
  availability_zone = local.azs[count.index]

  tags = {
    Name = "${local.project}-${local.env}-private-${local.azs[count.index]}"
    Tier = "private"
  }
}

# ──────────────────────────────────────────────────────────────────────────────
# Internet Gateway
# ──────────────────────────────────────────────────────────────────────────────

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${local.project}-${local.env}-igw"
  }
}

# ──────────────────────────────────────────────────────────────────────────────
# NAT Gateway — only when var.enable_private_egress is true.
#
# A NAT gateway is ~$33/mo plus $0.045/GB processed. It only earns that when
# compute must sit in private subnets. With tasks in public subnets behind a
# restrictive security group there is nothing for it to do, so it defaults off.
# See variables.tf for the full rationale.
# ──────────────────────────────────────────────────────────────────────────────

resource "aws_eip" "nat" {
  count = var.enable_private_egress ? 1 : 0

  domain = "vpc"

  tags = {
    Name = "${local.project}-${local.env}-nat-eip"
  }

  depends_on = [aws_internet_gateway.main]
}

resource "aws_nat_gateway" "main" {
  count = var.enable_private_egress ? 1 : 0

  allocation_id = aws_eip.nat[0].id
  subnet_id     = aws_subnet.public[0].id

  tags = {
    Name = "${local.project}-${local.env}-nat"
  }

  depends_on = [aws_internet_gateway.main]
}

# ──────────────────────────────────────────────────────────────────────────────
# Route Tables
# ──────────────────────────────────────────────────────────────────────────────

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name = "${local.project}-${local.env}-rt-public"
  }
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id

  # Without a NAT gateway the private subnets simply have no default route.
  # They stay defined so flipping enable_private_egress back on is a one-liner.
  dynamic "route" {
    for_each = var.enable_private_egress ? [1] : []

    content {
      cidr_block     = "0.0.0.0/0"
      nat_gateway_id = aws_nat_gateway.main[0].id
    }
  }

  tags = {
    Name = "${local.project}-${local.env}-rt-private"
  }
}

resource "aws_route_table_association" "public" {
  count = 3

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  count = 3

  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# ──────────────────────────────────────────────────────────────────────────────
# Security group for Interface VPC endpoints
# ──────────────────────────────────────────────────────────────────────────────

resource "aws_security_group" "vpc_endpoints" {
  count = var.enable_private_egress ? 1 : 0

  name        = "${local.project}-${local.env}-sg-vpc-endpoints"
  description = "Allow HTTPS from within the VPC to Interface VPC endpoints"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTPS from VPC"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.project}-${local.env}-sg-vpc-endpoints"
  }
}

# ──────────────────────────────────────────────────────────────────────────────
# VPC Endpoints
#
# The S3 Gateway endpoint is free and always created. The five Interface
# endpoints below are billed per ENI per AZ (~$0.011/hr each), so across three
# AZs they cost ~$24/mo *each* — ~$120/mo in total. They are only needed when
# tasks have no route to the public internet, so they follow the same
# enable_private_egress toggle as the NAT gateway.
# ──────────────────────────────────────────────────────────────────────────────

# S3 — Gateway type (no security group required)
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${local.region}.s3"
  vpc_endpoint_type = "Gateway"

  route_table_ids = [
    aws_route_table.public.id,
    aws_route_table.private.id,
  ]

  tags = {
    Name = "${local.project}-${local.env}-vpce-s3"
  }
}

# ECR API — Interface type
resource "aws_vpc_endpoint" "ecr_api" {
  count = var.enable_private_egress ? 1 : 0

  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${local.region}.ecr.api"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.vpc_endpoints[0].id]
  private_dns_enabled = true

  tags = {
    Name = "${local.project}-${local.env}-vpce-ecr-api"
  }
}

# ECR DKR — Interface type
resource "aws_vpc_endpoint" "ecr_dkr" {
  count = var.enable_private_egress ? 1 : 0

  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${local.region}.ecr.dkr"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.vpc_endpoints[0].id]
  private_dns_enabled = true

  tags = {
    Name = "${local.project}-${local.env}-vpce-ecr-dkr"
  }
}

# Secrets Manager — Interface type
resource "aws_vpc_endpoint" "secretsmanager" {
  count = var.enable_private_egress ? 1 : 0

  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${local.region}.secretsmanager"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.vpc_endpoints[0].id]
  private_dns_enabled = true

  tags = {
    Name = "${local.project}-${local.env}-vpce-secretsmanager"
  }
}

# CloudWatch Logs — Interface type
resource "aws_vpc_endpoint" "logs" {
  count = var.enable_private_egress ? 1 : 0

  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${local.region}.logs"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.vpc_endpoints[0].id]
  private_dns_enabled = true

  tags = {
    Name = "${local.project}-${local.env}-vpce-logs"
  }
}

# X-Ray — Interface type
resource "aws_vpc_endpoint" "xray" {
  count = var.enable_private_egress ? 1 : 0

  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${local.region}.xray"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.vpc_endpoints[0].id]
  private_dns_enabled = true

  tags = {
    Name = "${local.project}-${local.env}-vpce-xray"
  }
}
