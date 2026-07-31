# ──────────────────────────────────────────────────────────────────────────────
# Observability
#
# Three layers, all backed by AWS-native services so there is nothing extra to
# run or pay for beyond what ECS/ALB already need:
#
#   Traces  — apps/api/app/telemetry.py sends OTLP spans through the
#             adot-collector sidecar (already in the task) to AWS X-Ray. Every
#             run gets one span, every step inside it gets a child span
#             (executor.py), so a slow or failing step is visible without
#             reading logs. Console: https://console.aws.amazon.com/xray/home
#
#   Metrics — apps/api/app/metrics.py emits CloudWatch Embedded Metric Format
#             (EMF) JSON to stdout. The existing `awslogs` log driver ships
#             stdout to CloudWatch Logs, and CloudWatch auto-extracts EMF JSON
#             into real metrics under the "WorkPilot" namespace — no metrics
#             SDK call, no extra sidecar. Covers: RunDuration/RunCost/RunTokens
#             per workflow, ToolCallDuration/Count per tool+connector+outcome,
#             ModelDuration/Tokens/Cost per provider+model.
#
#   Logs    — CloudWatch Logs, already wired per-container (api, web, adot).
#             This file adds the dashboard that ties all three together and
#             the alarms that page on the signals that actually matter.
# ──────────────────────────────────────────────────────────────────────────────

locals {
  dashboard_name = "${local.project}-${local.env}"
}

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = local.dashboard_name

  dashboard_body = jsonencode({
    widgets = [
      # -- Row 1: is the service up? ---------------------------------------
      {
        type = "metric", x = 0, y = 0, width = 8, height = 6,
        properties = {
          title  = "ALB target health"
          region = local.region
          metrics = [
            ["AWS/ApplicationELB", "HealthyHostCount", "TargetGroup", aws_lb_target_group.api.arn_suffix, "LoadBalancer", aws_lb.main.arn_suffix, { label = "api healthy" }],
            ["...", "UnHealthyHostCount", ".", aws_lb_target_group.api.arn_suffix, ".", aws_lb.main.arn_suffix, { label = "api unhealthy" }],
            ["...", "HealthyHostCount", ".", aws_lb_target_group.web.arn_suffix, ".", aws_lb.main.arn_suffix, { label = "web healthy" }],
            ["...", "UnHealthyHostCount", ".", aws_lb_target_group.web.arn_suffix, ".", aws_lb.main.arn_suffix, { label = "web unhealthy" }],
          ]
          view = "timeSeries", stacked = false, period = 60
        }
      },
      {
        type = "metric", x = 8, y = 0, width = 8, height = 6,
        properties = {
          title  = "Requests & errors (ALB)"
          region = local.region
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", aws_lb.main.arn_suffix, { stat = "Sum" }],
            ["...", "HTTPCode_Target_5XX_Count", ".", aws_lb.main.arn_suffix, { stat = "Sum", label = "5xx" }],
            ["...", "HTTPCode_Target_4XX_Count", ".", aws_lb.main.arn_suffix, { stat = "Sum", label = "4xx" }],
          ]
          view = "timeSeries", stacked = false, period = 60
        }
      },
      {
        type = "metric", x = 16, y = 0, width = 8, height = 6,
        properties = {
          title  = "ALB response time"
          region = local.region
          metrics = [
            ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", aws_lb.main.arn_suffix, { stat = "p50", label = "p50" }],
            ["...", "TargetResponseTime", ".", aws_lb.main.arn_suffix, { stat = "p99", label = "p99" }],
          ]
          view = "timeSeries", stacked = false, period = 60
        }
      },

      # -- Row 2: resource usage --------------------------------------------
      {
        type = "metric", x = 0, y = 6, width = 12, height = 6,
        properties = {
          title  = "ECS service: CPU / memory utilization"
          region = local.region
          metrics = [
            ["AWS/ECS", "CPUUtilization", "ServiceName", aws_ecs_service.api.name, "ClusterName", aws_ecs_cluster.main.name],
            ["...", "MemoryUtilization", ".", aws_ecs_service.api.name, ".", aws_ecs_cluster.main.name],
          ]
          view = "timeSeries", stacked = false, period = 60
        }
      },
      {
        type = "metric", x = 12, y = 6, width = 12, height = 6,
        properties = {
          title  = "ECS service: running vs desired tasks"
          region = local.region
          metrics = [
            ["ECS/ContainerInsights", "RunningTaskCount", "ServiceName", aws_ecs_service.api.name, "ClusterName", aws_ecs_cluster.main.name],
          ]
          view = "timeSeries", stacked = false, period = 60
        }
      },

      # -- Row 3: workflow runs (custom EMF metrics) ------------------------
      {
        type = "metric", x = 0, y = 12, width = 8, height = 6,
        properties = {
          title  = "Workflow runs: count by status"
          region = local.region
          metrics = [
            ["WorkPilot", "RunCount", "status", "completed", { stat = "Sum", label = "completed" }],
            ["WorkPilot", "RunCount", "status", "failed", { stat = "Sum", label = "failed" }],
          ]
          view = "timeSeries", stacked = true, period = 300
        }
      },
      {
        type = "metric", x = 8, y = 12, width = 8, height = 6,
        properties = {
          title  = "Run duration (all workflows)"
          region = local.region
          metrics = [
            ["WorkPilot", "RunDuration", { stat = "Average", label = "avg ms" }],
            ["WorkPilot", "RunDuration", { stat = "p99", label = "p99 ms" }],
          ]
          view = "timeSeries", stacked = false, period = 300
        }
      },
      {
        type = "metric", x = 16, y = 12, width = 8, height = 6,
        properties = {
          title  = "Run cost (USD)"
          region = local.region
          metrics = [
            ["WorkPilot", "RunCost", { stat = "Sum", label = "total $/period" }],
          ]
          view = "timeSeries", stacked = false, period = 300
        }
      },

      # -- Row 4: tools + model calls ----------------------------------------
      {
        type = "metric", x = 0, y = 18, width = 12, height = 6,
        properties = {
          title  = "Tool calls: count by outcome"
          region = local.region
          metrics = [
            ["WorkPilot", "ToolCallCount", "outcome", "invoked", { stat = "Sum", label = "invoked" }],
            ["...", "ToolCallCount", "outcome", "error", { stat = "Sum", label = "error" }],
            ["...", "ToolCallCount", "outcome", "not_configured", { stat = "Sum", label = "not configured" }],
          ]
          view = "timeSeries", stacked = true, period = 300
        }
      },
      {
        type = "metric", x = 12, y = 18, width = 12, height = 6,
        properties = {
          title  = "Model invocations: tokens & cost"
          region = local.region
          metrics = [
            ["WorkPilot", "ModelInputTokens", { stat = "Sum", label = "input tokens" }],
            ["WorkPilot", "ModelOutputTokens", { stat = "Sum", label = "output tokens" }],
            ["WorkPilot", "ModelCost", { stat = "Sum", label = "cost ($)", yAxis = "right" }],
          ]
          view = "timeSeries", stacked = false, period = 300
        }
      },

      # -- Row 5: logs — the three containers at a glance -------------------
      {
        type = "log", x = 0, y = 24, width = 24, height = 6,
        properties = {
          title  = "Recent errors (api + web + adot)"
          region = local.region
          query  = <<-QUERY
            SOURCE '${aws_cloudwatch_log_group.api.name}' | SOURCE '${aws_cloudwatch_log_group.web.name}' | SOURCE '${aws_cloudwatch_log_group.adot.name}'
            | fields @timestamp, @log, @message
            | filter @message like /(?i)(error|exception|traceback|failed)/
            | sort @timestamp desc
            | limit 50
          QUERY
          view = "table"
        }
      },
    ]
  })
}

