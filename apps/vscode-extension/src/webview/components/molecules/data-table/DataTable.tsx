import { useMemo, useRef, useState, type ReactNode } from "react";
import "./DataTable.css";

export type DataTableColumn<T> = {
  /** Stable key (also used as the width/sort identifier). */
  key: string;
  label: string;
  /** Initial column width in px. */
  width: number;
  /** Enable click-to-sort. Requires `sortValue`. */
  sortable?: boolean;
  align?: "left" | "right";
  /** Value used for sorting this column. */
  sortValue?: (row: T) => string | number;
  /** Cell renderer. */
  render: (row: T) => ReactNode;
};

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  empty?: ReactNode;
  className?: string;
}

const MIN_WIDTH = 56;

/**
 * Sortable + resizable data table shared by the list panels (plans, ledger,
 * …). Columns are config-driven: each supplies its own renderer and optional
 * sort accessor. Click a header to sort (toggles asc/desc); drag the right edge
 * to resize, double-click it to auto-fit to content.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  onRowClick,
  rowClassName,
  empty = "Sin datos",
  className,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(
    null,
  );
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    Object.fromEntries(columns.map((c) => [c.key, c.width])),
  );
  const tableRef = useRef<HTMLTableElement | null>(null);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    const getValue = col?.sortValue;
    if (!getValue) return rows;
    const arr = [...rows];
    arr.sort((a, b) => {
      const va = getValue(a);
      const vb = getValue(b);
      const cmp =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb));
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [rows, sort, columns]);

  function toggleSort(key: string) {
    setSort((prev) =>
      prev?.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  }

  function startResize(key: string, event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = widths[key] ?? MIN_WIDTH;
    const onMove = (e: MouseEvent) => {
      const next = Math.max(MIN_WIDTH, startWidth + e.clientX - startX);
      setWidths((w) => ({ ...w, [key]: next }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function autoFit(key: string, colIndex: number) {
    const table = tableRef.current;
    if (!table) return;
    let max = 0;
    table
      .querySelectorAll<HTMLElement>(
        `thead th:nth-child(${colIndex + 1}) .data-table__label, tbody td:nth-child(${colIndex + 1})`,
      )
      .forEach((cell) => {
        max = Math.max(max, cell.scrollWidth);
      });
    if (max > 0) {
      setWidths((w) => ({
        ...w,
        [key]: Math.min(640, Math.max(MIN_WIDTH, max + 28)),
      }));
    }
  }

  return (
    <table
      className={["data-table", className].filter(Boolean).join(" ")}
      ref={tableRef}
    >
      <colgroup>
        {columns.map((col) => (
          <col key={col.key} style={{ width: widths[col.key] }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {columns.map((col, index) => {
            const sortable = Boolean(col.sortable && col.sortValue);
            const active = sort?.key === col.key;
            return (
              <th
                aria-sort={
                  sortable && active
                    ? sort?.dir === "asc"
                      ? "ascending"
                      : "descending"
                    : undefined
                }
                className={`data-table__th${sortable ? " data-table__th--sortable" : ""}${active ? " data-table__th--active" : ""}${col.align === "right" ? " data-table__th--right" : ""}`}
                key={col.key}
                onClick={sortable ? () => toggleSort(col.key) : undefined}
              >
                <span className="data-table__label">{col.label}</span>
                {sortable ? (
                  <span className="data-table__arrow">
                    {active ? (sort?.dir === "asc" ? "▲" : "▼") : "↕"}
                  </span>
                ) : null}
                <span
                  className="data-table__resizer"
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={() => autoFit(col.key, index)}
                  onMouseDown={(e) => startResize(col.key, e)}
                  title="Arrastrar para redimensionar · doble clic para autoajustar"
                />
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {sortedRows.length === 0 ? (
          <tr>
            <td className="data-table__empty" colSpan={columns.length}>
              {empty}
            </td>
          </tr>
        ) : (
          sortedRows.map((row) => (
            <tr
              className={[
                "data-table__row",
                onRowClick ? "data-table__row--clickable" : "",
                rowClassName?.(row),
              ]
                .filter(Boolean)
                .join(" ")}
              key={getRowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((col) => (
                <td
                  className={
                    col.align === "right" ? "data-table__td--right" : undefined
                  }
                  key={col.key}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
