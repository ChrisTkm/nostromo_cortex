import { useState } from "react";
import type { TaskRecord } from "@cortex/core";

import { TASK_STATUSES_LOCAL, TASK_SEVERITIES_LOCAL } from "../types";
import type { TaskEditorDraft } from "../types";
import { AgentSelect } from "../../components/AgentSelect";

export function TaskEditorForm(props: {
  agents: CatalogAgent[];
  catalog: string[];
  draft: TaskEditorDraft;
  error: string | null;
  isDirty: boolean;
  task: TaskRecord;
  onChange(patch: Partial<TaskEditorDraft>): void;
  onSave(): void;
  onCancel(): void;
  onReset(): void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const statusLabel = props.isDirty ? "Unsaved changes" : "Saved";
  const statusTone = props.isDirty ? "task-editor__status--dirty" : "task-editor__status--saved";

  return (
    <div className="task-editor">
      <header className="task-editor__header">
        <div>
          <div className="task-editor__eyebrow">Edit task</div>
          <h2 className="task-editor__title">{props.draft.shortTask.trim() || props.draft.code}</h2>
          <div className={`task-editor__status ${statusTone}`}>{statusLabel}</div>
        </div>
        <div className="task-editor__actions">
          <button className="te-button te-button--primary" onClick={props.onSave} type="button">
            Save
          </button>
          <button className="te-button" disabled={!props.isDirty} onClick={props.onReset} type="button">
            Reset
          </button>
          <button className="te-button" onClick={props.onCancel} type="button">
            Cancel
          </button>
        </div>
      </header>

      {props.error ? <div className="task-editor__error">{props.error}</div> : null}

      <div className="task-editor__layout">
        <section className="task-editor__group">
          <div className="task-editor__group-header">
            <div className="task-editor__group-title">Identity</div>
          </div>
          <label className="task-editor__field">
            <span className="task-editor__label">Code</span>
            <input className="te-input" readOnly type="text" value={props.draft.code} />
          </label>
        </section>

        <section className="task-editor__group">
          <div className="task-editor__group-header">
            <div className="task-editor__group-title">Core</div>
          </div>
          <label className="task-editor__field">
            <span className="task-editor__label">
              Title <span className="task-editor__required">*</span>
            </span>
            <input
              className="te-input"
              onChange={(e) => props.onChange({ shortTask: e.target.value })}
              placeholder="Short task title"
              type="text"
              value={props.draft.shortTask}
            />
          </label>
          <label className="task-editor__field">
            <span className="task-editor__label">Detail</span>
            <textarea
              className="te-textarea te-textarea--tall"
              onChange={(e) => props.onChange({ detail: e.target.value })}
              placeholder="Detailed description..."
              value={props.draft.detail}
            />
          </label>
          <div className="task-editor__field-row">
            <label className="task-editor__field">
              <span className="task-editor__label">
                Status <span className="task-editor__required">*</span>
              </span>
              <select
                className="te-select"
                onChange={(e) => props.onChange({ status: e.target.value as TaskEditorDraft["status"] })}
                value={props.draft.status}
              >
                {TASK_STATUSES_LOCAL.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="task-editor__field">
              <span className="task-editor__label">
                Severity <span className="task-editor__required">*</span>
              </span>
              <select
                className="te-select"
                onChange={(e) => props.onChange({ severity: e.target.value as TaskEditorDraft["severity"] })}
                value={props.draft.severity}
              >
                {TASK_SEVERITIES_LOCAL.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="task-editor__field">
            <span className="task-editor__label">
              Agent <span className="task-editor__required">*</span>
            </span>
            <AgentSelect
              agents={props.agents}
              value={props.draft.agent}
              onChange={(v) => props.onChange({ agent: v })}
            />
          </label>
        </section>

        <section className="task-editor__group">
          <div className="task-editor__group-header">
            <div className="task-editor__group-title">Organization</div>
          </div>
          <div className="task-editor__field-row">
            <label className="task-editor__field">
              <span className="task-editor__label">Project</span>
              <input
                className="te-input"
                onChange={(e) => props.onChange({ project: e.target.value })}
                placeholder="project name (empty → null)"
                type="text"
                value={props.draft.project}
              />
            </label>
            <label className="task-editor__field">
              <span className="task-editor__label">Lane / Group</span>
              <input
                className="te-input"
                onChange={(e) => props.onChange({ lane: e.target.value })}
                placeholder="lane name (empty → null)"
                type="text"
                value={props.draft.lane}
              />
            </label>
          </div>
          <div className="task-editor__field-row">
            <label className="task-editor__field">
              <span className="task-editor__label">Duration estimate (h)</span>
              <input
                className="te-input"
                min="0"
                onChange={(e) => props.onChange({ durationEstimate: e.target.value })}
                placeholder="hours (empty → null)"
                step="0.5"
                type="number"
                value={props.draft.durationEstimate}
              />
            </label>
          </div>
          <label className="task-editor__field">
            <span className="task-editor__label">Tags</span>
            <input
              className="te-input"
              onChange={(e) => props.onChange({ tags: e.target.value })}
              placeholder="tag-a, tag-b"
              type="text"
              value={props.draft.tags}
            />
            <span className="task-editor__field-hint">Comma-separated</span>
          </label>
          <label className="task-editor__field">
            <span className="task-editor__label">Depends on</span>
            <input
              className="te-input"
              list="task-editor-catalog"
              onChange={(e) => props.onChange({ dependsOn: e.target.value })}
              placeholder="TASK-1, TASK-2"
              type="text"
              value={props.draft.dependsOn}
            />
            <datalist id="task-editor-catalog">
              {props.catalog
                .filter((code) => code !== props.draft.code)
                .map((code) => (
                  <option key={code} value={code} />
                ))}
            </datalist>
            <span className="task-editor__field-hint">Comma-separated task codes. Validated against catalog.</span>
          </label>
        </section>

        <section className="task-editor__group task-editor__group--collapsible">
          <button
            className="task-editor__collapse-toggle"
            onClick={() => setAdvancedOpen((o) => !o)}
            type="button"
          >
            <span className={`task-editor__collapse-arrow${advancedOpen ? " task-editor__collapse-arrow--open" : ""}`}>&#9662;</span>
            <span className="task-editor__group-title">Avanzado</span>
          </button>
          {advancedOpen ? (
            <div className="task-editor__collapse-body">
              <label className="task-editor__field">
                <span className="task-editor__label">Source ref</span>
                <input
                  className="te-input"
                  onChange={(e) => props.onChange({ sourceRef: e.target.value })}
                  placeholder="PR, ticket, or URL (empty → null)"
                  type="text"
                  value={props.draft.sourceRef}
                />
              </label>
              <label className="task-editor__field">
                <span className="task-editor__label">Prompt</span>
                <textarea
                  className="te-textarea te-textarea--tall"
                  onChange={(e) => props.onChange({ prompt: e.target.value })}
                  placeholder="LLM prompt for this task... (empty → null)"
                  value={props.draft.prompt}
                />
              </label>
              <label className="task-editor__field">
                <span className="task-editor__label">Acceptance criteria</span>
                <textarea
                  className="te-textarea te-textarea--tall"
                  onChange={(e) => props.onChange({ acceptance: e.target.value })}
                  placeholder="How to verify this task is done... (empty → null)"
                  value={props.draft.acceptance}
                />
              </label>
              <label className="task-editor__field">
                <span className="task-editor__label">Out of scope</span>
                <textarea
                  className="te-textarea"
                  onChange={(e) => props.onChange({ outOfScope: e.target.value })}
                  placeholder="Explicitly excluded from this task... (empty → null)"
                  value={props.draft.outOfScope}
                />
              </label>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
