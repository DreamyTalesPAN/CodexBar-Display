"use client";

import {
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { activeLiveThemeId } from "@/lib/active-theme-upgrade";
import { copyForHost } from "@/lib/customer-platform";
import { validateThemeSpec } from "@/lib/theme-studio";
import {
  loadUserThemes,
  type ThemeStudioDocument,
} from "@/lib/theme-studio-storage";
import type { ThemeProduct } from "@/lib/themes";
import {
  deviceIsCustomerConnected,
  deviceUsesCable,
  deviceIsReady,
  type DeviceInfo,
  type SupportDiagnostics,
} from "./control-center-types";
import { formatCustomerSupportText } from "./customer-support-text";
import { DiagnosticsPanel, SUPPORT_FRAME as FRAME } from "./diagnostics-panel";
import { SetupEventLog } from "./setup-event-log";
import { SupportReportActions } from "./support-report-actions";

export type LogEvent = {
  id: string;
  label: string;
  detail?: string;
  timestamp?: string;
};

export type LogsScreenProps = {
  events?: LogEvent[];
  device?: DeviceInfo | null;
  /** The catalog, to name the live theme while a screensaver is on screen. */
  themes?: ThemeProduct[];
  diagnostics?: SupportDiagnostics | null;
  lastError?: {
    code: string;
    message: string;
    nextAction: string;
  } | null;
  onLoadDiagnostics?: () => void;
  onRefresh?: () => void;
  onRunSetupAgain?: () => void;
  onRepairUsageEngine?: () => void;
  repairingUsageEngine?: boolean;
  busyAction?: string | null;
  supportReportBusy?: boolean;
  /** The app runs on Windows, where "Mac App" reads "app". */
  windowsHost?: boolean;
};

export function LogsScreen({
  events = [],
  device,
  themes = [],
  diagnostics,
  lastError,
  onLoadDiagnostics,
  onRefresh,
  onRunSetupAgain,
  onRepairUsageEngine,
  repairingUsageEngine = false,
  busyAction,
  supportReportBusy = false,
  windowsHost = false,
}: LogsScreenProps) {
  const deviceConnected = deviceIsCustomerConnected(device);
  // Issue #265: only a VibeTV on WiFi reports a signal, and a reading kept
  // from before it went away says nothing about now.
  const wifi = deviceConnected ? device?.health?.wifi : undefined;
  const supportText = (value: string) =>
    copyForHost(formatCustomerSupportText(value), windowsHost);

  return (
    <div className="grid max-w-[760px] gap-10 pt-8 pb-10 text-sm">
      <SupportSection
        description={
          deviceConnected
            ? copyForHost(
                "The VibeTV currently controlled by this Mac.",
                windowsHost,
              )
            : "No VibeTV is currently connected."
        }
        title="Connected VibeTV"
      >
        <dl className={`grid px-5 py-1.5 ${FRAME}`}>
          <SupportFact
            label="Status"
            value={deviceConnected ? "Connected" : "Not connected"}
          />
          <SupportFact
            label="Device"
            value={device?.deviceId || device?.board || "Not available"}
          />
          {/* A VibeTV on the cable has no address (issue #558). */}
          {deviceUsesCable(device) ? (
            <SupportFact label="Connection" value="USB-C cable" />
          ) : (
            <SupportFact
              label="Address"
              value={formatDeviceAddress(device?.target)}
            />
          )}
          <SupportFact
            label="Firmware"
            value={device?.firmware || "Not available"}
          />
          <SupportFact
            label="Active theme"
            value={activeThemeLabel(themes, device)}
          />
          {wifi ? (
            <SupportFact
              label="WiFi signal"
              value={wifi.weak ? `Weak (${wifi.rssi} dBm)` : `${wifi.rssi} dBm`}
            />
          ) : null}
        </dl>
        {onRunSetupAgain ? (
          <div>
            <Button
              className="w-full sm:w-auto"
              disabled={Boolean(busyAction)}
              onClick={onRunSetupAgain}
              size="sm"
              type="button"
              variant="outline"
            >
              {busyAction === "reset-setup" ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RefreshCw data-icon="inline-start" aria-hidden />
              )}
              {busyAction === "reset-setup" ? "Resetting setup" : "Run setup again"}
            </Button>
          </div>
        ) : null}
      </SupportSection>

      <div
        className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-3 p-5 ${FRAME}`}
      >
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">Support report</h2>
          <p className="text-muted-foreground">
            A diagnostic file for the support team.
          </p>
        </div>
        <SupportReportActions
          creating={supportReportBusy}
          diagnostics={diagnostics}
          onCreate={onLoadDiagnostics}
          quiet
          size="sm"
          windowsHost={windowsHost}
        />
      </div>

      <DiagnosticsPanel
        diagnostics={diagnostics}
        onRepairUsageEngine={onRepairUsageEngine}
        onRun={onLoadDiagnostics}
        repairing={repairingUsageEngine}
        running={supportReportBusy}
        windowsHost={windowsHost}
      />

      <SupportSection title="Setup log">
        <SetupEventLog windowsHost={windowsHost} />
      </SupportSection>

      <SupportSection
        action={
          onRefresh ? (
            <Button
              className="h-auto px-0 font-semibold"
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
          <Alert>
            <AlertTriangle aria-hidden />
            <AlertTitle>{supportText(lastError.message)}</AlertTitle>
            <AlertDescription>{supportText(lastError.nextAction)}</AlertDescription>
          </Alert>
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
                  <span className="truncate">
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

/** One Support section: its heading (with an optional action) above the content. */
function SupportSection({
  action,
  title,
  description,
  children,
}: {
  action?: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="grid content-start gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-[15px] leading-5 font-semibold">{title}</h2>
        {action}
      </div>
      {description ? <p className="-mt-2 text-muted-foreground">{description}</p> : null}
      <div className="grid min-w-0 content-start gap-4">{children}</div>
    </section>
  );
}

function SupportFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,180px)_minmax(0,1fr)] gap-4 border-b border-foreground/10 py-2.5 text-sm last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  );
}

function formatDeviceAddress(value?: string): string {
  return value?.trim().replace(/^https?:\/\//i, "") || "Not configured";
}


export function activeThemeLabel(
  themes: ThemeProduct[],
  device: DeviceInfo | null | undefined,
): string {
  // The customer's own themes are saved in this browser, by Theme Studio, with
  // the name they gave them.
  const saved = loadUserThemes();
  const ownName = (matches: (document: ThemeStudioDocument) => boolean) =>
    (saved.ok ? saved.value.themes : saved.data?.themes || []).find(
      ({ document }) => document.usage !== "screensaver" && matches(document),
    )?.document.packName;
  // The file in the live slot says whose theme it is: a saved theme is sent
  // under a path only it has, also when a later catalog gave one of its themes
  // the same id. During standby that file is all VibeTV reports of the slot;
  // the screensaver on screen is not it.
  const standbyActive = device?.standby?.active === true;
  const livePath = (
    standbyActive
      ? device.standby?.liveThemePath
      : device?.display?.themeSpec?.path
  )?.trim();
  const ownByFile =
    livePath &&
    ownName(
      (document) =>
        validateThemeSpec(document.spec, document.assets, "live")
          .themeSpecPath === livePath,
    );
  if (ownByFile) {
    return ownByFile;
  }
  const theme = activeLiveThemeId(themes, device)?.trim();
  if (!theme) {
    if (standbyActive && livePath) {
      return "Custom theme";
    }
    return deviceIsReady(device) ? "Default" : "Not available";
  }
  const own =
    !themes.some((listed) => listed.themeId === theme) &&
    ownName((document) => document.spec.themeId === theme);
  if (own) {
    return own;
  }
  return theme.split(/[-_]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
