"use client";

import type { ReactNode } from "react";
import { SetupDialog } from "./setup/setup-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { copyForHost } from "@/lib/customer-platform";
import type { SupportDiagnostics } from "./control-center-types";
import { formatCustomerSupportText } from "./customer-support-text";
import { DiagnosticsPanel, SUPPORT_FRAME as FRAME } from "./diagnostics-panel";
import { SupportReportActions } from "./support-report-actions";

export type LogEvent = {
  id: string;
  label: string;
  detail?: string;
  timestamp?: string;
};

export type LogsScreenProps = {
  events?: LogEvent[];
  diagnostics?: SupportDiagnostics | null;
  supportReport?: SupportDiagnostics | null;
  diagnosticsRunning?: boolean;
  onDismissError?: () => void;
  onCreateSupportReport?: () => void;
  onStartSetup?: () => void;
  lastError?: {
    code: string;
    message: string;
    nextAction: string;
  } | null;
  onLoadDiagnostics?: () => void;
  onRefresh?: () => void;
  onRepairUsageEngine?: () => void;
  repairingUsageEngine?: boolean;
  busyAction?: string | null;
  supportReportBusy?: boolean;
  /** The app runs on Windows, where "Mac App" reads "app". */
  windowsHost?: boolean;
};

export function LogsScreen({
  events = [],
  diagnostics,
  supportReport,
  diagnosticsRunning = false,
  onDismissError,
  onCreateSupportReport,
  onStartSetup,
  lastError,
  onLoadDiagnostics,
  onRefresh,
  onRepairUsageEngine,
  repairingUsageEngine = false,
  busyAction,
  supportReportBusy = false,
  windowsHost = false,
}: LogsScreenProps) {
  const lastCreated = supportReport?.generatedAt
    ? createdWhen(supportReport.generatedAt)
    : "";
  const supportText = (value: string) =>
    copyForHost(formatCustomerSupportText(value), windowsHost);

  return (
    <div className="grid max-w-[760px] gap-10 pt-8 pb-10 text-sm leading-normal">
      <div
        className={`flex items-center justify-between gap-6 p-5 ${FRAME}`}
      >
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">Support report</h2>
          <p className="text-muted-foreground">
            A diagnostic file for the support team.
            {lastCreated ? ` Last created ${lastCreated}.` : ""}
          </p>
        </div>
        <div className="shrink-0">
          <SupportReportActions
            creating={supportReportBusy}
            busyElsewhere={diagnosticsRunning}
            diagnostics={supportReport}
            onCreate={onCreateSupportReport}
            quiet
            size="sm"
            windowsHost={windowsHost}
          />
        </div>
      </div>

      <DiagnosticsPanel
        busyElsewhere={supportReportBusy}
        diagnostics={diagnostics}
        onRepairUsageEngine={onRepairUsageEngine}
        onRun={onLoadDiagnostics}
        repairing={repairingUsageEngine}
        running={diagnosticsRunning}
        windowsHost={windowsHost}
      />

      <SupportSection
        action={
          onRefresh ? (
            <Button
              className="h-auto px-0 text-sm font-semibold"
              disabled={busyAction === "logs"}
              onClick={onRefresh}
              size="sm"
              variant="link"
            >
              {busyAction === "logs" ? <Spinner data-icon="inline-start" /> : null}
              {busyAction === "logs" ? "Refreshing" : "Refresh"}
            </Button>
          ) : null
        }
        title="Recent activity"
      >
        {lastError ? (
          <SetupDialog
            description={supportText(lastError.nextAction)}
            onOpenChange={(open) => { if (!open) onDismissError?.(); }}
            open
            primaryAction={lastError.code === "pairing_rejected"
              ? { label: "Run setup again", onSelect: () => { onDismissError?.(); onStartSetup?.(); } }
              : { label: "OK", onSelect: () => onDismissError?.() }}
            title={supportText(lastError.message)}
          />
        ) : null}
        <div className={`px-5 py-3.5 ${FRAME}`}>
          {events.length ? (
            <ul className="max-h-[320px] overflow-y-auto font-mono text-[13px] leading-[22px]">
              {events.map((event, index) => (
                <li
                  className={`grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 ${index === 0 ? "text-foreground" : "text-muted-foreground"}`}
                  key={event.id}
                >
                  <span className="text-muted-foreground">{event.timestamp}</span>
                  <span className="break-words">
                    <span>{supportText(event.label)}</span>
                    {event.detail ? (
                      <>
                        <span aria-hidden> · </span>
                        <span>{supportText(event.detail)}</span>
                      </>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="grid gap-1">
              <p className="font-semibold">No recent activity</p>
              <p className="text-muted-foreground">Connection activity will appear here.</p>
            </div>
          )}
        </div>
      </SupportSection>
    </div>
  );
}

/** "today at 16:42", or the date when it was another day. */
function createdWhen(generatedAt: string): string {
  const created = new Date(generatedAt);
  if (Number.isNaN(created.getTime())) return "";
  const time = created.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return created.toDateString() === new Date().toDateString()
    ? `today at ${time}`
    : `on ${created.toLocaleDateString([], { day: "numeric", month: "short" })} at ${time}`;
}

/** One Support section: its heading (with an optional action) above the content. */
function SupportSection({
  action,
  title,
  children,
}: {
  action?: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="grid content-start gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-[15px] leading-5 font-semibold">{title}</h2>
        {action}
      </div>
      <div className="grid min-w-0 content-start gap-4">{children}</div>
    </section>
  );
}
