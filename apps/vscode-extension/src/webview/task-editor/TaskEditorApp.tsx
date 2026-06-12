import { TaskEditorForm } from "./components/TaskEditorForm";
import { useTaskEditorController } from "./hooks/useTaskEditorController";

export function TaskEditorApp() {
  const controller = useTaskEditorController();

  if (!controller.task || !controller.draft) {
    return (
      <div className="task-editor task-editor--loading">
        <p>Loading task...</p>
      </div>
    );
  }

  return (
    <TaskEditorForm
      agents={controller.agents}
      catalog={controller.catalog}
      draft={controller.draft}
      error={controller.error}
      isDirty={controller.isDirty}
      task={controller.task}
      onChange={controller.updateDraft}
      onSave={controller.handleSave}
      onCancel={controller.handleCancel}
      onReset={controller.handleReset}
    />
  );
}
