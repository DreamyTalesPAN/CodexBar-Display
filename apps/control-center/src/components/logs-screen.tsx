"use client";

import {
  Activity,
  AlertTriangle,
  ArrowUpFromLine,
  Clipboard,
  Clock,
  Download,
  FileText,
  Monitor,
  Palette,
  RefreshCw,
  Wifi,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
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
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import type { DeviceInfo, SupportDiagnostics } from "./control-center-types";

export type LogEvent = {
  id: string;
  label: string;
  detail?: string;
  timestamp?: string;
};

export type LogsScreenProps = {
  events?: LogEvent[];
  device?: DeviceInfo | null;
  diagnostics?: SupportDiagnostics | null;
  lastError?: {
    code: string;
    message: string;
    nextAction: string;
  } | null;
  onLoadDiagnostics?: () => void;
  onRefresh?: () => void;
  onRunSetupAgain?: () => void;
  busyAction?: string | null;
};

export function LogsScreen({
  events = [],
  device,
  diagnostics,
  lastError,
  onLoadDiagnostics,
  onRefresh,
  onRunSetupAgain,
  busyAction,
}: LogsScreenProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const diagnosticsText = useMemo(
    () => (diagnostics ? JSON.stringify(diagnostics, null, 2) : ""),
    [diagnostics],
  );
  const deviceConnected = Boolean(device?.connected);
  const deviceStatus = deviceConnected
    ? device?.connectionState === "reconnecting"
      ? "Reconnecting"
      : "Connected"
    : "Not connected";

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
    <div className="mx-auto grid max-w-[1180px] gap-6 py-8">
      <div className="grid items-stretch gap-6 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.4fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Connected VibeTV</CardTitle>
            <CardDescription>
              {deviceConnected
                ? "The VibeTV currently controlled by this Mac."
                : "No VibeTV is currently connected."}
            </CardDescription>
            <CardAction>
              <Badge variant={deviceConnected ? "default" : "outline"}>
                {deviceStatus}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="flex-1">
            <ItemGroup className="gap-0">
              <SupportDeviceFact
                icon={<Monitor aria-hidden />}
                label="Device"
                value={deviceLabel(device)}
              />
              <ItemSeparator />
              <SupportDeviceFact
                icon={<Wifi aria-hidden />}
                label="Address"
                value={deviceAddress(device)}
              />
              <ItemSeparator />
              <SupportDeviceFact
                icon={<ArrowUpFromLine aria-hidden />}
                label="Firmware"
                value={device?.firmware || "Not available"}
              />
              <ItemSeparator />
              <SupportDeviceFact
                icon={<Palette aria-hidden />}
                label="Active theme"
                value={activeThemeLabel(device)}
              />
            </ItemGroup>
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
                <span>
                  {busyAction === "reset-setup"
                    ? "Resetting setup"
                    : "Run setup again"}
                </span>
              </Button>
            </CardFooter>
          ) : null}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Support report</CardTitle>
            <CardDescription>
              Create a local diagnostic snapshot when support asks for it.
            </CardDescription>
          </CardHeader>

          <CardContent className="grid flex-1 gap-5">
            {diagnostics ? (
              <>
                <dl className="grid gap-2 sm:grid-cols-2">
                  <DiagnosticFact
                    label="Generated"
                    value={formatDiagnosticTime(diagnostics.generatedAt)}
                  />
                  <DiagnosticFact
                    label="Mac App"
                    value={diagnostics.companion?.version || "Unknown"}
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
                <ItemGroup>
                  {(diagnostics.checks || []).map((check) => (
                    <Item
                      key={`${check.name}-${check.status}`}
                      size="sm"
                      variant="outline"
                    >
                      <ItemMedia>
                        <Badge
                          className="min-h-8 uppercase"
                          variant={
                            check.status === "pass"
                              ? "default"
                              : check.status === "fail"
                                ? "destructive"
                                : "outline"
                          }
                        >
                          {check.status}
                        </Badge>
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle>{formatCheckName(check.name)}</ItemTitle>
                        {check.detail ? (
                          <ItemDescription className="line-clamp-none break-words">
                            {formatCustomerSupportText(check.detail)}
                          </ItemDescription>
                        ) : null}
                        {check.nextAction ? (
                          <ItemDescription className="line-clamp-none break-words">
                            {formatCustomerSupportText(check.nextAction)}
                          </ItemDescription>
                        ) : null}
                      </ItemContent>
                    </Item>
                  ))}
                </ItemGroup>
              </>
            ) : (
              <Empty className="min-h-32 bg-muted/30 px-4 py-6">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FileText aria-hidden />
                  </EmptyMedia>
                  <EmptyTitle>No report created</EmptyTitle>
                  <EmptyDescription>
                    Reports stay local until you copy or download them.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
            {copyState === "failed" ? (
              <Alert>
                <AlertTriangle aria-hidden />
                <AlertTitle>Copy failed</AlertTitle>
                <AlertDescription>
                  Use the browser clipboard permission and try again.
                </AlertDescription>
              </Alert>
            ) : null}
          </CardContent>

          {diagnosticsText || onLoadDiagnostics ? (
            <CardFooter className="flex-col items-stretch gap-2 sm:flex-row sm:justify-end">
              {diagnosticsText ? (
                <>
                  <Button
                    onClick={copyDiagnostics}
                    type="button"
                    variant="outline"
                  >
                    <Clipboard data-icon="inline-start" aria-hidden />
                    <span>
                      {copyState === "copied" ? "Copied" : "Copy report"}
                    </span>
                  </Button>
                  <Button
                    onClick={downloadDiagnostics}
                    type="button"
                    variant="outline"
                  >
                    <Download data-icon="inline-start" aria-hidden />
                    <span>Download report</span>
                  </Button>
                </>
              ) : null}
              {onLoadDiagnostics ? (
                <Button
                  disabled={busyAction === "diagnostics"}
                  onClick={onLoadDiagnostics}
                  type="button"
                >
                  {busyAction === "diagnostics" ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <FileText data-icon="inline-start" aria-hidden />
                  )}
                  <span>
                    {busyAction === "diagnostics"
                      ? "Creating"
                      : diagnosticsText
                        ? "Refresh report"
                        : "Create report"}
                  </span>
                </Button>
              ) : null}
            </CardFooter>
          ) : null}
        </Card>
      </div>

      <Card className="border-0">
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>
            Local Control Center events from this session.
          </CardDescription>
          <CardAction>
            {onRefresh ? (
              <Button
                disabled={busyAction === "logs"}
                onClick={onRefresh}
                type="button"
                variant="outline"
              >
                {busyAction === "logs" ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <RefreshCw data-icon="inline-start" aria-hidden />
                )}
                <span>
                  {busyAction === "logs" ? "Refreshing..." : "Refresh"}
                </span>
              </Button>
            ) : null}
          </CardAction>
        </CardHeader>

        <CardContent className="grid gap-4">
          {lastError ? (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden />
              <AlertTitle>
                {formatCustomerSupportText(lastError.message)}
              </AlertTitle>
              <AlertDescription>
                {formatCustomerSupportText(lastError.nextAction)}
              </AlertDescription>
            </Alert>
          ) : null}

          {events.length ? (
            <ScrollArea className="max-h-80">
              <ItemGroup className="pr-3">
                {events.map((event) => (
                  <Item key={event.id} variant="muted">
                    <ItemMedia variant="icon">
                      <Activity aria-hidden />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle className="break-words">
                        {formatCustomerSupportText(event.label)}
                      </ItemTitle>
                      {event.detail ? (
                        <ItemDescription className="line-clamp-none break-words">
                          {formatCustomerSupportText(event.detail)}
                        </ItemDescription>
                      ) : null}
                    </ItemContent>
                    <ItemActions>
                      <Badge variant="outline">
                        <Clock aria-hidden />
                        {event.timestamp || "Session"}
                      </Badge>
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            </ScrollArea>
          ) : (
            <Empty className="min-h-52">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Activity aria-hidden />
                </EmptyMedia>
                <EmptyTitle>No recent activity</EmptyTitle>
                <EmptyDescription>
                  New Control Center events will appear here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DiagnosticFact({ label, value }: { label: string; value: string }) {
  return (
    <Item variant="muted">
      <ItemContent>
        <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
        <dd className="break-words font-medium text-foreground">{value}</dd>
      </ItemContent>
    </Item>
  );
}

function SupportDeviceFact({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Item role="listitem" size="sm">
      <ItemMedia variant="icon">{icon}</ItemMedia>
      <ItemContent>
        <ItemDescription>{label}</ItemDescription>
        <ItemTitle>{value}</ItemTitle>
      </ItemContent>
    </Item>
  );
}

function deviceLabel(device: DeviceInfo | null | undefined): string {
  if (device?.deviceId) {
    return `VibeTV ${device.deviceId}`;
  }
  return device?.connected ? "Current VibeTV" : "Not connected";
}

function deviceAddress(device: DeviceInfo | null | undefined): string {
  return device?.target?.replace(/^https?:\/\//, "") || "Not available";
}

function activeThemeLabel(device: DeviceInfo | null | undefined): string {
  const theme = device?.activeTheme?.trim();
  if (!theme) {
    return device?.connected ? "Default" : "Not available";
  }
  return theme
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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

function supportReportFilename(value?: string): string {
  const timestamp = value ? new Date(value) : new Date();
  const safeTimestamp = Number.isNaN(timestamp.getTime())
    ? "session"
    : timestamp.toISOString().replace(/[:.]/g, "-");
  return `vibetv-support-report-${safeTimestamp}.json`;
}
