"use client";

import { Clipboard, Download, FileText, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { onNativeDownloadFinished } from "./control-center-runtime";
import type { SupportDiagnostics } from "./control-center-types";
import {
  downloadSupportReport,
  serializeSupportReport,
  supportReportFilename,
} from "./support-report";

type Props = {
  align?: "start" | "center";
  createLabel?: string;
  /** Button height: "sm" for the Support page's quieter row. */
  size?: "default" | "sm";
  creating?: boolean;
  diagnostics?: SupportDiagnostics | null;
  emphasis?: "primary" | "secondary";
  onCreate?: () => void;
  /** The Support page's quiet row: Copy and Download as text, an outline Create. */
  quiet?: boolean;
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
  quiet = false,
  size = "default",
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
  // Issue #582: the Mac app says when its save dialog saved the report.
  useEffect(() => {
    if (!diagnostics) {
      return;
    }
    return onNativeDownloadFinished(
      supportReportFilename(diagnostics.generatedAt),
      (saved) => {
        if (saved) {
          setSavedReport(diagnostics);
        }
      },
    );
  }, [diagnostics]);
  const diagnosticsText = diagnostics
    ? serializeSupportReport(diagnostics)
    : "";
  const createButtonVariant = quiet
    ? "outline"
    : emphasis === "secondary"
      ? "secondary"
      : "default";
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
      // save on Windows is confirmed here; the Mac app confirms its own.
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
          quiet && "sm:gap-1",
          align === "center" && "sm:justify-center",
        )}
      >
        {creating ? (
          <Button
            className="w-full sm:w-auto"
            disabled
            size={size} type="button"
            variant={createButtonVariant}
          >
            <Spinner data-icon="inline-start" />
            <span>Creating report</span>
          </Button>
        ) : diagnosticsText ? (
          <>
            <Button
              className={cn("w-full sm:w-auto", quiet && "px-3.5 text-sm")}
              onClick={copyDiagnostics}
              size={size} type="button"
              variant={quiet ? "ghost" : "outline"}
            >
              {quiet ? null : <Clipboard data-icon="inline-start" aria-hidden />}
              <span>{copyState === "copied" ? "Copied" : "Copy"}</span>
            </Button>
            <Button
              className={cn("w-full sm:w-auto", quiet && "px-3.5 text-sm")}
              onClick={downloadDiagnostics}
              size={size} type="button"
              variant={quiet ? "ghost" : "outline"}
            >
              {quiet ? null : <Download data-icon="inline-start" aria-hidden />}
              <span>{downloaded ? "Downloaded" : "Download"}</span>
            </Button>
            {onCreate ? (
              <Button
                className={cn("w-full sm:w-auto", quiet && "px-3.5 text-sm")}
                disabled={creating}
                onClick={createDiagnostics}
                size={size} type="button"
                variant={createButtonVariant}
              >
                {quiet ? null : <RefreshCw data-icon="inline-start" aria-hidden />}
                <span>{quiet ? "Create new" : "Create again"}</span>
              </Button>
            ) : null}
          </>
        ) : onCreate ? (
          <Button
            className={cn("w-full sm:w-auto", quiet && "px-3.5 text-sm")}
            disabled={creating}
            onClick={createDiagnostics}
            size={size} type="button"
            variant={createButtonVariant}
          >
            {quiet ? null : <FileText data-icon="inline-start" aria-hidden />}
            <span>{createLabel}</span>
          </Button>
        ) : null}
      </div>
      {statusMessage ? (
        <p aria-live="polite" className="sr-only" role="status">
          {statusMessage}
        </p>
      ) : null}
      {/* On the Mac the customer chose the folder, so none is named there. */}
      {downloaded && diagnostics && windowsHost ? (
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
