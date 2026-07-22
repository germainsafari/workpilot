"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, Blocks, Check, FileText, LayoutTemplate, PenLine, ShieldCheck, Sparkles, WandSparkles } from "lucide-react";
import { useState } from "react";
import { templateCards } from "../../../lib/demo-data";

export function NewWorkflow() {
  const [mode, setMode] = useState<"describe" | "template" | "visual">("describe");
  const [description, setDescription] = useState("Every time a new client brief arrives, organize the requirements, check for missing details, ask the account manager to approve it, then prepare the project tasks.");
  const [prepared, setPrepared] = useState(false);

  return (
    <div className="create-page">
      <Link href="/workflows" className="back-link"><ArrowLeft size={16} />Back to workflows</Link>
      <div className="create-heading"><span className="create-spark"><WandSparkles size={24} /></span><div><p className="eyebrow">Create a workflow</p><h1>What would you like to delegate?</h1><p>Start with everyday language, a proven template, or a blank canvas.</p></div></div>
      <div className="mode-tabs">
        <button className={mode === "describe" ? "active" : ""} onClick={() => { setMode("describe"); setPrepared(false); }}><PenLine size={18} /><span><strong>Describe a process</strong><small>Write it in your own words</small></span></button>
        <button className={mode === "template" ? "active" : ""} onClick={() => { setMode("template"); setPrepared(false); }}><LayoutTemplate size={18} /><span><strong>Use a template</strong><small>Start from a proven process</small></span></button>
        <button className={mode === "visual" ? "active" : ""} onClick={() => { setMode("visual"); setPrepared(false); }}><Blocks size={18} /><span><strong>Build visually</strong><small>Arrange each step yourself</small></span></button>
      </div>
      {mode === "describe" && !prepared && <section className="create-card describe-card">
        <div className="field-heading"><label htmlFor="process-description">Describe what should happen</label><span>Plain language is perfect</span></div>
        <textarea id="process-description" value={description} onChange={(event) => setDescription(event.target.value)} />
        <div className="prompt-suggestions"><span>Try including:</span><button onClick={() => setDescription(`${description} Start when a form is submitted.`)}>what starts it</button><button onClick={() => setDescription(`${description} Ask Operations for approval.`)}>who approves</button><button onClick={() => setDescription(`${description} Notify the project owner at the end.`)}>who to notify</button></div>
        <div className="safe-note"><ShieldCheck size={18} /><span><strong>Nothing will run yet.</strong> You’ll review every step, permission, and safeguard before testing or publishing.</span></div>
        <button className="primary-button large-button" disabled={!description.trim()} onClick={() => setPrepared(true)}><Sparkles size={18} />Prepare workflow <ArrowRight size={17} /></button>
      </section>}
      {mode === "describe" && prepared && <section className="create-card prepared-card">
        <div className="prepared-success"><span><Check size={20} /></span><div><p className="eyebrow">Draft prepared</p><h2>Your workflow is ready to review</h2><p>We found six business steps, one approval, and no live writes.</p></div></div>
        <div className="prepared-summary">
          <div><FileText size={18} /><span><strong>Starts with</strong><small>A new client brief</small></span></div>
          <div><WandSparkles size={18} /><span><strong>Work performed</strong><small>Organize, check, and prepare</small></span></div>
          <div><ShieldCheck size={18} /><span><strong>Safeguard</strong><small>Account manager approval</small></span></div>
        </div>
        <Link href="/workflows/wf-client-brief" className="primary-button large-button">Review the visual workflow <ArrowRight size={17} /></Link>
      </section>}
      {mode === "template" && <section className="template-choice-grid">{templateCards.map(([name, category, summary], index) => <Link key={name} href={`/workflows/${index === 0 ? "wf-client-brief" : index === 1 ? "wf-meeting-actions" : index === 2 ? "wf-asset-review" : index === 3 ? "wf-project-health" : "wf-invoice-prep"}`}><span className="template-icon"><LayoutTemplate size={19} /></span><small>{category}</small><strong>{name}</strong><p>{summary}</p><span className="text-link">Use this template <ArrowRight size={15} /></span></Link>)}</section>}
      {mode === "visual" && <section className="create-card visual-start"><Blocks size={32} /><h2>Start with a blank canvas</h2><p>Add a starting event and arrange each business step yourself. WorkPilot will still check permissions and risky actions before anything is published.</p><Link href="/workflows/wf-client-brief?blank=true" className="primary-button">Open blank canvas <ArrowRight size={16} /></Link></section>}
    </div>
  );
}
