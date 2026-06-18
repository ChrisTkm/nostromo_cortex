import { useEffect, useRef, useState } from "react";
import type { TaskRecord } from "@cortex/core";

import { TASK_STATUSES_LOCAL, TASK_SEVERITIES_LOCAL } from "../types";
import type { TaskEditorDraft } from "../types";
import {
  AgentSelect,
  Button,
  Field,
  FilterSelect,
  Status,
  TextArea,
  TextInput,
  type CatalogAgent,
} from "../../components/atoms";
import { DrawerShell } from "../../components/molecules";

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
  const advancedSectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!advancedOpen) return;
    advancedSectionRef.current?.scrollIntoView({
      block: "start",
      behavior: "smooth",
    });
  }, [advancedOpen]);

  const actions = (
    <>
      <Button intent="action" onClick={props.onSave} size="small">
        Guardar
      </Button>
      <Button
        disabled={!props.isDirty}
        intent="change"
        onClick={props.onReset}
        size="small"
      >
        Restablecer
      </Button>
    </>
  );

  const header = (
    <>
      <div className="drawer-header__code">EDITAR TAREA</div>
      <h2 className="drawer-header__title">
        {props.draft.shortTask.trim() || props.draft.code}
      </h2>
      <div className="drawer-header__status">
        <Status tone={props.isDirty ? "blocked" : "done"}>
          {props.isDirty ? "Cambios sin guardar" : "Guardado"}
        </Status>
      </div>
    </>
  );

  return (
    <DrawerShell actions={actions} header={header} onClose={props.onCancel}>
      <div className="drawer-panel">
        {props.error ? (
          <section className="drawer-section drawer-section--spacious">
            <div className="drawer-section__label">Error</div>
            <div className="drawer-section__text editor-error">
              {props.error}
            </div>
          </section>
        ) : null}

        <section className="drawer-section drawer-section--spacious">
          <div className="drawer-section__label">Identidad</div>
          <div className="editor-fields">
            <Field label="Código">
              <TextInput
                readOnly
                type="text"
                value={props.draft.code}
              />
            </Field>
          </div>
        </section>

        <section className="drawer-section drawer-section--spacious">
          <div className="drawer-section__label">Principal</div>
          <div className="editor-fields">
            <Field label="Título" required>
              <TextInput
                onChange={(e) => props.onChange({ shortTask: e.target.value })}
                placeholder="Título corto de la tarea"
                type="text"
                value={props.draft.shortTask}
              />
            </Field>
            <Field label="Detalle">
              <TextArea
                onChange={(e) => props.onChange({ detail: e.target.value })}
                placeholder="Descripción detallada..."
                tall
                value={props.draft.detail}
              />
            </Field>
            <div className="editor-field-row">
              <Field label="Estado" required>
                <FilterSelect
                  onChange={(e) =>
                    props.onChange({
                      status: e.target.value as TaskEditorDraft["status"],
                    })
                  }
                  value={props.draft.status}
                >
                  {TASK_STATUSES_LOCAL.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                    ))}
                </FilterSelect>
              </Field>
              <Field label="Severidad" required>
                <FilterSelect
                  onChange={(e) =>
                    props.onChange({
                      severity: e.target.value as TaskEditorDraft["severity"],
                    })
                  }
                  value={props.draft.severity}
                >
                  {TASK_SEVERITIES_LOCAL.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                    ))}
                </FilterSelect>
              </Field>
            </div>
            <Field label="Agente" required>
              <AgentSelect
                agents={props.agents}
                value={props.draft.agent}
                onChange={(v) => props.onChange({ agent: v })}
              />
            </Field>
          </div>
        </section>

        <section className="drawer-section drawer-section--spacious">
          <div className="drawer-section__label">Organización</div>
          <div className="editor-fields">
            <div className="editor-field-row">
              <Field label="Proyecto">
                <TextInput
                  onChange={(e) => props.onChange({ project: e.target.value })}
                  placeholder="nombre del proyecto (vacío → null)"
                  type="text"
                  value={props.draft.project}
                />
              </Field>
              <Field label="Carril / Grupo">
                <TextInput
                  onChange={(e) => props.onChange({ lane: e.target.value })}
                  placeholder="nombre del carril (vacío → null)"
                  type="text"
                  value={props.draft.lane}
                />
              </Field>
            </div>
            <div className="editor-field-row">
              <Field label="Estimación (h)">
                <TextInput
                  min="0"
                  onChange={(e) =>
                    props.onChange({ durationEstimate: e.target.value })
                  }
                  placeholder="horas (vacío → null)"
                  step="0.5"
                  type="number"
                  value={props.draft.durationEstimate}
                />
              </Field>
            </div>
            <Field label="Etiquetas" hint="Separadas por coma">
              <TextInput
                onChange={(e) => props.onChange({ tags: e.target.value })}
                placeholder="tag-a, tag-b"
                type="text"
                value={props.draft.tags}
              />
            </Field>
            <Field
              label="Depende de"
              hint="Códigos de tarea separados por coma. Validados contra el catálogo."
            >
              <TextInput
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
            </Field>
          </div>
        </section>

        <section
          className="drawer-section drawer-section--spacious"
          ref={advancedSectionRef}
        >
          <Button
            className={`editor-collapse-toggle${advancedOpen ? " is-active" : ""}`}
            intent="change"
            onClick={() => setAdvancedOpen((o) => !o)}
            size="small"
            type="button"
          >
            <span
              className={`editor-collapse-arrow${advancedOpen ? " editor-collapse-arrow--open" : ""}`}
            >
              &#9662;
            </span>
            <span className="drawer-section__label">Avanzado</span>
          </Button>
          {advancedOpen ? (
            <div className="editor-fields">
              <Field label="Referencia">
                <TextInput
                  onChange={(e) =>
                    props.onChange({ sourceRef: e.target.value })
                  }
                  placeholder="PR, ticket o URL (vacío → null)"
                  type="text"
                  value={props.draft.sourceRef}
                />
              </Field>
              <Field label="Prompt">
                <TextArea
                  onChange={(e) => props.onChange({ prompt: e.target.value })}
                  placeholder="Prompt LLM para esta tarea... (vacío → null)"
                  tall
                  value={props.draft.prompt}
                />
              </Field>
              <Field label="Criterios de aceptación">
                <TextArea
                  onChange={(e) =>
                    props.onChange({ acceptance: e.target.value })
                  }
                  placeholder="Cómo verificar que la tarea está lista... (vacío → null)"
                  tall
                  value={props.draft.acceptance}
                />
              </Field>
              <Field label="Fuera de alcance">
                <TextArea
                  onChange={(e) =>
                    props.onChange({ outOfScope: e.target.value })
                  }
                  placeholder="Explícitamente excluido de esta tarea... (vacío → null)"
                  value={props.draft.outOfScope}
                />
              </Field>
            </div>
          ) : null}
        </section>
      </div>
    </DrawerShell>
  );
}
