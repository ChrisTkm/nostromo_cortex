import { useCallback, useEffect, useMemo, useState } from "react";
import type { ActionPlanRecord, TaskRecord } from "@cortex/core";
import { AgentSelect, type CatalogAgent } from "../components/AgentSelect";
import { PageHeader } from "../components/PageHeader";

type PlanEditorMessage =
  | { type: "planEditor:load"; plan: ActionPlanRecord; agents: CatalogAgent[]; tasks?: TaskRecord[]; allPlans?: ActionPlanRecord[] }
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

const STATUS_OPTIONS = [
  { value: "PENDING", label: "Pending" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "BLOCKED", label: "Blocked" },
  { value: "DONE", label: "Done" },
  { value: "FAILED", label: "Failed" },
];

type Tab = "metadata" | "tasks";

export function PlanEditorApp() {
  const [plan, setPlan] = useState<ActionPlanRecord | null>(null);
  const [agents, setAgents] = useState<CatalogAgent[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [allPlans, setAllPlans] = useState<ActionPlanRecord[]>([]);
  const [form, setForm] = useState<PlanForm | null>(null);
  const [baseline, setBaseline] = useState<PlanForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appendText, setAppendText] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("metadata");
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkAgent, setBulkAgent] = useState("");
  const [bulkTargetPlan, setBulkTargetPlan] = useState("");

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
        setTasks(msg.tasks ?? []);
        setAllPlans(msg.allPlans ?? []);
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

  const toggleSelect = useCallback((code: string) => {
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedCodes((prev) => {
      if (prev.size === tasks.length) return new Set();
      return new Set(tasks.map((t) => t.code));
    });
  }, [tasks]);

  const clearSelection = useCallback(() => setSelectedCodes(new Set()), []);

  const handleBulkStatus = useCallback(() => {
    if (!bulkStatus || selectedCodes.size === 0) return;
    vscode.postMessage({
      type: "planEditor:bulkStatus",
      planCode: plan?.code,
      codes: Array.from(selectedCodes),
      status: bulkStatus,
    });
    setSelectedCodes(new Set());
    setBulkStatus("");
  }, [bulkStatus, selectedCodes, plan]);

  const handleBulkAgent = useCallback(() => {
    if (!bulkAgent || selectedCodes.size === 0) return;
    vscode.postMessage({
      type: "planEditor:bulkAgent",
      planCode: plan?.code,
      codes: Array.from(selectedCodes),
      agent: bulkAgent,
    });
    setSelectedCodes(new Set());
    setBulkAgent("");
  }, [bulkAgent, selectedCodes, plan]);

  const handleBulkMove = useCallback(() => {
    if (!bulkTargetPlan || selectedCodes.size === 0) return;
    vscode.postMessage({
      type: "planEditor:bulkMove",
      planCode: plan?.code,
      codes: Array.from(selectedCodes),
      targetPlanCode: bulkTargetPlan,
    });
    setSelectedCodes(new Set());
    setBulkTargetPlan("");
  }, [bulkTargetPlan, selectedCodes, plan]);

  const handleBulkDelete = useCallback(() => {
    if (selectedCodes.size === 0) return;
    vscode.postMessage({
      type: "planEditor:bulkDelete",
      planCode: plan?.code,
      codes: Array.from(selectedCodes),
    });
    setSelectedCodes(new Set());
  }, [selectedCodes, plan]);

  const otherPlans = useMemo(
    () => allPlans.filter((p) => p.code !== plan?.code),
    [allPlans, plan],
  );

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

  const statusClass = (status: string) => {
    switch (status) {
      case "PENDING": return "pts--pending";
      case "IN_PROGRESS": return "pts--in-progress";
      case "BLOCKED": return "pts--blocked";
      case "DONE": return "pts--done";
      case "FAILED": return "pts--failed";
      default: return "";
    }
  };

  return (
    <div className="pe">
      <PageHeader
        title="CORTEX PLAN EDITOR"
        subtitle={`${plan.code} · ${plan.status}`}
        actions={
          <span className={`pe__status ${isDirty ? "pe__status--dirty" : "pe__status--saved"}`}>
            {isDirty ? "Unsaved changes" : "Saved"}
          </span>
        }
      />

      {error ? <div className="pe__error">{error}</div> : null}

      <div className="pe__tabs">
        <button
          className={`pe__tab ${activeTab === "metadata" ? "pe__tab--active" : ""}`}
          onClick={() => setActiveTab("metadata")}
          type="button"
        >
          Metadata
        </button>
        <button
          className={`pe__tab ${activeTab === "tasks" ? "pe__tab--active" : ""}`}
          onClick={() => setActiveTab("tasks")}
          type="button"
        >
          Tasks ({tasks.length})
        </button>
      </div>

      {activeTab === "metadata" && (
        <>
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
        </>
      )}

      {activeTab === "tasks" && (
        <div className="pe__section">
          <div className="pe__section-title">Tasks</div>

          {selectedCodes.size > 0 && (
            <div className="pe__bulk-bar">
              <span className="pe__bulk-count">{selectedCodes.size} selected</span>

              <select
                className="pe__bulk-select"
                value={bulkStatus}
                onChange={(e) => setBulkStatus(e.target.value)}
              >
                <option value="">Set status...</option>
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <button
                className="pe__btn pe__bulk-apply"
                disabled={!bulkStatus}
                onClick={handleBulkStatus}
                type="button"
              >
                Apply
              </button>

              <select
                className="pe__bulk-select"
                value={bulkAgent}
                onChange={(e) => setBulkAgent(e.target.value)}
              >
                <option value="">Set agent...</option>
                {agents.map((a) => (
                  <option key={a.slug} value={a.slug}>{a.displayName}</option>
                ))}
              </select>
              <button
                className="pe__btn pe__bulk-apply"
                disabled={!bulkAgent}
                onClick={handleBulkAgent}
                type="button"
              >
                Apply
              </button>

              <select
                className="pe__bulk-select"
                value={bulkTargetPlan}
                onChange={(e) => setBulkTargetPlan(e.target.value)}
              >
                <option value="">Move to plan...</option>
                {otherPlans.map((p) => (
                  <option key={p.code} value={p.code}>{p.code} — {p.title}</option>
                ))}
              </select>
              <button
                className="pe__btn pe__bulk-apply"
                disabled={!bulkTargetPlan}
                onClick={handleBulkMove}
                type="button"
              >
                Move
              </button>

              <button
                className="pe__btn pe__btn--danger pe__bulk-delete"
                onClick={handleBulkDelete}
                type="button"
              >
                Delete
              </button>
            </div>
          )}

          <div className="pe__tasks-toolbar">
            <label className="pe__tasks-checkall">
              <input
                type="checkbox"
                checked={selectedCodes.size === tasks.length && tasks.length > 0}
                onChange={toggleSelectAll}
              />
              <span>Select all</span>
            </label>
            {selectedCodes.size > 0 && (
              <button className="pe__btn-clear" onClick={clearSelection} type="button">
                Clear selection
              </button>
            )}
          </div>

          {tasks.length === 0 ? (
            <div style={{ opacity: 0.5, padding: "12px 0" }}>No tasks in this plan.</div>
          ) : (
            <div className="pe__tasks-table-wrap">
              <table className="pe__tasks-table">
                <thead>
                  <tr>
                    <th style={{ width: 32 }}></th>
                    <th>Code</th>
                    <th>Task</th>
                    <th>Status</th>
                    <th>Agent</th>
                    <th>Severity</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t) => (
                    <tr
                      key={t.code}
                      className={selectedCodes.has(t.code) ? "pe__tr--selected" : ""}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedCodes.has(t.code)}
                          onChange={() => toggleSelect(t.code)}
                        />
                      </td>
                      <td className="pe__td-code">{t.code}</td>
                      <td>{t.shortTask}</td>
                      <td>
                        <span className={`pts ${statusClass(t.status)}`}>{t.status}</span>
                      </td>
                      <td>{t.agent}</td>
                      <td>{t.severity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
