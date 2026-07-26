# WorkPilot Observability Guide

## Overview

WorkPilot exports **traces** to AWS X-Ray and **metrics** to CloudWatch via the
AWS Distro for OpenTelemetry (ADOT) collector.

```
FastAPI app  ──OTLP gRPC──▶  ADOT sidecar  ──▶  AWS X-Ray   (traces)
  (port 4317)                (ECS sidecar)  ──▶  CloudWatch  (metrics / EMF)
```

## What is instrumented

| Layer | Instrumentation type | Span / metric name |
|---|---|---|
| HTTP requests | FastAPI auto-instrumentation | `GET /v1/…`, `POST /v1/…` |
| Database queries | SQLAlchemy auto-instrumentation | `SELECT`, `INSERT`, … |
| Workflow runs | Manual span in `run_service.py` | `run.execute` |
| Step completions | Span events on `run.execute` | `step.completed` |

### `run.execute` span attributes

| Attribute | Description |
|---|---|
| `workpilot.run_id` | Primary key of the `WorkflowRun` |
| `workpilot.tenant_id` | Tenant scope of the run |
| `workpilot.workflow_id` | Parent workflow ID |
| `workpilot.workflow_version_id` | Version that was executed |
| `workpilot.trace_id` | Application-level trace correlation ID |
| `workpilot.run.status` | `completed` or `failed` |
| `workpilot.run.steps` | Number of steps executed |

## Enabling OTel

### Local development

OTel is **disabled by default** (`WORKPILOT_OTEL_ENABLED=false`) so the test
suite runs without AWS credentials or a running collector.

To enable it locally with a Docker-hosted ADOT collector:

```bash
# Start the collector (example — uses the public ADOT image)
docker run --rm -p 4317:4317 -p 4318:4318 \
  -v $(pwd)/infra/adot-config.yaml:/etc/otel-collector-config.yaml \
  amazon/aws-otel-collector:latest \
  --config /etc/otel-collector-config.yaml

# Point the API at it
export WORKPILOT_OTEL_ENABLED=true
export WORKPILOT_OTEL_EXPORTER_ENDPOINT=http://localhost:4317
```

### Production (ECS)

Add the following environment variables to the `workpilot-api` ECS task
definition:

```json
{
  "name": "WORKPILOT_OTEL_ENABLED",       "value": "true"
},
{
  "name": "WORKPILOT_OTEL_EXPORTER_ENDPOINT", "value": "http://localhost:4317"
}
```

Add the ADOT sidecar container to the same task definition:

```json
{
  "name": "adot-collector",
  "image": "amazon/aws-otel-collector:latest",
  "command": ["--config", "/etc/otel-collector-config.yaml"],
  "mountPoints": [{
    "sourceVolume": "adot-config",
    "containerPath": "/etc/otel-collector-config.yaml",
    "readOnly": true
  }]
}
```

Mount `infra/adot-config.yaml` from S3 or bake it into a custom image.

### Required IAM permissions (ECS task role)

```json
{
  "Effect": "Allow",
  "Action": [
    "xray:PutTraceSegments",
    "xray:PutTelemetryRecords",
    "logs:CreateLogGroup",
    "logs:CreateLogDelivery",
    "logs:PutLogEvents",
    "cloudwatch:PutMetricData"
  ],
  "Resource": "*"
}
```

## X-Ray service map

Navigate to **AWS Console → X-Ray → Service Map** and select the
`workpilot-api` node. Filter by `deployment.environment` annotation to
compare production and staging traces.

Deep-link pattern:
```
https://{region}.console.aws.amazon.com/xray/home#/service-map?timeRange=PT1H
```

## CloudWatch metrics namespace

All metrics are published under the **`WorkPilot`** namespace, dimensioned by:
- `service.name` (always `workpilot-api`)
- `deployment.environment` (e.g. `production`, `staging`)

## CloudWatch Insights queries

### Average run duration (last hour)

```
fields @timestamp, attributes.workpilot.run_id, duration
| filter name = "run.execute"
| stats avg(duration/1e6) as avg_ms, max(duration/1e6) as p100_ms by bin(5m)
| sort @timestamp desc
```

### Run error rate (last hour)

```
fields @timestamp, attributes.workpilot.run.status
| filter name = "run.execute"
| stats
    count(*) as total,
    count_if(attributes.workpilot.run.status = "failed") as failures
  by bin(5m)
| fields (failures / total) * 100 as error_pct
| sort @timestamp desc
```

### Step-level error rate

```
fields @timestamp, events.0.attributes.step_id, events.0.attributes.status
| filter name = "run.execute" and ispresent(events)
| parse events as [*]
| stats count_if(status = "failed") / count(*) * 100 as step_error_pct
       by step_id
| sort step_error_pct desc
```

### Cost per run (sum of model token costs)

```
fields @timestamp, attributes.workpilot.run_id
| filter name = "run.execute" and ispresent(attributes.workpilot.run.steps)
| stats avg(attributes.workpilot.run.steps) as avg_steps,
        count(*) as run_count
  by bin(1h)
| sort @timestamp desc
```

## CloudWatch dashboard blueprint

The JSON below creates a 4-widget dashboard.  Import it via
**AWS Console → CloudWatch → Dashboards → Create dashboard → Source (JSON)**.

```json
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "title": "Run success rate (%)",
        "view": "timeSeries",
        "metrics": [
          ["WorkPilot", "run.execute.success_count",  "service.name", "workpilot-api"],
          ["WorkPilot", "run.execute.error_count",    "service.name", "workpilot-api"]
        ],
        "stat": "Sum",
        "period": 300
      }
    },
    {
      "type": "metric",
      "properties": {
        "title": "Avg run duration (ms)",
        "view": "timeSeries",
        "metrics": [
          ["WorkPilot", "run.execute.duration_ms", "service.name", "workpilot-api"]
        ],
        "stat": "Average",
        "period": 300
      }
    },
    {
      "type": "metric",
      "properties": {
        "title": "Step error rate",
        "view": "timeSeries",
        "metrics": [
          ["WorkPilot", "step.error_count", "service.name", "workpilot-api"]
        ],
        "stat": "Sum",
        "period": 300
      }
    },
    {
      "type": "metric",
      "properties": {
        "title": "Cost per run (USD)",
        "view": "timeSeries",
        "metrics": [
          ["WorkPilot", "run.cost_usd", "service.name", "workpilot-api"]
        ],
        "stat": "Average",
        "period": 3600
      }
    }
  ]
}
```
