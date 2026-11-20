import type { WorkflowPalette } from "./types";

export interface PaletteDefinition {
  id: WorkflowPalette;
  name: string;
  inspiration: string;
  colors: {
    canvas: string;
    surface: string;
    node: string;
    decision: string;
    start: string;
    end: string;
    milestone: string;
    important: string;
    note: string;
    edge: string;
    branch: string;
    bundle: string;
    ink: string;
    muted: string;
  };
}

function parseHex(value: string) {
  const normalized = value.replace("#", "");
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

export function hexToRgba(value: string, alpha: number): string {
  const { r, g, b } = parseHex(value);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

export function mixHex(base: string, accent: string, amount: number): string {
  const left = parseHex(base);
  const right = parseHex(accent);
  const ratio = Math.max(0, Math.min(1, amount));
  const channel = (from: number, to: number) =>
    Math.round(from + (to - from) * ratio)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(left.r, right.r)}${channel(left.g, right.g)}${channel(
    left.b,
    right.b,
  )}`;
}

export const PALETTES: Record<WorkflowPalette, PaletteDefinition> = {
  default: {
    id: "default",
    name: "安静稿纸",
    inspiration: "原有纸面与鼠尾草绿配色",
    colors: {
      canvas: "#f5f2ec",
      surface: "#fffefa",
      node: "#fffefa",
      decision: "#f4ead7",
      start: "#dce9d5",
      end: "#dce9d5",
      milestone: "#f1d06a",
      important: "#d6532f",
      note: "#fff7c9",
      edge: "#918677",
      branch: "#c56d4e",
      bundle: "#b95d3f",
      ink: "#2f2c27",
      muted: "#80786c",
    },
  },
  bauhaus: {
    id: "bauhaus",
    name: "构成主义 · 蓝红黄",
    inspiration: "包豪斯运动红、黄、蓝基础构成配色",
    colors: {
      canvas: "#f2eadc",
      surface: "#fff9ee",
      node: "#fff9ee",
      decision: "#e8c665",
      start: "#174d8c",
      end: "#c23d2c",
      milestone: "#f2c230",
      important: "#e0522f",
      note: "#f4e6a4",
      edge: "#4d5763",
      branch: "#b83a2a",
      bundle: "#174d8c",
      ink: "#151b21",
      muted: "#58616b",
    },
  },
};

