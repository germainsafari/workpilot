"use client";

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Copy,
  Hash,
  LoaderCircle,
  Play,
  Workflow as WorkflowIcon,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, formatDuration, formatRelativeTime, runWorkflowLabel, type ApiRun } from "../../lib/api";
import { StatusPill } from "./StatusPill";

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function RunDetailsDrawer({
  runId,
  fallback,
  onClose,
}: {
  runId: string;
  fallback?: ApiRun;
  onClose: () => void;
}) {
  const [run, setRun] = useState<ApiRun | null>(fallback ?? null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.runs
      .get(runId)
      .then((r) => {
        if (alive) setRun(r);
      })
      .catch((err) => {
        if (alive && !fallback) setError(err instanceof Error ? err.message : "Could not load run");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [runId, fallback]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const copyTrace = () => {
    if (!run?.trace_id) return;
    navigator.clipboard?.writeText(run.trace_id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const steps = run?.steps ?? [];
  const aiSteps = steps.filter((s) => s.model_usage && Object.keys(s.model_usage).length > 0);

  return (
    <>
      <button className="drawer-backdrop" onClick={onClose} aria-label="Close run details" />
      <div className="test-drawer run-drawer" role="dialog" aria-modal="true" aria-label="Run details">
        <div className="test-head">
          <div>
            <span className="safe-test-icon">
              <Play size={17} />
            </span>
            <div>
              <p>Run details</p>
              <h2>#{runId.slice(-8)}</h2>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {loading && !run ? (
          <div className="empty-state" style={{ padding: "2rem" }}>
            <LoaderCircle size={26} className="spin" />
            <p>Loading run…</p>
          </div>
        ) : error && !run ? (
          <div className="empty-state" style={{ padding: "2rem" }}>
            <AlertTriangle size={26} />
            <h3>Could not load run</h3>
            <p>{error}</p>
          </div>
        ) : run ? (
          <div className="run-drawer-body">
            <div className="run-summary-grid">
              <div>
                <small>Status</small>
                <StatusPill status={run.status} />
              </div>
              <div>
                <small>Started</small>
                <strong>{formatRelativeTime(run.started_at)}</strong>
              </div>
              <div>
                <small>Duration</small>
                <strong>{formatDuration(run.started_at, run.finished_at)}</strong>
              </div>
              <div>
                <small>Trigger</small>
                <strong>{run.trigger_type}</strong>
              </div>
            </div>

            <div className="run-stat-row">
              <span>
                <CircleDollarSign size={15} />${run.total_cost.toFixed(5)} AI cost
              </span>
              <span>
                <CheckCircle2 size={15} />
                {steps.length} steps
              </span>
              <span>
                <Clock3 size={15} />
                {run.token_usage.toLocaleString()} tokens
              </span>
            </div>

            <Link href={`/workflows/${run.workflow_id}`} className="run-workflow-link">
              <WorkflowIcon size={16} />
              <span>
                <strong>{runWorkflowLabel(run)}</strong>
                <small>Open workflow · {run.workflow_id}</small>
              </span>
            </Link>

            {run.error_summary && (
              <div className="modal-error" style={{ margin: "0 17px 12px" }}>
                <AlertTriangle size={14} /> {run.error_summary}
              </div>
            )}

            <div className="run-steps-heading">Step-by-step activity</div>
            <div className="test-steps">
              {steps.length === 0 && (
                <p style={{ color: "var(--muted)", fontSize: "0.8rem", padding: "0.5rem 0" }}>
                  No step activity recorded for this run yet.
                </p>
              )}
              {steps.map((step, index) => {
                const done = step.status === "completed";
                const usage = step.model_usage ?? {};
                const provider = usage.provider ? String(usage.provider) : null;
                const isOpen = openStep === step.id;
                const hasDetail =
                  (step.input_data && Object.keys(step.input_data).length > 0) ||
                  (step.output_data && Object.keys(step.output_data).length > 0);
                return (
                  <div className={done ? "test-step done" : "test-step"} key={step.id}>
                    <span>{done ? <Check size={15} /> : index + 1}</span>
                    <div style={{ flex: 1 }}>
                      <button
                        className="run-step-toggle"
                        onClick={() => setOpenStep(isOpen ? null : step.id)}
                        disabled={!hasDetail}
                      >
                        <strong>{step.step_id}</strong>
                        <small>
                          {step.status}
                          {provider ? ` · ${provider}` : ""} · {formatDuration(step.started_at, step.finished_at)}
                        </small>
                      </button>
                      {isOpen && hasDetail && (
                        <div className="run-step-detail">
                          {step.input_data && Object.keys(step.input_data).length > 0 && (
                            <>
                              <span>Input</span>
                              <pre>{prettyJson(step.input_data)}</pre>
                            </>
                          )}
                          {step.output_data && Object.keys(step.output_data).length > 0 && (
                            <>
                              <span>Output</span>
                              <pre>{prettyJson(step.output_data)}</pre>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    {provider && <b>${Number(usage.cost_usd ?? 0).toFixed(5)}</b>}
                  </div>
                );
              })}
            </div>

            <div className="run-drawer-footer">
              <button className="text-link" onClick={copyTrace} title="Copy trace ID for CloudWatch / X-Ray">
                {copied ? <Check size={14} /> : <Copy size={14} />}
                <Hash size={13} />
                {run.trace_id ? `${run.trace_id.slice(0, 16)}…` : "no trace id"}
              </button>
              <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
                <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
                  {aiSteps.length} AI step{aiSteps.length === 1 ? "" : "s"}
                </span>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
