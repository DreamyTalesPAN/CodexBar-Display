import type {
  SupportDiagnostics,
  SupportReportClientState,
} from "./control-center-types";
import {
  isLoopbackHostname,
  isNativeControlCenterApp,
  nativeControlCenterAppBuild,
} from "./control-center-runtime";
import { copyForHost } from "@/lib/customer-platform";

export async function collectSupportReport(
  loadDiagnostics: () => Promise<SupportDiagnostics>,
  state: SupportReportClientState,
  /** The app runs on Windows; the report then names that app as its surface. */
  windowsHost = false,
): Promise<SupportDiagnostics> {
  const generatedAt = new Date().toISOString();
  const client = {
    environment: readClientEnvironment(windowsHost),
    state,
  };

  try {
    const diagnostics = await loadDiagnostics();
    return {
      ...diagnostics,
      generatedAt: diagnostics.generatedAt || generatedAt,
      // An older Mac App has no setup log or timeline; say so rather than
      // leave them out.
      setupLog: diagnostics.setupLog ?? { unavailable: true },
      timeline: diagnostics.timeline ?? { unavailable: true },
      client,
    };
  } catch (error) {
    return {
      ok: false,
      schemaVersion: 2,
      reportType: "control_center_fallback",
      generatedAt,
      client,
      setupLog: { unavailable: true },
      timeline: { unavailable: true },
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
  // The runtime's texts name the Mac on every system. A report from the
  // Windows app says what that app's screens say (issue #558).
  const windowsHost =
    report.client?.environment.surface === "native-windows-app";
  const homeAsTilde = homeFolderAsTilde(report);
  return JSON.stringify(
    redactSensitiveValues(report),
    (_key, value) =>
      typeof value === "string"
        ? copyForHost(homeAsTilde(value), windowsHost)
        : value,
    2,
  );
}

// The home folder's last part is the account name of the computer, and the
// report does not need it (issue #580). The report's own paths say which
// folder that is: the first of them that lies in `/Users/<name>`,
// `/home/<name>`, `C:\Users\<name>` or `\\server\Users\<name>`. Exactly that
// folder reads `~` in every text of the report and nothing else is touched;
// a report without such a path stays as it is. The app keeps the real path.
const homeFolder =
  /^(?:\/(?:Users|home)\/[^/]+|(?:[A-Za-z]:|\\\\[^\\/]+)[\\/]Users[\\/][^\\/]+)(?=[\\/])/;

function homeFolderAsTilde(
  report: SupportDiagnostics,
): (value: string) => string {
  const engine = report.providerSetup?.engine;
  const home = [report.usageEngine?.path, engine?.path, engine?.configPath]
    .map((path) => homeFolder.exec(path ?? "")?.[0])
    // `Shared` and `Public` are on every computer and name nobody.
    .find((folder) => folder && !/[\\/](?:Shared|Public)$/i.test(folder));
  if (!home) {
    return (value) => value;
  }
  if (home.startsWith("/")) {
    return (value) => value.split(home).join("~");
  }
  // Windows takes either slash and any case for the same folder, and a line
  // printed as JSON doubles the backslashes.
  const spellings = new RegExp(
    home
      .split(/[\\/]/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(String.raw`(?:\\\\|[\\/])`),
    "gi",
  );
  return (value) => value.replace(spellings, "~");
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
  // The customer's own date and time: the UTC time put a report saved around
  // midnight on another day (issue #579). To the second: a report's time has
  // no milliseconds, so the name always ended in "-000".
  const safeTimestamp = Number.isNaN(timestamp.getTime())
    ? "session"
    : new Date(timestamp.getTime() - timestamp.getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 19)
        .replace(/:/g, "-");
  return `vibetv-support-report-${safeTimestamp}.json`;
}

function readClientEnvironment(windowsHost: boolean) {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {};
  }
  const native = isNativeControlCenterApp();
  const { version, build } = nativeControlCenterAppBuild(navigator.userAgent);
  const location = `${window.location.origin}${window.location.pathname}`;
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    online: navigator.onLine,
    viewport: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    visibility: document.visibilityState,
    surface: native
      ? windowsHost
        ? "native-windows-app"
        : "native-mac-app"
      : "browser",
    appVersion: version,
    appBuild: build,
    // A loopback route is only served to the native Mac App: in a browser the
    // same URL answers 410 Gone. Keep it as a diagnostic address that names the
    // runtime owner, never as a page a customer or support can open.
    ...(native || isLoopbackHostname(window.location.hostname)
      ? { internalRuntimeAddress: location }
      : { page: location }),
  };
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Mac App diagnostics are unavailable.";
}

export function redactSensitiveValues(value: unknown): unknown {
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
