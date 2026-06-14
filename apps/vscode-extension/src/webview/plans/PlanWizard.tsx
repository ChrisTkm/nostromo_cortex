import { useCallback, useMemo, useState } from "react";

import { AgentSelect, type CatalogAgent } from "../components/AgentSelect";

const PLAN_CODE_RE = /^[A-Z][A-Z0-9-]+$/;

type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

type TaskRow = {
  code: string;
  short_task: string;
  lane: string;
  severity: Severity;
  duration_estimate: number;
  agent: string;
};

export function PlanWizard(props: {
  agents: CatalogAgent[];
  onClose(): void;
  onCreate(plan: {
    code: string;
    title: string;
    description: string;
    goal: string;
    author: string;
    assignedAgent: string;
    tags: string[];
  }, tasks: TaskRow[]): void;
}) {
  const [step, setStep] = useState(1);

  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [goal, setGoal] = useState("");
  const [author, setAuthor] = useState("");
  const [assignedAgent, setAssignedAgent] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");

  const [taskCount, setTaskCount] = useState(5);
  const [codePrefix, setCodePrefix] = useState("");

  const codePrefixDefault = useMemo(() => {
    const words = code.split(/[^A-Za-z0-9]+/).filter(Boolean);
    return words.map((w) => w.charAt(0).toUpperCase()).join("") + "-T";
  }, [code]);

  const prefix = codePrefix || codePrefixDefault;

  const [tasks, setTasks] = useState<TaskRow[]>([]);

  if (tasks.length !== taskCount || (taskCount > 0 && tasks[0]?.code !== `${prefix}01`)) {
    const fresh = Array.from({ length: taskCount }, (_, i) => ({
      code: `${prefix}${String(i + 1).padStart(2, "0")}`,
      short_task: "",
      lane: "",
      severity: "MEDIUM" as Severity,
      duration_estimate: 0,
      agent: assignedAgent || "any",
    }));
    if (tasks.length !== fresh.length || tasks.some((t, i) => t.code !== fresh[i]!.code)) {
      setTasks(fresh);
    }
  }

  const codeError = code && !PLAN_CODE_RE.test(code) ? "Formato: mayúscula inicial, solo A-Z, 0-9 y guiones" : "";

  const canStep1 = code.trim().length > 0 && title.trim().length > 0 && !codeError;
  const canStep2 = taskCount >= 1 && taskCount <= 50;
  const canStep3 = tasks.length > 0 && tasks.every((t) => t.short_task.trim().length > 0);

  const handleCreate = useCallback(() => {
    if (!canStep3) return;
    props.onCreate(
      {
        code: code.trim(),
        title: title.trim(),
        description: description.trim(),
        goal: goal.trim(),
        author: author.trim(),
        assignedAgent,
        tags: tagsRaw
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      },
      tasks,
    );
  }, [canStep3, props, code, title, description, goal, author, assignedAgent, tagsRaw, tasks]);

  const updateTask = useCallback((index: number, patch: Partial<TaskRow>) => {
    setTasks((prev) => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  }, []);

  return (
    <div className="pw-overlay" onClick={props.onClose}>
      <div className="pw" onClick={(e) => e.stopPropagation()}>
        <header className="pw__header">
          <h2 className="pw__title">Nuevo Plan</h2>
          <span className="pw__step-indicator">Paso {step} de 3</span>
          <button className="pw__close" onClick={props.onClose} type="button">&times;</button>
        </header>

        <div className="pw__body">
          {step === 1 && (
            <div className="pw__step">
              <label className="pw__field">
                <span className="pw__label">Código *</span>
                <input className={`pw__input ${codeError ? "pw__input--error" : ""}`} type="text" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="MI-PLAN-001" />
                {codeError ? <span className="pw__error-text">{codeError}</span> : null}
              </label>
              <label className="pw__field">
                <span className="pw__label">Título *</span>
                <input className="pw__input" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Mi plan demo" />
              </label>
              <label className="pw__field">
                <span className="pw__label">Descripción</span>
                <textarea className="pw__textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
              </label>
              <label className="pw__field">
                <span className="pw__label">Goal</span>
                <textarea className="pw__textarea" value={goal} onChange={(e) => setGoal(e.target.value)} />
              </label>
              <label className="pw__field">
                <span className="pw__label">Autor</span>
                <input className="pw__input" type="text" value={author} onChange={(e) => setAuthor(e.target.value)} />
              </label>
              <label className="pw__field">
                <span className="pw__label">Agente asignado</span>
                <AgentSelect agents={props.agents} value={assignedAgent} onChange={setAssignedAgent} />
              </label>
              <label className="pw__field">
                <span className="pw__label">Tags</span>
                <input className="pw__input" type="text" value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} placeholder="comma-separated" />
              </label>
            </div>
          )}

          {step === 2 && (
            <div className="pw__step">
              <label className="pw__field">
                <span className="pw__label">Cantidad de tareas (1-50)</span>
                <input className="pw__input" type="number" min={1} max={50} value={taskCount} onChange={(e) => setTaskCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} />
              </label>
              <label className="pw__field">
                <span className="pw__label">Prefijo de código</span>
                <input className="pw__input" type="text" value={prefix} onChange={(e) => setCodePrefix(e.target.value)} placeholder={codePrefixDefault} />
                <span className="pw__hint">Ej: <strong>{prefix}01</strong>, <strong>{prefix}02</strong>, ...</span>
              </label>
            </div>
          )}

          {step === 3 && (
            <div className="pw__step">
              <div className="pw__grid-scroll">
                <table className="pw__grid">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Short task *</th>
                      <th>Lane</th>
                      <th>Severidad</th>
                      <th>Dur. est. (h)</th>
                      <th>Agente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((t, i) => (
                      <tr key={i}>
                        <td><code className="pw__code">{t.code}</code></td>
                        <td>
                          <input className="pw__cell-input" type="text" value={t.short_task} onChange={(e) => updateTask(i, { short_task: e.target.value })} placeholder="Descripción corta" />
                        </td>
                        <td>
                          <input className="pw__cell-input" type="text" value={t.lane} onChange={(e) => updateTask(i, { lane: e.target.value })} placeholder="backend" />
                        </td>
                        <td>
                          <select className="pw__cell-select" value={t.severity} onChange={(e) => updateTask(i, { severity: e.target.value as Severity })}>
                            <option value="LOW">LOW</option>
                            <option value="MEDIUM">MEDIUM</option>
                            <option value="HIGH">HIGH</option>
                            <option value="CRITICAL">CRITICAL</option>
                          </select>
                        </td>
                        <td>
                          <input className="pw__cell-input pw__cell-input--num" type="number" min={0} step={0.5} value={t.duration_estimate || ""} onChange={(e) => updateTask(i, { duration_estimate: Number(e.target.value) || 0 })} />
                        </td>
                        <td>
                          <AgentSelect agents={props.agents} value={t.agent} onChange={(v) => updateTask(i, { agent: v })} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <footer className="pw__footer">
          {step > 1 ? (
            <button className="pw__btn pw__btn--secondary" onClick={() => setStep((s) => s - 1)} type="button">
              Anterior
            </button>
          ) : <div />}
          {step < 3 ? (
            <button className="pw__btn" disabled={step === 1 ? !canStep1 : !canStep2} onClick={() => setStep((s) => s + 1)} type="button">
              Siguiente
            </button>
          ) : (
            <button className="pw__btn pw__btn--primary" disabled={!canStep3} onClick={handleCreate} type="button">
              Crear Plan ({tasks.length} tareas)
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
