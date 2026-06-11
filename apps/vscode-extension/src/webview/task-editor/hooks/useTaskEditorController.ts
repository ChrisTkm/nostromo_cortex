import type { TaskRecord } from "@cortex/core";
import { useEffect, useEffectEvent, useMemo, useState } from "react";

import { areDraftsEqual, buildSavePayload, createDraftFromTask, handleCancelLogic } from "../lib/drafts";
import type { CatalogAgent, TaskEditorDraft, TaskEditorMessage } from "../types";

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

export function useTaskEditorController() {
  const [task, setTask] = useState<TaskRecord | null>(null);
  const [catalog, setCatalog] = useState<string[]>([]);
  const [agents, setAgents] = useState<CatalogAgent[]>([]);
  const [draft, setDraft] = useState<TaskEditorDraft | null>(null);
  const [baseline, setBaseline] = useState<TaskEditorDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isDirty = useMemo(
    () => draft !== null && baseline !== null && !areDraftsEqual(draft, baseline),
    [draft, baseline]
  );

  const handleMessage = useEffectEvent((message: TaskEditorMessage) => {
    if (message.type === "taskEditor:load") {
      setTask(message.task);
      setCatalog(message.catalog.taskCodes);
      setAgents(message.catalog.agents);
      const d = createDraftFromTask(message.task);
      setDraft(d);
      setBaseline(d);
      setError(null);
    }
  });

  useEffect(() => {
    vscode.postMessage({ type: "ready" });
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent<TaskEditorMessage>) {
      const msg = event.data;
      if (!msg) {
        return;
      }
      handleMessage(msg);
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [handleMessage]);

  function updateDraft(patch: Partial<TaskEditorDraft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    if (error) {
      setError(null);
    }
  }

  function handleSave() {
    if (!draft || !task) {
      return;
    }
    const result = buildSavePayload(draft, task, catalog);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    vscode.postMessage({ type: "taskEditor:save", input: result.input });
  }

  function handleCancel() {
    handleCancelLogic(isDirty, (msg) => vscode.postMessage(msg), (msg) => window.confirm(msg));
  }

  function handleReset() {
    if (baseline) {
      setDraft(baseline);
      setError(null);
    }
  }

  return {
    task,
    catalog,
    agents,
    draft,
    isDirty,
    error,
    updateDraft,
    handleSave,
    handleCancel,
    handleReset
  };
}
