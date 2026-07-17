"use client";

import {
  Activity,
  AlertTriangle,
  Clipboard,
  Download,
  FileText,
  Clock,
  RefreshCw,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { SupportDiagnostics } from "./control-center-types";
import { providerSetupStatusLabel } from "./provider-setup-card";

export type LogEvent = {
  id: string;
  label: string;
  detail?: string;
  timestamp?: string;
};

export type LogsScreenProps = {
  events?: LogEvent[];
  diagnostics?: SupportDiagnostics | null;
  lastError?: {
    code: string;
    message: string;
    nextAction: string;
  } | null;
  onLoadDiagnostics?: () => void;
  onRefresh?: () => void;
  busyAction?: string | null;
};

export function LogsScreen({
  events = [],
  diagnostics,
  lastError,
  onLoadDiagnostics,
  onRefresh,
  busyAction,
}: LogsScreenProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const diagnosticsText = useMemo(
    () => (diagnostics ? JSON.stringify(diagnostics, null, 2) : ""),
    [diagnostics],
  );

  async function copyDiagnostics() {
    if (!diagnosticsText) {
      return;
    }
    try {
      await navigator.clipboard.writeText(diagnosticsText);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  function downloadDiagnostics() {
    if (!diagnosticsText) {
      return;
    }
    const blob = new Blob([diagnosticsText], {
      type: "application/json;charset=utf-8",
    });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = supportReportFilename(diagnostics?.generatedAt);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-[1180px]">
      <section className="border-b border-[#747A60] py-10">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <h3 className="text-base font-bold text-[#1B1B1B]">
            Support report
          </h3>
          <div className="flex flex-wrap gap-3">
            {onLoadDiagnostics ? (
              <button
                className="inline-flex h-11 items-center justify-center gap-2 border border-[#747A60] bg-[#F9F9F9] px-4 text-sm font-semibold text-[#1B1B1B] transition hover:bg-[#EEEEEE] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={busyAction === "diagnostics"}
                onClick={onLoadDiagnostics}
                type="button"
              >
                {busyAction === "diagnostics" ? (
                  <RefreshCw className="animate-spin" size={18} />
                ) : (
                  <FileText size={18} aria-hidden />
                )}
                <span>
                  {busyAction === "diagnostics" ? "Creating" : "Create report"}
                </span>
              </button>
            ) : null}
            {diagnosticsText ? (
              <>
                <button
                  className="inline-flex h-11 items-center justify-center gap-2 border border-[#747A60] bg-[#F9F9F9] px-4 text-sm font-semibold text-[#1B1B1B] transition hover:bg-[#EEEEEE]"
                  onClick={copyDiagnostics}
                  type="button"
                >
                  <Clipboard size={18} aria-hidden />
                  <span>{copyState === "copied" ? "Copied" : "Copy report"}</span>
                </button>
                <button
                  className="inline-flex h-11 items-center justify-center gap-2 border border-[#747A60] bg-[#F9F9F9] px-4 text-sm font-semibold text-[#1B1B1B] transition hover:bg-[#EEEEEE]"
                  onClick={downloadDiagnostics}
                  type="button"
                >
                  <Download size={18} aria-hidden />
                  <span>Download report</span>
                </button>
              </>
            ) : null}
          </div>
        </div>

        {diagnostics ? (
          <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
            <dl className="divide-y divide-[#747A60] border-y border-[#747A60]">
              <DiagnosticFact
                label="Generated"
                value={formatDiagnosticTime(diagnostics.generatedAt)}
              />
              <DiagnosticFact
                label="Mac App"
                value={diagnostics.companion?.version || "Unknown"}
              />
              <DiagnosticFact
                label="CodexBar"
                value={formatCodexBarStatus(diagnostics)}
              />
              <DiagnosticFact
                label="AI provider"
                value={providerSetupStatusLabel(diagnostics.providerSetup)}
              />
              <DiagnosticFact
                label="VibeTV address"
                value={formatDeviceAddress(diagnostics.device?.target)}
              />
              <DiagnosticFact
                label="Device"
                value={
                  diagnostics.device?.connected
                    ? diagnostics.device.board || "Connected"
                    : "Not connected"
                }
              />
            </dl>
            <ol className="grid gap-0 border-y border-[#747A60]">
              {(diagnostics.checks || []).map((check) => (
                <li
                  className="grid gap-3 border-b border-[#747A60] py-4 last:border-b-0 md:grid-cols-[150px_minmax(0,1fr)]"
                  key={`${check.name}-${check.status}`}
                >
                  <div>
                    <span className="inline-flex min-h-8 items-center border border-[#747A60] bg-[#F9F9F9] px-3 text-xs font-bold uppercase text-[#1B1B1B]">
                      {check.status}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-[#1B1B1B]">
                      {formatCheckName(check.name)}
                    </div>
                    {check.detail ? (
                      <div className="mt-1 break-words text-sm leading-6 text-[#444933]">
                        {formatCustomerSupportText(check.detail)}
                      </div>
                    ) : null}
                    {check.nextAction ? (
                      <div className="mt-1 break-words text-sm leading-6 text-[#444933]">
                        {formatCustomerSupportText(check.nextAction)}
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <div className="border border-[#747A60] p-6 text-sm text-[#444933]">
            Create a support report when support asks for it.
          </div>
        )}
        {copyState === "failed" ? (
          <div className="mt-4 border border-[#747A60] bg-[#EEEEEE] p-4 text-sm text-[#444933]">
            Copy failed. Use the browser clipboard permission and try again.
          </div>
        ) : null}
      </section>

      <section className="border-b border-[#747A60] py-10">
        <div className="mb-6 flex items-center justify-between gap-4">
          <h3 className="text-base font-bold text-[#1B1B1B]">
            Recent activity
          </h3>
          {onRefresh ? (
            <button
              className="inline-flex h-11 items-center justify-center gap-2 border border-[#747A60] bg-[#F9F9F9] px-4 text-sm font-semibold text-[#1B1B1B] transition hover:bg-[#EEEEEE] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busyAction === "logs"}
              onClick={onRefresh}
              type="button"
            >
              {busyAction === "logs" ? (
                <RefreshCw className="animate-spin" size={18} />
              ) : (
                <RefreshCw size={18} aria-hidden />
              )}
              <span>{busyAction === "logs" ? "Refreshing..." : "Refresh"}</span>
            </button>
          ) : null}
        </div>

        {lastError ? (
          <div className="mb-6 border border-[#747A60] bg-[#EEEEEE] p-4 text-sm leading-6 text-[#444933]">
            <div className="mb-1 flex items-center gap-2 font-bold text-[#1B1B1B]">
              <AlertTriangle size={17} aria-hidden />
              {formatCustomerSupportText(lastError.message)}
            </div>
            {formatCustomerSupportText(lastError.nextAction)}
          </div>
        ) : null}

        {events.length ? (
          <ol className="grid gap-0 border-y border-[#747A60]">
            {events.map((event) => (
              <li
                className="grid gap-4 border-b border-[#747A60] py-5 last:border-b-0 md:grid-cols-[58px_minmax(0,1fr)_120px]"
                key={event.id}
              >
                <div className="grid size-12 place-items-center rounded-full bg-[#1B1B1B] text-[#CCFF00]">
                  <Activity size={23} aria-hidden />
                </div>
                <div className="min-w-0">
                  <div className="break-words font-bold text-[#1B1B1B]">
                    {formatCustomerSupportText(event.label)}
                  </div>
                  {event.detail ? (
                    <div className="mt-1 break-words text-sm leading-6 text-[#444933]">
                      {formatCustomerSupportText(event.detail)}
                    </div>
                  ) : null}
                </div>
                <div className="flex min-w-0 items-center gap-2 break-words text-sm text-[#444933] md:justify-end">
                  <Clock size={15} aria-hidden />
                  <span className="min-w-0 break-words">
                    {event.timestamp || "Session"}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="border border-[#747A60] p-6 text-sm text-[#444933]">
            Recent activity will appear here.
          </div>
        )}
      </section>
    </div>
  );
}

function DiagnosticFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-h-[52px] gap-1 py-3 sm:grid-cols-[110px_minmax(0,1fr)] sm:gap-4">
      <dt className="text-sm font-bold text-[#1B1B1B]">{label}</dt>
      <dd className="break-words text-sm leading-6 text-[#444933]">{value}</dd>
    </div>
  );
}

function formatCheckName(name: string): string {
  if (name.trim().toLowerCase() === "companion") {
    return "Mac App";
  }
  return name
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatCustomerSupportText(value: string): string {
  return value
    .replace(/\bCompanion\s+API\b/gi, "Mac App")
    .replace(/\bCompanion\b/g, "Mac App")
    .replace(/\bbridge\b/gi, "Mac App")
    .replace(/\bdaemon\b/gi, "Mac App")
    .replace(/\blocal\s+API\b/gi, "Mac App")
    .replace(/\bAPI\b/g, "app")
    .replace(/\btarget\b/gi, "VibeTV address")
    .replace(/\bpack\s*URL\b/gi, "theme download")
    .replace(/\bpackUrl\b/g, "theme download")
    .replace(/\bCOMPANION_UNREACHABLE\b/g, "Mac App needs setup")
    .replace(/\bCLIENT_ERROR\b/g, "Something needs attention")
    .replace(/\bHTTP_\d+\b/g, "Connection failed")
    .replace(/\bVibeTV-Companion-API-\S+/g, "Mac App installer")
    .replace(/https?:\/\/\S+/g, "saved link");
}

function formatDeviceAddress(value?: string): string {
  return value?.trim().replace(/^https?:\/\//i, "") || "Not configured";
}

function formatDiagnosticTime(value?: string): string {
  if (!value) {
    return "Unknown";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatCodexBarStatus(diagnostics: SupportDiagnostics): string {
  const engine = diagnostics.providerSetup?.engine;
  if (!engine) {
    return "Unknown";
  }
  if (engine.status === "ready") {
    return engine.version ? `Ready ${engine.version}` : "Ready";
  }
  if (engine.status === "config_error") {
    return "Settings need attention";
  }
  return "Setup needed";
}

function supportReportFilename(value?: string): string {
  const timestamp = value ? new Date(value) : new Date();
  const safeTimestamp = Number.isNaN(timestamp.getTime())
    ? "session"
    : timestamp.toISOString().replace(/[:.]/g, "-");
  return `vibetv-support-report-${safeTimestamp}.json`;
}
