import { describe, expect, it } from "vitest";
import { highlightLogText } from "./highlightText";

describe("highlightLogText", () => {
  it("returns plain text when query is empty", () => {
    const result = highlightLogText("hello world", "");
    expect(result).toBe("hello world");
  });

  it("wraps matching segments in mark.logs-highlight", () => {
    const result = highlightLogText("error loading file", "loading");
    const rendered = renderNodes(result);
    expect(rendered).toContain("<mark class=\"logs-highlight\">loading</mark>");
  });

  it("is case-insensitive", () => {
    const result = highlightLogText("ERROR FOUND", "error");
    const rendered = renderNodes(result);
    expect(rendered).toContain("<mark class=\"logs-highlight\">ERROR</mark>");
  });

  it("escapes regex special characters", () => {
    const result = highlightLogText("a.b [test]", "a.b");
    const rendered = renderNodes(result);
    expect(rendered).toContain("<mark class=\"logs-highlight\">a.b</mark>");
  });
});

function renderNodes(node: ReturnType<typeof highlightLogText>): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(renderSingle).join("");
  return "";
}

function renderSingle(node: any): string {
  if (typeof node === "string") return node;
  if (node === null || node === undefined) return "";
  if (node.props?.className === "logs-highlight") {
    return `<mark class="logs-highlight">${node.props.children}</mark>`;
  }
  return node.props?.children ?? "";
}