# ──────────────────────────────────────────────────────────────────────────────
# Alarms — an SNS topic plus the handful of signals worth waking someone for.
# Subscribe an email/Slack integration to workpilot_alerts once you have one;
# an empty topic still lets the alarms exist and show state on the dashboard.
# ──────────────────────────────────────────────────────────────────────────────

resource "aws_sns_topic" "alerts" {
  name = "${local.project}-${local.env}-alerts"
}

resource "aws_cloudwatch_metric_alarm" "api_unhealthy" {
  alarm_name          = "${local.project}-${local.env}-api-unhealthy-targets"
  alarm_description   = "No healthy API target behind the ALB — the backend is down."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HealthyHostCount"
  dimensions          = { TargetGroup = aws_lb_target_group.api.arn_suffix, LoadBalancer = aws_lb.main.arn_suffix }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 2
  comparison_operator = "LessThanThreshold"
  threshold           = 1
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "web_unhealthy" {
  alarm_name          = "${local.project}-${local.env}-web-unhealthy-targets"
  alarm_description   = "No healthy web target behind the ALB — the UI is unreachable."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HealthyHostCount"
  dimensions          = { TargetGroup = aws_lb_target_group.web.arn_suffix, LoadBalancer = aws_lb.main.arn_suffix }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 2
  comparison_operator = "LessThanThreshold"
  threshold           = 1
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "high_5xx_rate" {
  alarm_name          = "${local.project}-${local.env}-high-5xx-rate"
  alarm_description   = "More than 10 upstream 5xx responses in a 5-minute window."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  dimensions          = { LoadBalancer = aws_lb.main.arn_suffix }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 10
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "run_failure_rate" {
  alarm_name          = "${local.project}-${local.env}-workflow-run-failures"
  alarm_description   = "More than 3 workflow runs have failed in a 15-minute window."
  namespace           = "WorkPilot"
  metric_name         = "RunCount"
  dimensions          = { status = "failed" }
  statistic           = "Sum"
  period              = 900
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 3
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

output "cloudwatch_dashboard_url" {
  description = "Direct link to the WorkPilot CloudWatch dashboard"
  value       = "https://${local.region}.console.aws.amazon.com/cloudwatch/home?region=${local.region}#dashboards:name=${local.dashboard_name}"
}

output "xray_traces_url" {
  description = "Direct link to the X-Ray trace list, pre-filtered to WorkPilot's service name"
  value       = "https://${local.region}.console.aws.amazon.com/xray/home?region=${local.region}#/traces?filter=service(%22workpilot-api%22)"
}

output "sns_alerts_topic_arn" {
  description = "Subscribe an email or chat integration here to receive alarm notifications"
  value       = aws_sns_topic.alerts.arn
}
