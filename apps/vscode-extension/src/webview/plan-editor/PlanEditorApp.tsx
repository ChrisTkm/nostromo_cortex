import { useCallback, useEffect, useMemo, useState } from "react";
import type { ActionPlanRecord } from "@cortex/core";
import { AgentSelect, type CatalogAgent } from "../components/AgentSelect";

type PlanEditorMessage =
  | { type: "planEditor:load"; plan: ActionPlanRecord; agents: CatalogAgent[] }
  | { type: "planEditor:saved"; plan: ActionPlanRecord }
  | { type: "planEditor:appended"; plan: ActionPlanRecord }
  | { type: "planEditor:error"; message: string };

declare global {
  interface Window {
    acquireVsCodeApi(): {
      postMessage(message: unknown): void;
      setState(state: unknown): void;
      getState(): unknown;
    };
  }
}

const vscode = window.acquireVsCodeApi();

type PlanForm = {
  title: string;
  goal: string;
  description: string;
  author: string;
  assignedAgent: string;
  tags: string;
  notes: string;
};

function buildFormFromPlan(plan: ActionPlanRecord): PlanForm {
  return {
    title: plan.title ?? "",
    goal: plan.goal ?? "",
    description: plan.description ?? "",
    author: plan.author ?? "",
    assignedAgent: plan.assignedAgent ?? "",
    tags: Array.isArray(plan.tags) ? plan.tags.join(", ") : "",
    notes: plan.notes ?? "",
  };
}

function formChanged(a: PlanForm, b: PlanForm): boolean {
  return (
    a.title !== b.title ||
    a.goal !== b.goal ||
    a.description !== b.description ||
    a.author !== b.author ||
    a.assignedAgent !== b.assignedAgent ||
    a.tags !== b.tags
  );
}

export function PlanEditorApp() {
  const [plan, setPlan] = useState<ActionPlanRecord | null>(null);
  const [agents, setAgents] = useState<CatalogAgent[]>([]);
  const [form, setForm] = useState<PlanForm | null>(null);
  const [baseline, setBaseline] = useState<PlanForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appendText, setAppendText] = useState("");
  const [loading, setLoading] = useState(true);

  const isDirty = useMemo(
    () => form !== null && baseline !== null && formChanged(form, baseline),
    [form, baseline],
  );

  useEffect(() => {
    function onMessage(event: MessageEvent<PlanEditorMessage>) {
      const msg = event.data;
      if (!msg) return;

      if (msg.type === "planEditor:load") {
        setPlan(msg.plan);
        setAgents(msg.agents);
        const f = buildFormFromPlan(msg.plan);
        setForm(f);
        setBaseline(f);
        setError(null);
        setLoading(false);
      } else if (msg.type === "planEditor:saved" || msg.type === "planEditor:appended") {
        setPlan(msg.plan);
        const f = buildFormFromPlan(msg.plan);
        setForm(f);
        setBaseline(f);
        setError(null);
      } else if (msg.type === "planEditor:error") {
        setError(msg.message);
        setLoading(false);
      }
    }

    window.addEventListener("message", onMessage);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const handleSave = useCallback(() => {
    if (!form || !plan) return;
    const patch: Record<string, unknown> = {
      title: form.title.trim(),
      goal: form.goal.trim(),
      description: form.description.trim(),
      author: form.author.trim() || null,
      assignedAgent: form.assignedAgent || null,
      tags: form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    };
    vscode.postMessage({ type: "planEditor:save", planCode: plan.code, patch });
  }, [form, plan]);

  const handleAppendNote = useCallback(() => {
    if (!appendText.trim() || !plan) return;
    vscode.postMessage({ type: "planEditor:appendNote", planCode: plan.code, text: appendText.trim() });
    setAppendText("");
  }, [appendText, plan]);

  const handleViewGraph = useCallback(() => {
    vscode.postMessage({ type: "planEditor:viewGraph", planCode: plan?.code });
  }, [plan]);

  if (loading && !plan) {
    return (
      <div className="pe">
        <p>Loading plan...</p>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="pe">
        <p>No plan loaded.</p>
      </div>
    );
  }

  return (
    <div className="pe">
      <header className="pe__header">
        <h1 className="pe__title">{plan.code}</h1>
        <div className="pe__subtitle">Status: {plan.status}</div>
        <div className={`pe__status ${isDirty ? "pe__status--dirty" : "pe__status--saved"}`}>
          {isDirty ? "Unsaved changes" : "Saved"}
        </div>
      </header>

      {error ? <div className="pe__error">{error}</div> : null}

      <div className="pe__section">
        <div className="pe__section-title">Metadata</div>
        <label className="pe__field">
          <span className="pe__label">Title</span>
          <input
            className="pe__input"
            type="text"
            value={form?.title ?? ""}
            onChange={(e) => setForm((f) => (f ? { ...f, title: e.target.value } : f))}
          />
        </label>
        <label className="pe__field">
          <span className="pe__label">Goal</span>
          <textarea
            className="pe__textarea"
            value={form?.goal ?? ""}
            onChange={(e) => setForm((f) => (f ? { ...f, goal: e.target.value } : f))}
          />
        </label>
        <label className="pe__field">
          <span className="pe__label">Description</span>
          <textarea
            className="pe__textarea"
            value={form?.description ?? ""}
            onChange={(e) => setForm((f) => (f ? { ...f, description: e.target.value } : f))}
          />
        </label>
        <label className="pe__field">
          <span className="pe__label">Author</span>
          <input
            className="pe__input"
            type="text"
            value={form?.author ?? ""}
            onChange={(e) => setForm((f) => (f ? { ...f, author: e.target.value } : f))}
          />
        </label>
        <label className="pe__field">
          <span className="pe__label">Assigned Agent</span>
          <AgentSelect
            agents={agents}
            value={form?.assignedAgent ?? ""}
            onChange={(v) => setForm((f) => (f ? { ...f, assignedAgent: v } : f))}
          />
        </label>
        <label className="pe__field">
          <span className="pe__label">Tags</span>
          <input
            className="pe__input"
            type="text"
            value={form?.tags ?? ""}
            onChange={(e) => setForm((f) => (f ? { ...f, tags: e.target.value } : f))}
          />
          <span style={{ fontSize: 11, color: "var(--vscode-descriptionForeground)" }}>Comma-separated</span>
        </label>
      </div>

      <div className="pe__section">
        <div className="pe__section-title">Notes</div>
        <div className="pe__notes-list">
          {form?.notes ? (
            form.notes.split("\n").map((line, i) => (
              <div className="pe__note" key={i}>{line}</div>
            ))
          ) : (
            <div className="pe__note" style={{ opacity: 0.5 }}>No notes</div>
          )}
        </div>
        <div className="pe__append-row">
          <input
            className="pe__append-input"
            type="text"
            placeholder="Append note..."
            value={appendText}
            onChange={(e) => setAppendText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAppendNote(); }}
          />
          <button className="pe__btn" onClick={handleAppendNote} type="button">Append</button>
        </div>
      </div>

      <div className="pe__actions">
        <button className="pe__btn" disabled={!isDirty} onClick={handleSave} type="button">
          Save metadata
        </button>
        <button className="pe__btn pe__btn--secondary" onClick={handleViewGraph} type="button">
          View graph
        </button>
      </div>
    </div>
  );
}
