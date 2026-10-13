"use client";

import {
  Activity,
  AlertTriangle,
  Clock,
  RefreshCw,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
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
import { DiagnosticsPanel } from "./diagnostics-panel";
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
    <div className="mx-auto grid max-w-[1180px] gap-4 py-6">
      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle asChild><h2>Connected VibeTV</h2></CardTitle>
            <CardDescription>
              {deviceConnected
                ? copyForHost(
                    "The VibeTV currently controlled by this Mac.",
                    windowsHost,
                  )
                : "No VibeTV is currently connected."}
            </CardDescription>
            <CardAction>
              <Badge variant={deviceConnected ? "default" : "outline"}>
                {deviceConnected ? "Connected" : "Not connected"}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="flex-1">
            <dl className="grid gap-2 sm:grid-cols-2">
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
          </CardContent>
          {onRunSetupAgain ? (
            <CardFooter className="justify-end">
              <Button
                className="w-full sm:w-auto"
                disabled={Boolean(busyAction)}
                onClick={onRunSetupAgain}
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
            </CardFooter>
          ) : null}
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle asChild><h2>Support report</h2></CardTitle>
            <CardDescription>
              Create a diagnostic file when support asks for it.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 items-center">
            <SupportReportActions
              creating={supportReportBusy}
              diagnostics={diagnostics}
              onCreate={onLoadDiagnostics}
              windowsHost={windowsHost}
            />
          </CardContent>
        </Card>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle asChild><h2>Diagnostics</h2></CardTitle>
        </CardHeader>
        <CardContent>
          <DiagnosticsPanel
            diagnostics={diagnostics}
            onRepairUsageEngine={onRepairUsageEngine}
            onRun={onLoadDiagnostics}
            repairing={repairingUsageEngine}
            running={supportReportBusy}
            windowsHost={windowsHost}
          />
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle asChild><h2>Setup log</h2></CardTitle>
        </CardHeader>
        <CardContent>
          <SetupEventLog windowsHost={windowsHost} />
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle asChild><h2>Recent activity</h2></CardTitle>
          <CardDescription>Connection and setup changes from this session.</CardDescription>
          {onRefresh ? (
            <CardAction>
              <Button disabled={busyAction === "logs"} onClick={onRefresh} size="sm" variant="outline">
                {busyAction === "logs" ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" aria-hidden />}
                {busyAction === "logs" ? "Refreshing" : "Refresh"}
              </Button>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-4">
          {lastError ? (
            <Alert>
              <AlertTriangle aria-hidden />
              <AlertTitle>{supportText(lastError.message)}</AlertTitle>
              <AlertDescription>{supportText(lastError.nextAction)}</AlertDescription>
            </Alert>
          ) : null}
          {events.length ? (
            <div className="max-h-[320px] overflow-y-auto rounded-lg border">
              <ItemGroup className="gap-0 divide-y">
                {events.map((event) => (
                  <Item className="rounded-none border-0" key={event.id} role="listitem" size="sm">
                    <ItemMedia variant="icon"><Activity aria-hidden /></ItemMedia>
                    <ItemContent>
                      <ItemTitle>{supportText(event.label)}</ItemTitle>
                      {event.detail ? <ItemDescription className="line-clamp-none break-words">{supportText(event.detail)}</ItemDescription> : null}
                    </ItemContent>
                    <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock size={14} aria-hidden />
                      <span>{event.timestamp || "Session"}</span>
                    </div>
                  </Item>
                ))}
              </ItemGroup>
            </div>
          ) : (
            <Empty className="bg-muted/50 py-6">
              <EmptyHeader>
                <EmptyMedia variant="icon"><Activity aria-hidden /></EmptyMedia>
                <EmptyTitle>No recent activity</EmptyTitle>
                <EmptyDescription>Connection activity will appear here.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SupportFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/50 p-3">
      <dt className="text-xs font-semibold uppercase text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium">{value}</dd>
    </div>
  );
}

function formatDeviceAddress(value?: string): string {
  return value?.trim().replace(/^https?:\/\//i, "") || "Not configured";
}


function activeThemeLabel(
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
