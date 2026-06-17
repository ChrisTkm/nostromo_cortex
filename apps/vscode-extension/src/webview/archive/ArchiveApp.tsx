import { useDeferredValue, useEffect, useMemo, useState } from "react";

import type { ArchivedPlanSummary } from "../../service";
import { Button, Metric, Search } from "../components/atoms";
import {
  DataTable,
  type DataTableColumn,
  DrawerShell,
  Footer,
  Header,
  MultiSelect,
  SecondBar,
} from "../components/molecules";
import { Module } from "../components/organisms";

type TagMode = "AND" | "OR";

type ArchiveMessage = {
  type: "archive:list";
  plans: ArchivedPlanSummary[];
  archivePath?: string;
};

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

export function ArchiveApp() {
  const [plans, setPlans] = useState<ArchivedPlanSummary[]>([]);
  const [archivePath, setArchivePath] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [tagMode, setTagMode] = useState<TagMode>("AND");
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  useEffect(() => {
    function onMessage(event: MessageEvent<ArchiveMessage>) {
      const message = event.data;
      if (message?.type !== "archive:list" || !Array.isArray(message.plans)) {
        return;
      }
      setPlans(message.plans);
      setArchivePath(message.archivePath);
      setSelectedTags((current) =>
        current.filter((tag) =>
          message.plans.some((plan) => plan.tags.includes(tag)),
        ),
      );
      setSelectedCode((current) =>
        current && message.plans.some((plan) => plan.code === current)
          ? current
          : null,
      );
    }

    window.addEventListener("message", onMessage);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const tags = useMemo(
    () =>
      [...new Set(plans.flatMap((plan) => plan.tags))].sort((left, right) =>
        left.localeCompare(right),
      ),
    [plans],
  );

  const now = useMemo(() => Date.now(), [plans]);

  const filteredPlans = useMemo(() => {
    const filtered = plans.filter((plan) => {
      if (selectedTags.length > 0) {
        const matchesTag =
          tagMode === "AND"
            ? selectedTags.every((tag) => plan.tags.includes(tag))
            : selectedTags.some((tag) => plan.tags.includes(tag));
        if (!matchesTag) return false;
      }
      if (!deferredSearch) return true;
      return `${plan.code} ${plan.title}`
        .toLowerCase()
        .includes(deferredSearch);
    });

    // Default order: newest archived first. DataTable column headers override.
    return [...filtered].sort(
      (left, right) =>
        (right.archivedAt ?? "").localeCompare(left.archivedAt ?? "") ||
        left.code.localeCompare(right.code),
    );
  }, [deferredSearch, plans, selectedTags, tagMode]);

  const selectedPlan = useMemo(
    () =>
      selectedCode
        ? (filteredPlans.find((plan) => plan.code === selectedCode) ?? null)
        : null,
    [filteredPlans, selectedCode],
  );

  function toggleTag(tag: string) {
    setSelectedTags((current) =>
      current.includes(tag)
        ? current.filter((item) => item !== tag)
        : [...current, tag].sort(),
    );
  }

  const columns = useMemo<DataTableColumn<ArchivedPlanSummary>[]>(
    () => [
      {
        key: "code",
        label: "Código",
        width: 150,
        sortable: true,
        sortValue: (p) => p.code.toLowerCase(),
        render: (p) => <code className="archive-code">{p.code}</code>,
      },
      {
        key: "title",
        label: "Título",
        width: 300,
        sortable: true,
        sortValue: (p) => p.title.toLowerCase(),
        render: (p) => (
          <span className="archive-title-cell">
            <span>{p.title}</span>
            <span
              className={`archive-age-chip archive-age-chip--${bucketAge(p.archivedAt, now)}`}
            >
              {AGE_LABEL[bucketAge(p.archivedAt, now)]}
            </span>
          </span>
        ),
      },
      {
        key: "completed",
        label: "Completado",
        width: 150,
        sortable: true,
        sortValue: (p) => p.completedAt ?? "",
        render: (p) => formatDate(p.completedAt),
      },
      {
        key: "archived",
        label: "Archivado",
        width: 150,
        sortable: true,
        sortValue: (p) => p.archivedAt ?? "",
        render: (p) => formatDate(p.archivedAt),
      },
      {
        key: "tasks",
        label: "Tareas",
        width: 80,
        align: "right",
        sortable: true,
        sortValue: (p) => p.taskCount,
        render: (p) => p.taskCount,
      },
      {
        key: "notes",
        label: "Notas",
        width: 80,
        align: "right",
        sortable: true,
        sortValue: (p) => p.noteCount,
        render: (p) => p.noteCount,
      },
    ],
    [now],
  );

  const header = (
    <Header
      name="CORTEX ARCHIVE"
      external={Boolean(archivePath)}
      route={archivePath}
      actions={
        <>
          {archivePath ? (
            <Button
              intent="action"
              onClick={() => vscode.postMessage({ type: "archive:openFolder" })}
              size="small"
            >
              Open folder
            </Button>
          ) : null}
          <Button
            intent="refresh"
            onClick={() => vscode.postMessage({ type: "archive:refresh" })}
            size="small"
          >
            Refresh
          </Button>
        </>
      }
    />
  );

  const secondBar = (
    <SecondBar
      search={
        <Search
          className="archive-search"
          onChange={setSearch}
          placeholder="Search code or title..."
          value={search}
        />
      }
      filters={
        <div className="archive-filters">
          <div className="archive-group" aria-label="Tags">
            <span className="archive-group__label">Tags</span>
            <MultiSelect
              label="Tags"
              onNone={() => setSelectedTags([])}
              onToggle={toggleTag}
              options={tags.map((tag) => ({ value: tag, label: tag }))}
              selected={selectedTags}
            />
            <Button
              className={tagMode === "OR" ? "is-active" : undefined}
              intent="change"
              onClick={() =>
                setTagMode((current) => (current === "AND" ? "OR" : "AND"))
              }
              size="small"
              title={`Match mode for selected tags (current: ${tagMode})`}
            >
              {tagMode}
            </Button>
          </div>
        </div>
      }
    />
  );

  const footer = (
    <Footer
      left={
        <div className="archive-stats">
          <Metric label="Total">{plans.length}</Metric>
          <Metric label="Visibles">{filteredPlans.length}</Metric>
        </div>
      }
    />
  );

  const drawer = (
    selectedPlan ? (
      <ArchiveDetails
        isOpen={Boolean(selectedPlan)}
        onClose={() => setSelectedCode(null)}
        plan={selectedPlan}
      />
    ) : null
  );

  return (
    <Module
      drawer={drawer}
      footer={footer}
      header={header}
      secondBar={secondBar}
    >
      <div className="table-section">
        <DataTable
          className="archive-table"
          columns={columns}
          empty="No archived plans match."
          getRowKey={(p) => p.code}
          onRowClick={(p) => setSelectedCode(p.code)}
          rowClassName={(p) =>
            p.code === selectedCode ? "archive-row--selected" : undefined
          }
          rows={filteredPlans}
        />
      </div>
    </Module>
  );
}

function ArchiveDetails({
  isOpen,
  onClose,
  plan,
}: {
  isOpen: boolean;
  onClose: () => void;
  plan: ArchivedPlanSummary;
}) {
  const header = (
    <>
      <div className="drawer-header__code">{plan.code}</div>
      <h2 className="drawer-header__title">{plan.title}</h2>
      <div className="drawer-header__status">
        {plan.tags.length > 0 ? (
          plan.tags.map((tag) => (
            <span className="drawer-badge" key={tag}>
              {tag}
            </span>
          ))
        ) : (
          <span className="archive-muted">No tags</span>
        )}
      </div>
    </>
  );

  const actions = (
    <>
      <Button
        intent="change"
        onClick={() =>
          vscode.postMessage({
            type: "archive:restorePlan",
            planCode: plan.code,
          })
        }
        size="small"
      >
        Restore
      </Button>
      <Button
        intent="action"
        onClick={() =>
          vscode.postMessage({
            type: "archive:openJson",
            jsonPath: plan.jsonPath,
          })
        }
        size="small"
      >
        Open JSON
      </Button>
    </>
  );

  return (
    <DrawerShell
      actions={actions}
      className="archive-drawer"
      header={header}
      isOpen={isOpen}
      onClose={onClose}
    >
      {plan.description ? (
        <section className="archive-detail-section">
          <h2>Description</h2>
          <p className="archive-pre">{plan.description}</p>
        </section>
      ) : null}
      {plan.goal ? (
        <section className="archive-detail-section">
          <h2>Goal</h2>
          <p className="archive-pre">{plan.goal}</p>
        </section>
      ) : null}
      {plan.context ? (
        <section className="archive-detail-section">
          <h2>Context</h2>
          <p className="archive-pre">{plan.context}</p>
        </section>
      ) : null}
      <section className="archive-detail-section">
        <h2>Tasks</h2>
        <div className="archive-task-list">
          {plan.tasks.length === 0 ? (
            <div className="archive-muted">No archived tasks.</div>
          ) : null}
          {plan.tasks.map((task) => (
            <div className="archive-task" key={task.code}>
              <div className="archive-task__top">
                <span className="archive-code">{task.code}</span>
                {task.status ? (
                  <span className="drawer-badge">{task.status}</span>
                ) : null}
              </div>
              <div>{task.shortTask}</div>
              <div className="archive-muted">
                {task.completedAt
                  ? `completed ${formatDate(task.completedAt)}`
                  : "completion date unavailable"}
                {task.commitHash ? ` · ${task.commitHash}` : ""}
              </div>
              {task.completionNote ? <p>{task.completionNote}</p> : null}
            </div>
          ))}
        </div>
      </section>
      <section className="archive-detail-section">
        <h2>Notes</h2>
        <div className="archive-note-list">
          {plan.notes.length === 0 ? (
            <div className="archive-muted">No archived notes.</div>
          ) : null}
          {plan.notes.map((note, index) => (
            <article
              className="archive-note"
              key={`${note.title}:${note.createdAt ?? index}`}
            >
              <div className="archive-task__top">
                <strong>{note.title}</strong>
                <span className="archive-muted">
                  {formatDate(note.createdAt)}
                </span>
              </div>
              {note.tags.length > 0 ? (
                <div className="archive-tags">
                  {note.tags.map((tag) => (
                    <span className="drawer-badge" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
              <p>{note.body || "No body."}</p>
            </article>
          ))}
        </div>
      </section>
      <div className="archive-details__footer">
        <Button
          intent="danger"
          onClick={() =>
            vscode.postMessage({
              type: "archive:deletePlan",
              planCode: plan.code,
            })
          }
          size="small"
        >
          Delete archived plan
        </Button>
      </div>
    </DrawerShell>
  );
}

type AgeBucket = "today" | "week" | "month" | "older" | "unknown";

const AGE_LABEL: Record<AgeBucket, string> = {
  today: "Today",
  week: "7d",
  month: "30d",
  older: "Older",
  unknown: "Unknown",
};

function bucketAge(archivedAt: string | undefined, now: number): AgeBucket {
  if (!archivedAt) return "unknown";
  const parsed = Date.parse(archivedAt);
  if (Number.isNaN(parsed)) return "unknown";
  const diffMs = now - parsed;
  const day = 24 * 60 * 60 * 1000;
  if (diffMs < day) return "today";
  if (diffMs < 7 * day) return "week";
  if (diffMs < 30 * day) return "month";
  return "older";
}

function formatDate(value?: string) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}
