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
import type { DeviceInfo, SupportDiagnostics } from "./control-center-types";
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
    <div className="mx-auto grid max-w-[1180px] gap-4 py-6">
      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        <Card size="sm">
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
            <dl className="grid gap-2 sm:grid-cols-2">
              <SupportFact
                label="Device"
                value={device?.deviceId || device?.board || "Not available"}
              />
              <SupportFact
                label="Address"
                value={formatDeviceAddress(device?.target)}
              />
              <SupportFact
                label="Firmware"
                value={device?.firmware || "Not available"}
              />
              <SupportFact
                label="Active theme"
                value={activeThemeLabel(device)}
              />
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
            <CardTitle>Support report</CardTitle>
            <CardDescription>
              Create a diagnostic file when support asks for it.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 items-center">
            <SupportReportActions
              busyAction={busyAction}
              diagnostics={diagnostics}
              onCreate={onLoadDiagnostics}
            />
          </CardContent>
        </Card>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
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
              <AlertTitle>{formatCustomerSupportText(lastError.message)}</AlertTitle>
              <AlertDescription>{formatCustomerSupportText(lastError.nextAction)}</AlertDescription>
            </Alert>
          ) : null}
          {events.length ? (
            <div className="max-h-[320px] overflow-y-auto rounded-lg border">
              <ItemGroup className="gap-0 divide-y">
                {events.map((event) => (
                  <Item className="rounded-none border-0" key={event.id} size="sm">
                    <ItemMedia variant="icon"><Activity aria-hidden /></ItemMedia>
                    <ItemContent>
                      <ItemTitle>{formatCustomerSupportText(event.label)}</ItemTitle>
                      {event.detail ? <ItemDescription className="line-clamp-none break-words">{formatCustomerSupportText(event.detail)}</ItemDescription> : null}
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


function activeThemeLabel(device: DeviceInfo | null | undefined): string {
  const theme = device?.activeTheme?.trim();
  if (!theme) return device?.connected ? "Default" : "Not available";
  return theme.split(/[-_]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
