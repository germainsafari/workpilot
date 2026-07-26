# WorkPilot — Terraform Infrastructure

Terraform configuration for the WorkPilot production baseline on AWS (eu-central-1).

## What this creates

| File | Resources |
|------|-----------|
| `vpc.tf` | VPC, 3 public + 3 private subnets, IGW, single-AZ NAT Gateway, route tables, VPC endpoints (S3, ECR, Secrets Manager, CloudWatch Logs, X-Ray) |
| `ecr.tf` | ECR repository `workpilot-api` with lifecycle policy (keep last 10 images) |
| `secrets.tf` | Secrets Manager secrets for `database-url`, `jwt-secret`, `bedrock-region` |
| `iam.tf` | ECS task execution role + task role with Bedrock, CloudWatch, X-Ray policies |
| `alb.tf` | Internet-facing ALB, HTTP listener on 80, optional HTTPS on 443 |
| `ecs.tf` | ECS cluster (Fargate), task definition, ECS service in private subnets |
| `outputs.tf` | Key ARNs, IDs, and endpoints |

---

## Prerequisites

- **Terraform >= 1.9** — [Install](https://developer.hashicorp.com/terraform/install)
- **AWS credentials** configured (`~/.aws/credentials` or environment variables)
- IAM user / role must have the permissions listed in the [IAM section](#iam-permissions) below

Set these in your local `.env` (never commit):

```
AWS_ACCOUNT_ID=
AWS_IAM_USER=
TF_STATE_BUCKET=
ECR_REPOSITORY=
```

---

## Usage

### 1. Init and apply (local state)

```bash
cd infra/

terraform init
terraform plan -var="environment=staging"
terraform apply -var="environment=staging"
```

For production:

```bash
terraform apply -var="environment=production"
```

### 2. Populate secrets after first apply

The secrets are created empty. Populate them before deploying the ECS service:

```bash
aws secretsmanager put-secret-value \
  --secret-id workpilot/database-url \
  --secret-string "postgresql://user:pass@host:5432/workpilot"

aws secretsmanager put-secret-value \
  --secret-id workpilot/jwt-secret \
  --secret-string "$(openssl rand -hex 32)"

aws secretsmanager put-secret-value \
  --secret-id workpilot/bedrock-region \
  --secret-string "us-east-1"
```

### 3. Enable HTTPS (optional)

Request or import an ACM certificate, then re-apply with the ARN:

```bash
terraform apply \
  -var="environment=staging" \
  -var="certificate_arn=arn:aws:acm:eu-central-1:<AWS_ACCOUNT_ID>:certificate/XXXXX"
```

---

## Push a Docker image to ECR

Replace `<TAG>` with `latest` or a specific version (e.g. a Git SHA). Use `$ECR_REPOSITORY` from your `.env`.

```bash
# Authenticate Docker to ECR
aws ecr get-login-password --region eu-central-1 \
  | docker login --username AWS --password-stdin \
    $ECR_REPOSITORY

# Build
docker build -t workpilot-api:latest ../../

# Tag
docker tag workpilot-api:latest \
  $ECR_REPOSITORY:<TAG>

# Push
docker push \
  $ECR_REPOSITORY:<TAG>
```

After pushing, force a new ECS deployment to pick up the image:

```bash
aws ecs update-service \
  --cluster workpilot-staging \
  --service workpilot-staging-api \
  --force-new-deployment
```

---

## Enable remote S3 state

Create the state bucket once (one-time, do this before enabling the backend). Use `$TF_STATE_BUCKET` from your `.env`:

```bash
aws s3api create-bucket \
  --bucket $TF_STATE_BUCKET \
  --region eu-central-1 \
  --create-bucket-configuration LocationConstraint=eu-central-1

aws s3api put-bucket-versioning \
  --bucket $TF_STATE_BUCKET \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket $TF_STATE_BUCKET \
  --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
```

Then uncomment the `backend "s3"` block in `main.tf` and run `terraform init -migrate-state`.

---

## IAM permissions

The IAM user / role running Terraform must have the following AWS managed policies (or equivalent):

| Policy | Purpose |
|--------|---------|
| `AmazonECSFullAccess` | ECS cluster, service, task definition |
| `AmazonEC2FullAccess` | VPC, subnets, security groups, IGW, NAT |
| `AmazonVPCFullAccess` | VPC endpoints, route tables |
| `SecretsManagerFullAccess` | Secrets Manager secrets |
| `AmazonEC2ContainerRegistryFullAccess` | ECR repository |
| `IAMFullAccess` | ECS roles and policies |
| `ElasticLoadBalancingFullAccess` | ALB, target groups, listeners |
| `CloudWatchLogsFullAccess` | Log groups |

Attach these to your Terraform IAM user (set `AWS_IAM_USER` in `.env`):

```bash
for policy in \
  arn:aws:iam::aws:policy/AmazonECS_FullAccess \
  arn:aws:iam::aws:policy/AmazonEC2FullAccess \
  arn:aws:iam::aws:policy/AmazonVPCFullAccess \
  arn:aws:iam::aws:policy/SecretsManagerReadWrite \
  arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryFullAccess \
  arn:aws:iam::aws:policy/IAMFullAccess \
  arn:aws:iam::aws:policy/ElasticLoadBalancingFullAccess \
  arn:aws:iam::aws:policy/CloudWatchLogsFullAccess; do
  aws iam attach-user-policy \
    --user-name $AWS_IAM_USER \
    --policy-arn "$policy"
done
```
