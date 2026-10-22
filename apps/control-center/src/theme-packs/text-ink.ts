import {
  themeFirmwareTextMetrics, themeTextAlignedY, themeTextFit, themeTextValignBoxHeight,
  type ThemePrimitive,
} from "@/components/live-vibetv-preview";

export type Rect = { x: number; y: number; w: number; h: number };

// The rows of a glyph cell that carry ink in TFT_eSPI 2.5.43 Font16 (font 2) and Font32rle (font 4): caps, digits and
// ascenders reach the top, lowercase without ascenders starts at the x-height, g j p q y and brackets reach the
// descender. GLCD (font 1) fills its 8 rows. Within one row of the real glyphs.
function inkRows(text: string, font: number): [number, number] {
  if (font === 1) return [0, 7];
  const tall = /[^aceimnorsuvwxz ]/.test(text) ? (font === 4 ? 1 : 3) : 6;
  const low = /[gjpqy,;()[\]{}|]/.test(text) ? (font === 4 ? 24 : 15) : (font === 4 ? 18 : 12);
  return [tall, low];
}

export const cellHeight = (font: number) => (font === 4 ? 26 : font === 2 ? 16 : 8);

// What the text of a primitive paints: the cell width of the fitted lines, the rows that carry ink.
export function textInk(p: ThemePrimitive, text: string): Rect {
  const maxSize = p.s ?? 1, lane = p.w ?? 0;
  const { font, size, lines } = themeTextFit(text, p.f ?? 1, maxSize, lane, p.ft === "shrink", p.h ?? 0);
  const cell = cellHeight(font) * size;
  const width = Math.max(...lines.map((line) => themeFirmwareTextMetrics(line, font, size)?.width ?? line.length * cell * 0.6));
  const x = (p.x ?? 0) + (p.al === "right" ? lane - width : p.al === "center" ? (lane - width) / 2 : 0);
  const y = themeTextAlignedY(p.y ?? 0, themeTextValignBoxHeight(p.h ?? 0, p.f ?? 1, maxSize), cell * lines.length, p.va);
  const top = y + inkRows(lines[0], font)[0] * size;
  const bottom = y + cell * (lines.length - 1) + (inkRows(lines[lines.length - 1], font)[1] + 1) * size;
  return { x, y: top, w: width, h: bottom - top };
}
