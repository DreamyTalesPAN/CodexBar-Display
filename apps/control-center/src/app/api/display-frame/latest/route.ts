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
  v?: unknown;
  provider?: unknown;
  label?: unknown;
  session?: unknown;
  weekly?: unknown;
  resetSecs?: unknown;
  usageWindows?: unknown;
  usageSlots?: unknown;
  usageMode?: unknown;
  activity?: unknown;
  sessionTokens?: unknown;
  weekTokens?: unknown;
  totalTokens?: unknown;
};

type DisplayFrame = {
  v: 1 | 2;
  provider?: string;
  label?: string;
  session?: number;
  weekly?: number;
  resetSecs?: number;
  usageWindows?: UsageWindow[];
  usageSlots?: UsageSlot[];
  usageMode: "used" | "remaining";
  activity?: string;
  sessionTokens?: number;
  weekTokens?: number;
  totalTokens?: number;
};

type UsageWindow = {
  id: string;
  label: string;
  percent: number;
  resetSecs: number;
};
type UsageSlot = UsageWindow;

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
  const v = protocolVersion(raw.v);
  const frame: DisplayFrame = {
    v,
    usageMode: explicitUsageMode || "remaining",
  };
  const provider = safeText(raw.provider);
  const label = safeText(raw.label);
  const activity = safeText(raw.activity);
  let session = percent(raw.session);
  let weekly = percent(raw.weekly);
  let resetSecs = nonNegativeInteger(raw.resetSecs);
  const usageWindows = sanitizeUsageWindows(raw.usageWindows, defaultedToRemaining);
  const usageSlots = sanitizeUsageSlots(raw.usageSlots, defaultedToRemaining);
  const useUsageWindows =
    (v >= 2 && usageWindows.length > 0) ||
    (usageSlots.length === 0 && usageWindows.length > 0);
  const usageLanes = useUsageWindows ? usageWindows : usageSlots;
  const sessionTokens = nonNegativeInteger(raw.sessionTokens);
  const weekTokens = nonNegativeInteger(raw.weekTokens);
  const totalTokens = nonNegativeInteger(raw.totalTokens);

  if (defaultedToRemaining) {
    // Legacy Companion frames stored used percents, while the device renders them as remaining.
    session = invertPercent(session);
    weekly = invertPercent(weekly);
  }

  session ??= usageLanes[0]?.percent ?? null;
  weekly ??= usageLanes[1]?.percent ?? null;
  resetSecs ??= usageLanes[0]?.resetSecs ?? null;

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
  if (useUsageWindows) {
    frame.usageWindows = usageWindows;
  } else if (usageSlots.length > 0) {
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

function sanitizeUsageWindows(value: unknown, invert: boolean): UsageWindow[] {
  return sanitizeUsageLanes(value, invert);
}

function sanitizeUsageSlots(value: unknown, invert: boolean): UsageSlot[] {
  return sanitizeUsageLanes(value, invert, 2);
}

function sanitizeUsageLanes(
  value: unknown,
  invert: boolean,
  limit?: number,
): UsageWindow[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const lanes: UsageWindow[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }
    if (limit != null && lanes.length >= limit) {
      break;
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
    lanes.push({ id, label, percent: valuePercent, resetSecs });
  }
  return lanes;
}

function protocolVersion(value: unknown): 1 | 2 {
  return value === 2 ? 2 : 1;
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
