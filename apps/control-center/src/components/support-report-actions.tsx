"use client";

import { Clipboard, Download, FileText, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { SupportDiagnostics } from "./control-center-types";
import {
  downloadSupportReport,
  serializeSupportReport,
  supportReportFilename,
} from "./support-report";

type Props = {
  align?: "start" | "center";
  createLabel?: string;
  creating?: boolean;
  diagnostics?: SupportDiagnostics | null;
  emphasis?: "primary" | "secondary";
  onCreate?: () => void;
  /** The app runs on Windows, which saves a download without asking where. */
  windowsHost?: boolean;
};

export function SupportReportActions({
  align = "start",
  createLabel = "Create report",
  creating = false,
  diagnostics,
  emphasis = "primary",
  onCreate,
  windowsHost = false,
}: Props) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  // The report that was saved; one created afterwards has not been.
  const [savedReport, setSavedReport] = useState<SupportDiagnostics | null>(
    null,
  );
  const downloaded = Boolean(diagnostics) && savedReport === diagnostics;
  const diagnosticsText = diagnostics
    ? serializeSupportReport(diagnostics)
    : "";
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
      // The Mac asks where to save and can be cancelled, so only the silent
      // save on Windows is confirmed here.
      if (windowsHost) {
        setSavedReport(diagnostics);
      }
    }
  }

  return (
    <div
      className={cn("grid gap-3", align === "center" && "justify-items-center")}
      data-testid="support-report-actions"
    >
      <div
        className={cn(
          "grid w-full gap-3 sm:flex sm:w-auto sm:flex-wrap",
          align === "center" && "sm:justify-center",
        )}
      >
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
              <span>{downloaded ? "Downloaded" : "Download"}</span>
            </Button>
            {onCreate ? (
              <Button
                className="w-full sm:w-auto"
                disabled={creating}
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
            disabled={creating}
            onClick={createDiagnostics}
            type="button"
            variant={createButtonVariant}
          >
            <FileText data-icon="inline-start" aria-hidden />
            <span>{createLabel}</span>
          </Button>
        ) : null}
      </div>
      {statusMessage ? (
        <p aria-live="polite" className="sr-only" role="status">
          {statusMessage}
        </p>
      ) : null}
      {downloaded && diagnostics ? (
        <p
          className={cn(
            "text-sm text-muted-foreground",
            align === "center" && "text-center",
          )}
          role="status"
        >
          Saved as {supportReportFilename(diagnostics.generatedAt)} in your
          Downloads folder.
        </p>
      ) : null}
      {copyState === "failed" ? (
        <p
          className={cn(
            "text-sm text-destructive",
            align === "center" && "text-center",
          )}
          role="alert"
        >
          Copy failed. Check the clipboard permission and try again.
        </p>
      ) : null}
    </div>
  );
}
