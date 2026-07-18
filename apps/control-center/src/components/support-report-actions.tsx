"use client";

import { Clipboard, Download, FileText, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { SupportDiagnostics } from "./control-center-types";
import {
  downloadSupportReport,
  serializeSupportReport,
} from "./support-report";

type Props = {
  busyAction?: string | null;
  diagnostics?: SupportDiagnostics | null;
  onCreate?: () => void;
};

export function SupportReportActions({
  busyAction,
  diagnostics,
  onCreate,
}: Props) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const diagnosticsText = diagnostics
    ? serializeSupportReport(diagnostics)
    : "";

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
    if (diagnostics) {
      downloadSupportReport(diagnostics);
    }
  }

  return (
    <div className="grid gap-3" data-testid="support-report-actions">
      <div className="flex flex-wrap justify-center gap-3">
        {onCreate ? (
          <button
            className="inline-flex min-h-11 items-center justify-center gap-2 border border-[#747A60] bg-[#F9F9F9] px-4 text-sm font-semibold text-[#1B1B1B] transition hover:bg-[#EEEEEE] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={Boolean(busyAction)}
            onClick={onCreate}
            type="button"
          >
            {busyAction === "diagnostics" ? (
              <RefreshCw className="animate-spin" size={18} aria-hidden />
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
              className="inline-flex min-h-11 items-center justify-center gap-2 border border-[#747A60] bg-[#F9F9F9] px-4 text-sm font-semibold text-[#1B1B1B] transition hover:bg-[#EEEEEE]"
              onClick={copyDiagnostics}
              type="button"
            >
              <Clipboard size={18} aria-hidden />
              <span>{copyState === "copied" ? "Copied" : "Copy report"}</span>
            </button>
            <button
              className="inline-flex min-h-11 items-center justify-center gap-2 border border-[#747A60] bg-[#F9F9F9] px-4 text-sm font-semibold text-[#1B1B1B] transition hover:bg-[#EEEEEE]"
              onClick={downloadDiagnostics}
              type="button"
            >
              <Download size={18} aria-hidden />
              <span>Download report</span>
            </button>
          </>
        ) : null}
      </div>
      {copyState === "failed" ? (
        <div
          className="border border-[#747A60] bg-[#EEEEEE] p-3 text-center text-sm text-[#444933]"
          role="alert"
        >
          Copy failed. Check the clipboard permission and try again.
        </div>
      ) : null}
    </div>
  );
}
