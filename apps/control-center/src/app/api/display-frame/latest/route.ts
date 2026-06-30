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
  usageMode?: unknown;
  activity?: unknown;
  sessionTokens?: unknown;
  weekTokens?: unknown;
  totalTokens?: unknown;
  themeSpec?: unknown;
};

type DisplayFrame = {
  provider?: string;
  label?: string;
  session?: number;
  weekly?: number;
  resetSecs?: number;
  usageMode: "used" | "remaining";
  activity?: string;
  sessionTokens?: number;
  weekTokens?: number;
  totalTokens?: number;
  themeSpec?: Record<string, unknown>;
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
  const sessionTokens = nonNegativeInteger(raw.sessionTokens);
  const weekTokens = nonNegativeInteger(raw.weekTokens);
  const totalTokens = nonNegativeInteger(raw.totalTokens);
  const themeSpec = sanitizedThemeSpec(raw.themeSpec);

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
  if (sessionTokens != null) {
    frame.sessionTokens = sessionTokens;
  }
  if (weekTokens != null) {
    frame.weekTokens = weekTokens;
  }
  if (totalTokens != null) {
    frame.totalTokens = totalTokens;
  }
  if (themeSpec) {
    frame.themeSpec = themeSpec;
  }

  return frame;
}

function usageMode(value: unknown): "used" | "remaining" | null {
  return value === "used" || value === "remaining" ? value : null;
}

function safeText(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
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

function sanitizedThemeSpec(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  try {
    const raw = JSON.stringify(value);
    if (!raw || raw.length > 4096) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
