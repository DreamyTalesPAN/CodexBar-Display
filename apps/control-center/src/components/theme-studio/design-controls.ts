import type { ThemeStudioPrimitive } from "@/lib/theme-studio";
import { AI_THEME_SCREENMASTER_ASSET_PATH, isAttachedSceneAnimation } from "@/lib/ai-theme";
import { defaultPrimitive, primitiveBounds } from "./editor-geometry";

export const LIVE_READINGS = [
  ["session", "Session usage", "{session}%"],
  ["weekly", "Weekly usage", "{weekly}%"],
  ["usageMode", "Usage direction — used / remaining", "{usageMode}"],
  ["usageSlot1Percent", "First usage window — percentage", "{usageSlot1Percent}%"],
  ["usageSlot2Percent", "Second usage window — percentage", "{usageSlot2Percent}%"],
  ["usageSlot1Label", "First usage window — name", "{usageSlot1Label}"],
  ["usageSlot2Label", "Second usage window — name", "{usageSlot2Label}"],
  ["usageSlot1Reset", "First usage window — reset countdown", "Reset in {usageSlot1Reset}"],
  ["usageSlot2Reset", "Second usage window — reset countdown", "Reset in {usageSlot2Reset}"],
  ["providerSlot1Label", "First provider — name", "{providerSlot1Label}"],
  ["providerSlot2Label", "Second provider — name", "{providerSlot2Label}"],
  ["providerSlot1Percent", "First provider — usage", "{providerSlot1Percent}%"],
  ["providerSlot2Percent", "Second provider — usage", "{providerSlot2Percent}%"],
  ["providerSlot1Reset", "First provider — reset countdown", "{providerSlot1Reset}"],
  ["providerSlot2Reset", "Second provider — reset countdown", "{providerSlot2Reset}"],
  ["time", "Clock", "{time}"],
  ["date", "Date", "{date}"],
  ["provider", "Provider name", "{provider}"],
  ["label", "Account name", "{label}"],
  ["activity", "Activity", "{activity}"],
  ["sessionTokens", "Session tokens", "{sessionTokens}"],
  ["weekTokens", "Weekly tokens", "{weekTokens}"],
  ["totalTokens", "Total tokens", "{totalTokens}"],
] as const;

export function readingKey(p: ThemeStudioPrimitive) {
  return p.binding || p.text?.match(/\{([^}]+)\}/)?.[1] || "";
}

export function setReading(p: ThemeStudioPrimitive, key: string) {
  const reading = LIVE_READINGS.find(([id]) => id === key);
  if (!reading) return;
  delete p.binding;
  delete p.slot;
  delete p.providerSlot;
  delete p.usageIndex;
  p.text = reading[2];
  if (key === "session" || key.startsWith("usageSlot1")) p.slot = 1;
  if (key === "weekly" || key.startsWith("usageSlot2")) p.slot = 2;
  if (key.startsWith("providerSlot1")) p.providerSlot = 1;
  if (key.startsWith("providerSlot2")) p.providerSlot = 2;
}

export type AddElementKind = "text" | "progress" | "rect" | "time" | "reset" | "session" | "weekly" | "usageMode" | "reading";
export function createDesignElement(type: AddElementKind, count: number) {
  const p = defaultPrimitive(type === "progress" || type === "rect" ? type : "text", count);
  if (type === "progress") { p.binding = "usageSlot1Percent"; p.slot = 1; }
  if (!["text", "progress", "rect"].includes(type)) {
    setReading(p, type === "reset" ? "usageSlot1Reset" : type === "reading" ? "usageSlot1Label" : type);
    if (type === "reset" || type === "reading" || type === "usageMode") p.fontSize = 1;
  }
  return p;
}

export function isTypingTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']"));
}

export function pinnedElement(p: ThemeStudioPrimitive, all: ThemeStudioPrimitive[]) {
  return isAttachedSceneAnimation(p.assetPath) || (p.assetPath === AI_THEME_SCREENMASTER_ASSET_PATH && all.some((item) => isAttachedSceneAnimation(item.assetPath)));
}

export type DesignRow = { id: string; name: string; indices: number[]; y: number; locked: boolean };

// Only recognize explicit usage bindings and the labels in our generated layouts.
// Do not guess ownership for unrelated artwork or decorative shapes.
export function usageSectionIndices(all: ThemeStudioPrimitive[]): number[][] {
  const groups: number[][] = [[], []];
  all.forEach((p, i) => {
    if (p.type !== "text" && p.type !== "progress") return;
    const key = readingKey(p);
    const slot = key === "session" || key.startsWith("usageSlot1") ? 1 : key === "weekly" || key.startsWith("usageSlot2") ? 2 : p.slot;
    if (slot) groups[slot - 1].push(i);
  });
  all.forEach((p, i) => {
    if (groups.some((group) => group.includes(i)) || p.type !== "text") return;
    const text = p.text?.trim().toUpperCase();
    const key = readingKey(p);
    const candidates = groups.map((group, slot) => ({ slot, distance: Math.min(...group.map((n) => {
      const anchor = all[n];
      return Math.max(anchor.y - p.y, p.y - anchor.y - primitiveBounds(anchor).height, 0);
    })) }));
    candidates.sort((a, b) => a.distance - b.distance);
    const nearest = candidates[0];
    if (nearest.distance > 18 || nearest.distance === candidates[1].distance) return;
    if (key === "usageMode" || text === (nearest.slot === 0 ? "SESSION" : "WEEKLY")) groups[nearest.slot].push(i);
  });
  return groups;
}

export function swapRowPositions(all: ThemeStudioPrimitive[], a: number[], b: number[]) {
  if (!a.length || !b.length || a.some((i) => b.includes(i))) return false;
  if ([...a, ...b].some((i) => !all[i] || pinnedElement(all[i], all))) return false;
  const delta = Math.min(...b.map((i) => all[i].y)) - Math.min(...a.map((i) => all[i].y));
  const moves = [...a.map((i) => ({ i, dy: delta })), ...b.map((i) => ({ i, dy: -delta }))];
  if (!delta || moves.some(({ i, dy }) => all[i].y + dy < 0 || all[i].y + dy + primitiveBounds(all[i]).height > 240)) return false;
  moves.forEach(({ i, dy }) => { all[i].y += dy; });
  return true;
}

export function moveLayer(all: ThemeStudioPrimitive[], from: number, to: number) {
  if (!all[from] || !all[to] || from === to || pinnedElement(all[from], all) || pinnedElement(all[to], all)) return false;
  // Never place editable content beneath a pinned background/motion pair.
  const boundary = all.reduce((max, p, i) => pinnedElement(p, all) ? Math.max(max, i) : max, -1);
  if (Math.min(from, to) <= boundary) return false;
  all.splice(to, 0, all.splice(from, 1)[0]);
  return true;
}
