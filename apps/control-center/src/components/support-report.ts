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
  return JSON.stringify(
    redactSensitiveValues(report),
    (_key, value) =>
      typeof value === "string"
        ? copyForHost(homeFolderAsTilde(value), windowsHost)
        : value,
    2,
  );
}

// The folder under the home root is the account name of the computer. The
// report says `~` for the root and that one name in every text it holds
// (issue #580); the app itself keeps the real path. Everything else stays: a
// path that is missed is the smaller harm than a sentence that loses words.
//
// A home root is `/Users/` or `/home/`, spelled exactly so, and on Windows
// `C:\Users\` on any drive or `\\server\Users\`, with either slash, also
// doubled inside JSON text. It counts only where a path starts -- at the
// start of the text or after a space, a quote, `=`, `(` or `:` -- and never
// inside a web address. `Public` and `Shared` are on every computer and name
// nobody.
const homeRoot = String.raw`(?:[\s"'=(:]|^)/(?:Users|home)/+|(?:(?:[^A-Za-z0-9]|^)[A-Za-z]:|(?:[\s"'=(]|^)\\{2,}[\w.$-]+)[\\/]+[Uu]sers[\\/]+`;
// One word of a name inside a sentence: it ends before a space, a bracket,
// `=` and punctuation, and a full stop behind it belongs to the sentence.
const homeNameEnd = String.raw`\\/\s"'<>|:*?;,()\[\]{}=`;
const homeNameWord = `[^${homeNameEnd}]*[^${homeNameEnd}.]`;
// A name with spaces is a name only where the path goes on right behind it,
// and inside a sentence it has at most three words.
const homePath = new RegExp(
  `(${homeRoot})(${homeNameWord}(?: ${homeNameWord}){0,2}(?=[\\\\/])|${homeNameWord})`,
  "g",
);
// A text that is one path, as the usage engine's own paths are: the name is
// what stands before the next separator, however many words, and where no
// separator follows, everything to the end of the text. `/Users/Jane Doe`
// must not keep half a name, so a sentence of that shape loses its words.
const wholeHomePath = new RegExp(
  String.raw`^(${homeRoot})([^\\/\r\n"<>|:*?]+)(?=[\\/]|$)`,
);

function homeFolderAsTilde(value: string): string {
  const shorten = (
    match: string,
    root: string,
    name: string,
    offset: number,
    text: string,
  ) => {
    // The character in front of the root is not part of the path.
    const before = root.slice(0, root.search(/[A-Za-z]:|\\{2}|\/(?:Users|home)/));
    const token = text.slice(0, offset).split(/\s/).pop() ?? "";
    return /^(?:public|shared)$/i.test(name) || token.includes("://")
      ? match
      : `${before}~`;
  };
  return value.replace(wholeHomePath, shorten).replace(homePath, shorten);
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
  // midnight on another day (issue #579). Without the "Z" that marks UTC.
  const safeTimestamp = Number.isNaN(timestamp.getTime())
    ? "session"
    : new Date(timestamp.getTime() - timestamp.getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, -1)
        .replace(/[:.]/g, "-");
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
