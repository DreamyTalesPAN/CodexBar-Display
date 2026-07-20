"use client";

import {
  Activity,
  AlertTriangle,
  ArrowUpFromLine,
  Clock,
  Monitor,
  Palette,
  RefreshCw,
  Wifi,
} from "lucide-react";
import type { ReactNode } from "react";
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
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import type { DeviceInfo, SupportDiagnostics } from "./control-center-types";
import { providerSetupStatusLabel } from "./provider-setup-card";
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
  const deviceConnected = Boolean(device?.connected);

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
                {deviceConnected ? "Connected" : "Not connected"}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="flex-1">
            <ItemGroup className="gap-0">
              <SupportDeviceFact
                icon={<Monitor aria-hidden />}
                label="Device"
                value={device?.deviceId || device?.board || "Not available"}
              />
              <ItemSeparator />
              <SupportDeviceFact
                icon={<Wifi aria-hidden />}
                label="Address"
                value={formatDeviceAddress(device?.target)}
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
                {busyAction === "reset-setup" ? "Resetting setup" : "Run setup again"}
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
            <CardAction>
              <SupportReportActions
                busyAction={busyAction}
                diagnostics={diagnostics}
                onCreate={onLoadDiagnostics}
              />
            </CardAction>
          </CardHeader>
          <CardContent>
            {diagnostics ? (
              <div className="grid gap-5">
                <dl className="grid gap-2 sm:grid-cols-2">
                  <DiagnosticFact label="Generated" value={formatDiagnosticTime(diagnostics.generatedAt)} />
                  <DiagnosticFact label="Mac App" value={formatAppVersion(diagnostics)} />
                  <DiagnosticFact label="Background runtime" value={formatRuntimeVersion(diagnostics)} />
                  <DiagnosticFact label="CodexBar" value={formatCodexBarStatus(diagnostics)} />
                  <DiagnosticFact label="AI provider" value={providerSetupStatusLabel(diagnostics.providerSetup)} />
                  <DiagnosticFact label="VibeTV address" value={formatDeviceAddress(diagnostics.device?.target)} />
                  <DiagnosticFact
                    label="Device"
                    value={diagnostics.device?.connected ? diagnostics.device.board || "Connected" : "Not connected"}
                  />
                  <DiagnosticFact label="VibeTV firmware" value={diagnostics.device?.firmware || "Unknown"} />
                  <DiagnosticFact
                    label="VibeTV ID"
                    value={diagnostics.device?.deviceId || diagnostics.configuration?.deviceId || "Unknown"}
                  />
                  <DiagnosticFact label="Paired and ready" value={formatDeviceReadiness(diagnostics)} />
                  <DiagnosticFact label="VibeTVs on WiFi" value={formatNetworkDiscovery(diagnostics)} />
                </dl>

                {diagnostics.networkDiscovery?.devices?.length ? (
                  <section aria-labelledby="wifi-vibetvs-heading">
                    <h4 className="mb-3 text-sm font-bold" id="wifi-vibetvs-heading">
                      VibeTVs found on this WiFi
                    </h4>
                    <ItemGroup>
                      {diagnostics.networkDiscovery.devices.map((candidate) => (
                        <Item key={`${candidate.deviceId || "device"}-${candidate.target}`} variant="outline">
                          <ItemMedia variant="icon"><Wifi aria-hidden /></ItemMedia>
                          <ItemContent>
                            <ItemTitle>{candidate.deviceId || candidate.board || "VibeTV"}</ItemTitle>
                            <ItemDescription>
                              {formatDeviceAddress(candidate.target)}
                              {candidate.active ? " · Active" : candidate.known ? " · Known" : ""}
                            </ItemDescription>
                          </ItemContent>
                        </Item>
                      ))}
                    </ItemGroup>
                  </section>
                ) : null}

                <ItemGroup>
                  {(diagnostics.checks || []).map((check) => (
                    <Item key={`${check.name}-${check.status}`} variant="outline">
                      <ItemMedia>
                        <Badge variant={check.status === "pass" ? "default" : check.status === "fail" ? "destructive" : "outline"}>
                          {check.status}
                        </Badge>
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle>{formatCheckName(check.name)}</ItemTitle>
                        {check.detail ? <ItemDescription className="line-clamp-none break-words">{formatCustomerSupportText(check.detail)}</ItemDescription> : null}
                        {check.nextAction ? <ItemDescription className="line-clamp-none break-words">{formatCustomerSupportText(check.nextAction)}</ItemDescription> : null}
                      </ItemContent>
                    </Item>
                  ))}
                </ItemGroup>
              </div>
            ) : (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyMedia variant="icon"><AlertTriangle aria-hidden /></EmptyMedia>
                  <EmptyTitle>No support report yet</EmptyTitle>
                  <EmptyDescription>Create one when support asks for it.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>Connection and setup activity from this session.</CardDescription>
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
              <AlertTitle>{formatCustomerSupportText(lastError.message)}</AlertTitle>
              <AlertDescription>{formatCustomerSupportText(lastError.nextAction)}</AlertDescription>
            </Alert>
          ) : null}
          {events.length ? (
            <ItemGroup>
              {events.map((event) => (
                <Item key={event.id} variant="outline">
                  <ItemMedia variant="icon"><Activity aria-hidden /></ItemMedia>
                  <ItemContent>
                    <ItemTitle>{formatCustomerSupportText(event.label)}</ItemTitle>
                    {event.detail ? <ItemDescription className="line-clamp-none break-words">{formatCustomerSupportText(event.detail)}</ItemDescription> : null}
                  </ItemContent>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock size={15} aria-hidden />
                    <span>{event.timestamp || "Session"}</span>
                  </div>
                </Item>
              ))}
            </ItemGroup>
          ) : (
            <Empty className="border">
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

function SupportDeviceFact({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <Item size="sm">
      <ItemMedia variant="icon">{icon}</ItemMedia>
      <ItemContent>
        <ItemDescription>{label}</ItemDescription>
        <ItemTitle className="break-words">{value}</ItemTitle>
      </ItemContent>
    </Item>
  );
}

function DiagnosticFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs font-semibold uppercase text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium">{value}</dd>
    </div>
  );
}

