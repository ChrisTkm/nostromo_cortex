import type { AiAgentDocument } from "./types.js";

export const AI_AGENT_SEEDS: AiAgentDocument[] = [
  {
    slug: "codex",
    display_name: "Codex",
    vendor: "openai",
    model_family: "gpt-5-codex",
    icon_path: "codex.svg",
    active: true
  },
  {
    slug: "big-pickle",
    display_name: "Big Pickle",
    vendor: "big-pickle",
    icon_path: "big-pickle.svg",
    active: true
  },
  {
    slug: "claude",
    display_name: "Claude",
    vendor: "anthropic",
    icon_path: "claude.svg",
    active: true
  },
  {
    slug: "claude-code",
    display_name: "Claude Code",
    vendor: "anthropic",
    model_family: "claude-opus-4-7",
    icon_path: null,
    active: true
  },
  {
    slug: "copilot",
    display_name: "GitHub Copilot",
    vendor: "github",
    icon_path: "copilot.svg",
    active: true
  },
  {
    slug: "cursor",
    display_name: "Cursor",
    vendor: "cursor",
    icon_path: null,
    active: true
  },
  {
    slug: "gemini",
    display_name: "Gemini",
    vendor: "google",
    icon_path: "gemini.svg",
    active: true
  }
];
