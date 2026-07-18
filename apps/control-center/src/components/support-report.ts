import type {
  SupportDiagnostics,
  SupportReportClientState,
} from "./control-center-types";

export async function collectSupportReport(
  loadDiagnostics: () => Promise<SupportDiagnostics>,
  state: SupportReportClientState,
): Promise<SupportDiagnostics> {
  const generatedAt = new Date().toISOString();
  const client = {
    environment: readClientEnvironment(),
    state,
  };

  try {
    const diagnostics = await loadDiagnostics();
    return {
      ...diagnostics,
      generatedAt: diagnostics.generatedAt || generatedAt,
      client,
    };
  } catch (error) {
    return {
      ok: false,
      schemaVersion: 2,
      reportType: "control_center_fallback",
      generatedAt,
      client,
      collectionErrors: [
        {
          source: "Mac App diagnostics",
          message: safeErrorMessage(error),
        },
      ],
      checks: [
        {
          name: "companion_api",
          status: "fail",
          detail: "The Mac App diagnostics endpoint could not be reached.",
          errorCode: "companion_diagnostics_unreachable",
          nextAction: "Attach this report so support can inspect the setup state.",
        },
      ],
    };
  }
}

export function serializeSupportReport(report: SupportDiagnostics): string {
  return JSON.stringify(redactSensitiveValues(report), null, 2);
}

export function downloadSupportReport(report: SupportDiagnostics): void {
  const blob = new Blob([serializeSupportReport(report)], {
    type: "application/json;charset=utf-8",
  });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = supportReportFilename(report.generatedAt);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

export function supportReportFilename(value?: string): string {
  const timestamp = value ? new Date(value) : new Date();
  const safeTimestamp = Number.isNaN(timestamp.getTime())
    ? "session"
    : timestamp.toISOString().replace(/[:.]/g, "-");
  return `vibetv-support-report-${safeTimestamp}.json`;
}

function readClientEnvironment() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {};
  }
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    online: navigator.onLine,
    viewport: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    visibility: document.visibilityState,
    page: `${window.location.origin}${window.location.pathname}`,
  };
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Mac App diagnostics are unavailable.";
}

function redactSensitiveValues(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSensitiveValues);
  }
  if (typeof value === "string") {
    return redactSensitiveText(value);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      isSensitiveKey(key) && typeof entry !== "boolean"
        ? "[redacted]"
        : redactSensitiveValues(entry),
    ]),
  );
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
  if (normalized === "token" || normalized === "api_key") {
    return true;
  }
  return /(^|_)(authorization|cookie|password|secret|access_token|refresh_token|device_token|pairing_token)($|_)/.test(
    normalized,
  );
}

function redactSensitiveText(value: string): string {
  return value
    .replace(
      /([a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:)[^@/\s]+@/gi,
      "$1[redacted]@",
    )
    .replace(/(\b(?:bearer|basic)\s+)[^\s,;}]+/gi, "$1[redacted]")
    .replace(
      /((?:^|[\s,{])["']?(?:[a-z0-9.]+[_-])*(?:authorization|cookie|password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|device[_-]?token|pairing[_-]?token|token)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gim,
      "$1[redacted]",
    )
    .replace(
      /([?&](?:token|api[_-]?key|access[_-]?token|refresh[_-]?token|secret)=)[^&#\s]*/gi,
      "$1[redacted]",
    );
}
