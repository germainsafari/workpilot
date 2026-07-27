"use client";

import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import type { WorkflowSummary } from "../../../lib/types";
import { apiDetailToSummary } from "../../../lib/workflow-mapper";
import { WorkflowEditor } from "./WorkflowEditor";

export function WorkflowDetailLoader({
  id,
  fallback,
}: {
  id: string;
  fallback?: WorkflowSummary;
}) {
  const [workflow, setWorkflow] = useState<WorkflowSummary | null>(fallback ?? null);
  const [loading, setLoading] = useState(!fallback);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMissing(false);

    Promise.all([api.workflows.get(id), api.runs.list().catch(() => [])])
      .then(([detail, runs]) => {
        if (cancelled) return;
        setWorkflow(apiDetailToSummary(detail, runs));
      })
      .catch(() => {
        if (cancelled) return;
        if (fallback) {
          setWorkflow(fallback);
        } else {
          setMissing(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, fallback]);

  if (loading && !workflow) {
    return (
      <div className="page" style={{ display: "grid", placeItems: "center", minHeight: "40vh", gap: "0.75rem" }}>
        <LoaderCircle size={28} className="spin" />
        <p style={{ color: "var(--muted)" }}>Loading workflow…</p>
      </div>
    );
  }

  if (missing || !workflow) {
    return (
      <div className="page">
        <div className="empty-state">
          <h3>Workflow not found</h3>
          <p>This workflow doesn’t exist or you don’t have access to it.</p>
          <Link href="/workflows" className="primary-button">Back to workflows</Link>
        </div>
      </div>
    );
  }

  return <WorkflowEditor workflow={workflow} />;
}
