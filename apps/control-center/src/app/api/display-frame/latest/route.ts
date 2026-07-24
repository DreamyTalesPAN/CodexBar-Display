import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RawLastGoodFrame = {
  savedAt?: unknown;
  frame?: RawDisplayFrame;
};

type RawDisplayFrame = {
  provider?: unknown;
  label?: unknown;
  session?: unknown;
  weekly?: unknown;
  resetSecs?: unknown;
  usageSlots?: unknown;
  usageMode?: unknown;
  activity?: unknown;
  sessionTokens?: unknown;
  weekTokens?: unknown;
  totalTokens?: unknown;
};

type DisplayFrame = {
  provider?: string;
  label?: string;
  session?: number;
  weekly?: number;
  resetSecs?: number;
  usageSlots?: UsageSlot[];
  usageMode: "used" | "remaining";
  activity?: string;
  sessionTokens?: number;
  weekTokens?: number;
  totalTokens?: number;
};

type UsageSlot = {
  id: string;
  label: string;
  percent: number;
  resetSecs: number;
};

export async function GET() {
  try {
    const raw = JSON.parse(
      await readFile(path.join(displayStateDir(), "last-good-frame.json"), "utf8"),
    ) as RawLastGoodFrame;
    const frame = sanitizeFrame(raw.frame);
    if (!frame) {
      throw new Error("display frame unavailable");
    }

    return Response.json({
      ok: true,
      savedAt: typeof raw.savedAt === "string" ? raw.savedAt : undefined,
      source: "last-good-frame",
      frame,
    });
  } catch {
    return Response.json(
      { ok: false, error: "Display frame is not available." },
      { status: 404 },
    );
  }
}

function displayStateDir(): string {
  return (
    process.env.CONTROL_CENTER_DISPLAY_STATE_DIR ||
    path.join(os.homedir(), "Library", "Application Support", "codexbar-display")
  );
}

function sanitizeFrame(raw: RawDisplayFrame | undefined): DisplayFrame | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const explicitUsageMode = usageMode(raw.usageMode);
  const defaultedToRemaining = !explicitUsageMode;
  const frame: DisplayFrame = {
    usageMode: explicitUsageMode || "remaining",
  };
  const provider = safeText(raw.provider);
  const label = safeText(raw.label);
  const activity = safeText(raw.activity);
  let session = percent(raw.session);
  let weekly = percent(raw.weekly);
  const resetSecs = nonNegativeInteger(raw.resetSecs);
  const usageSlots = sanitizeUsageSlots(raw.usageSlots, defaultedToRemaining);
  const sessionTokens = nonNegativeInteger(raw.sessionTokens);
  const weekTokens = nonNegativeInteger(raw.weekTokens);
  const totalTokens = nonNegativeInteger(raw.totalTokens);

  if (defaultedToRemaining) {
    // Legacy Companion frames stored used percents, while the device renders them as remaining.
    session = invertPercent(session);
    weekly = invertPercent(weekly);
  }

  if (provider) {
    frame.provider = provider;
  }
  if (label) {
    frame.label = label;
  }
  if (activity) {
    frame.activity = activity;
  }
  if (session != null) {
    frame.session = session;
  }
  if (weekly != null) {
    frame.weekly = weekly;
  }
  if (resetSecs != null) {
    frame.resetSecs = resetSecs;
  }
  if (usageSlots.length > 0) {
    frame.usageSlots = usageSlots;
  }
  if (sessionTokens != null) {
    frame.sessionTokens = sessionTokens;
  }
  if (weekTokens != null) {
    frame.weekTokens = weekTokens;
  }
  if (totalTokens != null) {
    frame.totalTokens = totalTokens;
  }

  return frame;
}

function sanitizeUsageSlots(value: unknown, invert: boolean): UsageSlot[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const slots: UsageSlot[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || slots.length === 2) {
      continue;
    }
    const raw = candidate as Record<string, unknown>;
    const id = truncateUtf8Bytes(safeText(raw.id), 32);
    const label = truncateUtf8Bytes(safeText(raw.label), 24);
    let valuePercent = percent(raw.percent);
    const resetSecs = nonNegativeInteger(raw.resetSecs) ?? 0;
    if (!id || !label || valuePercent == null) {
      continue;
    }
    if (invert) {
      valuePercent = 100 - valuePercent;
    }
    slots.push({ id, label, percent: valuePercent, resetSecs });
  }
  return slots;
}

function usageMode(value: unknown): "used" | "remaining" | null {
  return value === "used" || value === "remaining" ? value : null;
}

function safeText(value: unknown): string {
  return typeof value === "string"
    ? Array.from(value.trim()).slice(0, 80).join("")
    : "";
}

export function truncateUtf8Bytes(value: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return "";
  }
  const encoder = new TextEncoder();
  let result = "";
  for (const character of value) {
    const candidate = `${result}${character}`;
    if (encoder.encode(candidate).byteLength > maxBytes) {
      break;
    }
    result = candidate;
  }
  return result.trimEnd();
}

function percent(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function invertPercent(value: number | null): number | null {
  return value == null ? null : 100 - value;
}

function nonNegativeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.round(value);
}