function formatCheckName(name: string): string {
  if (name.trim().toLowerCase() === "companion") return "Mac App";
  return formatCustomerSupportText(
    name
      .split("_")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" "),
  );
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
    .replace(/\bCOMPANION_UNREACHABLE\b/g, "Mac App needs setup")
    .replace(/\bCLIENT_ERROR\b/g, "Something needs attention")
    .replace(/\bHTTP_\d+\b/g, "Connection failed")
    .replace(/https?:\/\/\S+/g, "saved link");
}

function formatDeviceAddress(value?: string): string {
  return value?.trim().replace(/^https?:\/\//i, "") || "Not configured";
}

function formatDiagnosticTime(value?: string): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}

function formatCodexBarStatus(diagnostics: SupportDiagnostics): string {
  const engine = diagnostics.providerSetup?.engine;
  if (!engine) return "Unknown";
  if (engine.status === "ready") return engine.version ? `Ready ${engine.version}` : "Ready";
  if (engine.status === "config_error") return "Settings need attention";
  return "Setup needed";
}

function formatAppVersion(diagnostics: SupportDiagnostics): string {
  const app = diagnostics.companion?.app;
  const version = app?.version || diagnostics.companion?.version;
  if (!version) return "Unknown";
  return app?.build ? `${version} (${app.build})` : version;
}

function formatRuntimeVersion(diagnostics: SupportDiagnostics): string {
  const runtime = diagnostics.companion?.runtime;
  if (!runtime?.version) return "Unknown";
  return runtime.commit ? `${runtime.version} · ${runtime.commit.slice(0, 10)}` : runtime.version;
}

function formatDeviceReadiness(diagnostics: SupportDiagnostics): string {
  const reportDevice = diagnostics.device;
  if (!reportDevice?.paired) return reportDevice?.connected ? "Connected, not paired" : "Not paired";
  return reportDevice.ready ? "Paired and ready" : "Paired, not ready";
}

function formatNetworkDiscovery(diagnostics: SupportDiagnostics): string {
  const discovery = diagnostics.networkDiscovery;
  if (!discovery?.attempted) return "Not checked";
  if (discovery.errorCode) return "Search needs attention";
  const count = discovery.devices?.length || 0;
  return count === 0 ? "None found" : `${count} found`;
}

function activeThemeLabel(device: DeviceInfo | null | undefined): string {
  const theme = device?.activeTheme?.trim();
  if (!theme) return device?.connected ? "Default" : "Not available";
  return theme.split(/[-_]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
