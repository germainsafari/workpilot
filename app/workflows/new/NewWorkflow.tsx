"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Blocks, Check, FileText, LayoutTemplate, LoaderCircle, PenLine, ShieldCheck, Sparkles, WandSparkles } from "lucide-react";
import { useState } from "react";
import { api, type ApiCompileResponse, type WorkflowCreatePayload } from "../../../lib/api";
import { templateCards } from "../../../lib/demo-data";
import {
  blankDefinition,
  countBusinessSteps,
  deriveWorkflowName,
  preparedSummary,
  templateDefinition,
  type CanonicalDefinition,
} from "../../../lib/workflow-draft";

export function NewWorkflow() {
  const router = useRouter();
  const [mode, setMode] = useState<"describe" | "template" | "visual">("describe");
  const [description, setDescription] = useState("Fetch my Scoro projects, summarize status, and flag anything that needs review.");
  const [prepared, setPrepared] = useState(false);
  const [draftDefinition, setDraftDefinition] = useState<CanonicalDefinition | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [compileResult, setCompileResult] = useState<ApiCompileResponse | null>(null);

  const resetDraft = () => {
    setPrepared(false);
    setDraftDefinition(null);
    setCompileResult(null);
    setError(null);
  };

  const prepareDraft = async () => {
    setCompiling(true);
    setError(null);
    try {
      const result = await api.workflows.compile(description.trim());
      setCompileResult(result);
      setDraftDefinition(result.definition as CanonicalDefinition);
      setPrepared(true);
      if (!result.ai_compiled) {
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not prepare this workflow");
    } finally {
      setCompiling(false);
    }
  };

  const createWorkflow = async (payload: WorkflowCreatePayload) => {
    setCreating(true);
    setError(null);
    try {
      const created = await api.workflows.create(payload);
      router.push(`/workflows/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create workflow");
      setCreating(false);
    }
  };

  const savePrepared = async () => {
    if (!draftDefinition) return;
    await createWorkflow({
      name: deriveWorkflowName(description),
      description: description.trim(),
      department: description.toLowerCase().includes("scoro") ? "Project operations" : "Operations",
      risk_level: "medium",
      definition: draftDefinition,
    });
  };

  const saveBlank = async () => {
    await createWorkflow({
      name: "Untitled workflow",
      description: "",
      department: "Operations",
      risk_level: "low",
      definition: blankDefinition(),
    });
  };

  const saveTemplate = async (name: string, category: string) => {
    setCreating(true);
    setError(null);
    try {
      const card = templateCards.find(([cardName]) => cardName === name);
      const processDescription = `${name}. ${card?.[2] ?? "Produce a useful, evidence-based business result using connected read-only tools."}`;
      await createWorkflow({
        name,
        description: processDescription,
        department: category,
        risk_level: name.toLowerCase().includes("invoice") ? "high" : "medium",
        definition: templateDefinition(name),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create this workflow");
      setCreating(false);
    }
  };

  const summary = draftDefinition ? preparedSummary(draftDefinition) : null;
  const stepCount = draftDefinition ? countBusinessSteps(draftDefinition) : 0;

  return (
    <div className="create-page">
      <Link href="/workflows" className="back-link"><ArrowLeft size={16} />Back to workflows</Link>
      <div className="create-heading"><span className="create-spark"><WandSparkles size={24} /></span><div><p className="eyebrow">Create a workflow</p><h1>What would you like to delegate?</h1><p>Start with everyday language, a proven template, or a blank canvas.</p></div></div>
      <div className="mode-tabs">
        <button className={mode === "describe" ? "active" : ""} onClick={() => { setMode("describe"); resetDraft(); }}><PenLine size={18} /><span><strong>Describe a process</strong><small>Write it in your own words</small></span></button>
        <button className={mode === "template" ? "active" : ""} onClick={() => { setMode("template"); resetDraft(); }}><LayoutTemplate size={18} /><span><strong>Use a template</strong><small>Start from a proven process</small></span></button>
        <button className={mode === "visual" ? "active" : ""} onClick={() => { setMode("visual"); resetDraft(); }}><Blocks size={18} /><span><strong>Build visually</strong><small>Arrange each step yourself</small></span></button>
      </div>

      {error && (
        <div className="modal-error" style={{ marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      {mode === "describe" && !prepared && <section className="create-card describe-card">
        <div className="field-heading"><label htmlFor="process-description">Describe what should happen</label><span>Plain language is perfect</span></div>
        <textarea id="process-description" value={description} onChange={(event) => setDescription(event.target.value)} />
        <div className="prompt-suggestions"><span>Try including:</span><button onClick={() => setDescription(`${description} Start when a form is submitted.`)}>what starts it</button><button onClick={() => setDescription(`${description} Ask Operations for approval.`)}>who approves</button><button onClick={() => setDescription(`${description} Notify the project owner at the end.`)}>who to notify</button></div>
        <div className="safe-note"><ShieldCheck size={18} /><span><strong>Nothing will run yet.</strong> You’ll review every step, permission, and safeguard before testing or publishing.</span></div>
        <button className="primary-button large-button" disabled={!description.trim() || compiling} onClick={prepareDraft}>
          {compiling ? <><LoaderCircle size={18} className="spin" />Reading connected tools…</> : <><Sparkles size={18} />Prepare workflow <ArrowRight size={17} /></>}
        </button>
      </section>}

      {mode === "describe" && prepared && summary && draftDefinition && <section className="create-card prepared-card">
        <div className="prepared-success"><span><Check size={20} /></span><div><p className="eyebrow">Draft prepared</p><h2>Your workflow is ready to review</h2><p>We found {stepCount} business step{stepCount === 1 ? "" : "s"}, bound {compileResult?.bound_tools.length ?? 0} connected tool{compileResult?.bound_tools.length === 1 ? "" : "s"}, and no live writes.</p></div></div>
        {compileResult?.rationale && !compileResult.ai_compiled && (
          <p className="safe-note"><ShieldCheck size={18} /><span>{compileResult.rationale}</span></p>
        )}
        {compileResult?.rationale && compileResult.ai_compiled && <p className="safe-note">{compileResult.rationale}</p>}
        <div className="prepared-summary">
          <div><FileText size={18} /><span><strong>Starts with</strong><small>{summary.starts}</small></span></div>
          <div><WandSparkles size={18} /><span><strong>Work performed</strong><small>{summary.work}</small></span></div>
          <div><ShieldCheck size={18} /><span><strong>Safeguard</strong><small>{summary.safeguard}</small></span></div>
        </div>
        <button className="primary-button large-button" disabled={creating} onClick={savePrepared}>
          {creating ? <><LoaderCircle size={18} className="spin" />Creating workflow…</> : <>Create workflow <ArrowRight size={17} /></>}
        </button>
      </section>}

      {mode === "template" && <section className="template-choice-grid">{templateCards.map(([name, category, summaryText]) => (
        <button key={name} className="template-card-button" disabled={creating} onClick={() => saveTemplate(name, category)}>
          <span className="template-icon"><LayoutTemplate size={19} /></span>
          <small>{category}</small>
          <strong>{name}</strong>
          <p>{summaryText}</p>
          <span className="text-link">{creating ? "Creating…" : "Use this template"} <ArrowRight size={15} /></span>
        </button>
      ))}</section>}

      {mode === "visual" && <section className="create-card visual-start"><Blocks size={32} /><h2>Start with a blank canvas</h2><p>Add a starting event and arrange each business step yourself. WorkPilot will still check permissions and risky actions before anything is published.</p><button className="primary-button" disabled={creating} onClick={saveBlank}>{creating ? <><LoaderCircle size={16} className="spin" />Creating…</> : <>Open blank canvas <ArrowRight size={16} /></>}</button></section>}
    </div>
  );
}
