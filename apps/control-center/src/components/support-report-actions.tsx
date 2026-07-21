"use client";

import { Clipboard, Download, FileText, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { SupportDiagnostics } from "./control-center-types";
import {
  downloadSupportReport,
  serializeSupportReport,
} from "./support-report";

type Props = {
  busyAction?: string | null;
  diagnostics?: SupportDiagnostics | null;
  emphasis?: "primary" | "secondary";
  onCreate?: () => void;
};

export function SupportReportActions({
  busyAction,
  diagnostics,
  emphasis = "primary",
  onCreate,
}: Props) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const diagnosticsText = diagnostics
    ? serializeSupportReport(diagnostics)
    : "";
  const creating = busyAction === "diagnostics";
  const createButtonVariant = emphasis === "secondary" ? "secondary" : "default";
  const statusMessage = creating
    ? "Creating report"
    : copyState === "copied"
      ? "Report copied"
      : "";

  function createDiagnostics() {
    setCopyState("idle");
    onCreate?.();
  }

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
    <div
      className="grid gap-3"
      data-testid="support-report-actions"
    >
      <div className="grid gap-3 sm:flex sm:flex-wrap">
        {creating ? (
          <Button
            className="w-full sm:w-auto"
            disabled
            type="button"
            variant={createButtonVariant}
          >
            <Spinner data-icon="inline-start" />
            <span>Creating report</span>
          </Button>
        ) : diagnosticsText ? (
          <>
            <Button
              className="w-full sm:w-auto"
              onClick={copyDiagnostics}
              type="button"
              variant="outline"
            >
              <Clipboard data-icon="inline-start" aria-hidden />
              <span>{copyState === "copied" ? "Copied" : "Copy"}</span>
            </Button>
            <Button
              className="w-full sm:w-auto"
              onClick={downloadDiagnostics}
              type="button"
              variant="outline"
            >
              <Download data-icon="inline-start" aria-hidden />
              <span>Download</span>
            </Button>
            {onCreate ? (
              <Button
                className="w-full sm:w-auto"
                disabled={Boolean(busyAction)}
                onClick={createDiagnostics}
                type="button"
                variant={createButtonVariant}
              >
                <RefreshCw data-icon="inline-start" aria-hidden />
                <span>Create again</span>
              </Button>
            ) : null}
          </>
        ) : onCreate ? (
          <Button
            className="w-full sm:w-auto"
            disabled={Boolean(busyAction)}
            onClick={createDiagnostics}
            type="button"
            variant={createButtonVariant}
          >
            <FileText data-icon="inline-start" aria-hidden />
            <span>Create report</span>
          </Button>
        ) : null}
      </div>
      {statusMessage ? (
        <p aria-live="polite" className="sr-only" role="status">
          {statusMessage}
        </p>
      ) : null}
      {copyState === "failed" ? (
        <p className="text-sm text-destructive" role="alert">
          Copy failed. Check the clipboard permission and try again.
        </p>
      ) : null}
    </div>
  );
}
