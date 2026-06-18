import { useCallback, useEffect, useMemo, useState } from "react";
import type { ActionPlanRecord, TaskRecord } from "@cortex/core";
import {
  AgentSelect,
  Button,
  Field,
  FilterSelect,
  Status,
  TextArea,
  TextInput,
  type CatalogAgent,
  type StatusTone,
} from "../components/atoms";
import { DrawerShell } from "../components/molecules";

const TASK_STATUS_TONE: Record<string, StatusTone> = {
  PENDING: "pending",
  IN_PROGRESS: "in-progress",
  BLOCKED: "blocked",
  DONE: "done",
  FAILED: "failed",
};

type PlanEditorMessage =
  | {
      type: "planEditor:load";
      plan: ActionPlanRecord;
      agents: CatalogAgent[];
      tasks?: TaskRecord[];
      allPlans?: ActionPlanRecord[];
    }
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
  project: string;
  product: string;
  release: string;
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
    project: plan.project ?? "",
    product: plan.product ?? "",
    release: plan.release ?? "",
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
    a.project !== b.project ||
    a.product !== b.product ||
    a.release !== b.release ||
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
      } else if (
        msg.type === "planEditor:saved" ||
        msg.type === "planEditor:appended"
      ) {
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
      project: form.project.trim() || null,
      product: form.product.trim() || null,
      release: form.release.trim() || null,
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
    vscode.postMessage({
      type: "planEditor:appendNote",
      planCode: plan.code,
      text: appendText.trim(),
    });
    setAppendText("");
  }, [appendText, plan]);

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
      <div className="plan-editor plan-editor--loading">
        <p>Loading plan...</p>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="plan-editor plan-editor--loading">
        <p>No plan loaded.</p>
      </div>
    );
  }

  const actions = (
    <div className="pe__top-actions">
      <div className="pe__top-tabs">
        <Button
          className={activeTab === "metadata" ? "is-active" : undefined}
          intent="change"
          onClick={() => setActiveTab("metadata")}
          size="small"
        >
          Plan
        </Button>
        <Button
          className={activeTab === "tasks" ? "is-active" : undefined}
          intent="change"
          onClick={() => setActiveTab("tasks")}
          size="small"
        >
          Tareas ({tasks.length})
        </Button>
      </div>
      <div className="pe__top-buttons">
        <Button
          disabled={!isDirty}
          intent="action"
          onClick={handleSave}
          size="small"
        >
          Guardar
        </Button>
      </div>
    </div>
  );

  const header = (
    <>
      <div className="drawer-header__code">{plan.code}</div>
      <h2 className="drawer-header__title">
        {form?.title.trim() || plan.title || plan.code}
      </h2>
      <div className="drawer-header__status">
        <Status tone={isDirty ? "blocked" : "done"}>
          {isDirty ? "Unsaved changes" : "Saved"}
        </Status>
        <span className="drawer-badge">{plan.status}</span>
      </div>
    </>
  );

  return (
    <div className="plan-editor">
      <DrawerShell actions={actions} header={header}>
        {error ? <div className="editor-error">{error}</div> : null}

        {activeTab === "metadata" && (
          <div className="drawer-panel">
            <section className="drawer-section drawer-section--spacious">
              <div className="drawer-section__label">Plan</div>
              <div className="editor-fields">
                <Field label="Title">
                  <TextInput
                    type="text"
                    value={form?.title ?? ""}
                    onChange={(e) =>
                      setForm((f) => (f ? { ...f, title: e.target.value } : f))
                    }
                  />
                </Field>
                <Field label="Goal">
                  <TextArea
                    value={form?.goal ?? ""}
                    onChange={(e) =>
                      setForm((f) => (f ? { ...f, goal: e.target.value } : f))
                    }
                  />
                </Field>
                <Field label="Description">
                  <TextArea
                    tall
                    value={form?.description ?? ""}
                    onChange={(e) =>
                      setForm((f) =>
                        f ? { ...f, description: e.target.value } : f,
                      )
                    }
                  />
                </Field>
              </div>
            </section>

            <section className="drawer-section drawer-section--spacious">
              <div className="drawer-section__label">Organización</div>
              <div className="editor-fields">
                <div className="editor-field-row">
                  <Field label="Product">
                    <TextInput
                      placeholder="cortex"
                      type="text"
                      value={form?.product ?? ""}
                      onChange={(e) =>
                        setForm((f) =>
                          f ? { ...f, product: e.target.value } : f,
                        )
                      }
                    />
                  </Field>
                  <Field label="Release">
                    <TextInput
                      placeholder="v0.1.6"
                      type="text"
                      value={form?.release ?? ""}
                      onChange={(e) =>
                        setForm((f) =>
                          f ? { ...f, release: e.target.value } : f,
                        )
                      }
                    />
                  </Field>
                </div>
                <div className="editor-field-row">
                  <Field label="Project">
                    <TextInput
                      placeholder="cortex/v0.1.6"
                      type="text"
                      value={form?.project ?? ""}
                      onChange={(e) =>
                        setForm((f) =>
                          f ? { ...f, project: e.target.value } : f,
                        )
                      }
                    />
                  </Field>
                  <Field label="Author">
                    <TextInput
                      type="text"
                      value={form?.author ?? ""}
                      onChange={(e) =>
                        setForm((f) =>
                          f ? { ...f, author: e.target.value } : f,
                        )
                      }
                    />
                  </Field>
                </div>
                <Field label="Assigned Agent">
                  <AgentSelect
                    agents={agents}
                    value={form?.assignedAgent ?? ""}
                    onChange={(v) =>
                      setForm((f) => (f ? { ...f, assignedAgent: v } : f))
                    }
                  />
                </Field>
                <Field label="Tags" hint="Comma-separated">
                  <TextInput
                    type="text"
                    value={form?.tags ?? ""}
                    onChange={(e) =>
                      setForm((f) => (f ? { ...f, tags: e.target.value } : f))
                    }
                  />
                </Field>
              </div>
            </section>

            <section className="drawer-section drawer-section--spacious">
              <div className="drawer-section__label">Notes</div>
              <div className="editor-fields">
                <div className="pe__notes-list">
                  {form?.notes ? (
                    form.notes.split("\n").map((line, i) => (
                      <div className="pe__note" key={i}>
                        {line}
                      </div>
                    ))
                  ) : (
                    <div className="pe__note pe__note--empty">No notes</div>
                  )}
                </div>
                <div className="pe__append-row">
                  <TextInput
                    type="text"
                    placeholder="Append note..."
                    value={appendText}
                    onChange={(e) => setAppendText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAppendNote();
                    }}
                  />
                  <Button
                    intent="change"
                    onClick={handleAppendNote}
                    size="small"
                  >
                    Append
                  </Button>
                </div>
              </div>
            </section>
          </div>
        )}

        {activeTab === "tasks" && (
          <div className="drawer-panel">
            <section className="drawer-section drawer-section--spacious">
              <div className="drawer-section__label">Tareas</div>
              <div className="editor-fields">
                {selectedCodes.size > 0 && (
                  <div className="pe__bulk-bar">
                    <span className="pe__bulk-count">
                      {selectedCodes.size} selected
                    </span>

                    <FilterSelect
                      onChange={(e) => setBulkStatus(e.target.value)}
                      value={bulkStatus}
                    >
                      <option value="">Set status...</option>
                      {STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </FilterSelect>
                    <Button
                      disabled={!bulkStatus}
                      intent="action"
                      onClick={handleBulkStatus}
                      size="small"
                    >
                      Apply
                    </Button>

                    <FilterSelect
                      onChange={(e) => setBulkAgent(e.target.value)}
                      value={bulkAgent}
                    >
                      <option value="">Set agent...</option>
                      {agents.map((a) => (
                        <option key={a.slug} value={a.slug}>
                          {a.displayName}
                        </option>
                      ))}
                    </FilterSelect>
                    <Button
                      disabled={!bulkAgent}
                      intent="action"
                      onClick={handleBulkAgent}
                      size="small"
                    >
                      Apply
                    </Button>

                    <FilterSelect
                      onChange={(e) => setBulkTargetPlan(e.target.value)}
                      value={bulkTargetPlan}
                    >
                      <option value="">Move to plan...</option>
                      {otherPlans.map((p) => (
                        <option key={p.code} value={p.code}>
                          {p.code} — {p.title}
                        </option>
                      ))}
                    </FilterSelect>
                    <Button
                      disabled={!bulkTargetPlan}
                      intent="action"
                      onClick={handleBulkMove}
                      size="small"
                    >
                      Move
                    </Button>

                    <Button
                      intent="danger"
                      onClick={handleBulkDelete}
                      size="small"
                    >
                      Delete
                    </Button>
                  </div>
                )}

                <div className="pe__tasks-toolbar">
                  <label className="pe__tasks-checkall">
                    <input
                      type="checkbox"
                      checked={
                        selectedCodes.size === tasks.length && tasks.length > 0
                      }
                      onChange={toggleSelectAll}
                    />
                    <span>Select all</span>
                  </label>
                  {selectedCodes.size > 0 && (
                    <Button
                      intent="change"
                      onClick={clearSelection}
                      size="small"
                    >
                      Clear selection
                    </Button>
                  )}
                </div>

                {tasks.length === 0 ? (
                  <div className="pe__tasks-empty">No tasks in this plan.</div>
                ) : (
                  <div className="pe__tasks-table-wrap">
                    <table className="pe__tasks-table">
                      <thead>
                        <tr>
                          <th style={{ width: 32 }}></th>
                          <th>Code</th>
                          <th>Tarea</th>
                          <th>Status</th>
                          <th>Agent</th>
                          <th>Severity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tasks.map((t) => (
                          <tr
                            key={t.code}
                            className={
                              selectedCodes.has(t.code) ? "pe__tr--selected" : ""
                            }
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
                              <Status
                                tone={TASK_STATUS_TONE[t.status] ?? "pending"}
                              >
                                {t.status}
                              </Status>
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
            </section>
          </div>
        )}
      </DrawerShell>
    </div>
  );
}
