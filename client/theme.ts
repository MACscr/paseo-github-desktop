import type { PluginTheme } from "@getpaseo/plugin";
import { Platform } from "react-native";

export const MONO_FONT = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
});

export const DIFF_FONT_SIZE = 12;
export const DIFF_ROW_HEIGHT = 20;
/** Deliberately generous so rows never wrap inside their measured width. */
export const DIFF_CHAR_WIDTH = 7.6;

function parseColor(color: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(color.trim());
  if (hex) {
    let value = hex[1]!;
    if (value.length === 3 || value.length === 4) value = [...value.slice(0, 3)].map((c) => c + c).join("");
    if (value.length < 6) return null;
    return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)) as [number, number, number];
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(color.trim());
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

/** The color at the given opacity, or `fallback` when the color format is unknown. */
export function tint(color: string, alpha: number, fallback: string): string {
  const rgb = parseColor(color);
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : fallback;
}

export interface Palette {
  colors: PluginTheme["colors"];
  selected: string;
  addBg: string;
  addGutter: string;
  delBg: string;
  delGutter: string;
  hunkBg: string;
}

export function palette(theme: PluginTheme): Palette {
  const c = theme.colors;
  return {
    colors: c,
    selected: tint(c.accent, 0.18, c.surface2),
    addBg: tint(c.statusSuccess, 0.12, c.surface1),
    addGutter: tint(c.statusSuccess, 0.22, c.surface2),
    delBg: tint(c.statusDanger, 0.12, c.surface1),
    delGutter: tint(c.statusDanger, 0.22, c.surface2),
    hunkBg: tint(c.accent, 0.08, c.surface1),
  };
}
