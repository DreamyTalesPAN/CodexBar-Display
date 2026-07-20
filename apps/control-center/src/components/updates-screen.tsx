"use client";

import {
  Download,
  Monitor,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import type { ReactNode } from "react";
import {
  availableMacAppDmgDownloadUrl,
  type CompanionReleaseInfo,
} from "@/lib/companion-release";
import { hasFirmwareUpdate, type FirmwareUpdateInfo } from "@/lib/firmware";
import type { CompanionInfo } from "./control-center-types";

export type UpdatesCompanionStatus = "unknown" | "online" | "missing";

export type UpdatesDeviceInfo = {
  connected: boolean;
  board?: string;
  firmware?: string;
};

export type FirmwareUpdateStatus = {
  phase: "installing" | "complete" | "attention" | "error";
  stage?: string;
  outcome?: string;
  retryAllowed?: boolean;
  startedAt: string;
  finishedAt?: string;
  message?: string;
  progress?: number;
  logs: string[];
  result?: {
    firmware?: string;
    target?: string;
    deviceId?: string;
    artifactValidated?: boolean;
    uploadAccepted?: boolean;
    helloVerified?: boolean;
    healthVerified?: boolean;
    streamVerified?: boolean;
    renderVerified?: boolean;
  };
  error?: string;
};

export type UpdatesScreenProps = {
  companionStatus: UpdatesCompanionStatus;
  device: UpdatesDeviceInfo | null;
  companionVersion?: string;
  companionInfo?: CompanionInfo | null;
  companionRelease?: CompanionReleaseInfo | null;
  firmwareUpdate?: FirmwareUpdateInfo | null;
  onCheckUpdates?: () => Promise<void> | void;
  onCreateReport?: () => void;
  onInstallUpdate?: () => Promise<boolean> | boolean | void;
  requiresMacAppMigration?: boolean;
  busyAction?: string | null;
  updateStatus?: FirmwareUpdateStatus | null;
};

export function UpdatesScreen({
  companionStatus,
  device,
  companionVersion,
  companionInfo,
  companionRelease = null,
  firmwareUpdate,
  onCheckUpdates,
  onCreateReport,
  onInstallUpdate,
  requiresMacAppMigration = false,
  busyAction,
  updateStatus,
}: UpdatesScreenProps) {
  const firmwareUpdateCompleted = updateStatus?.phase === "complete";
  const installedFirmware =
    updateStatus?.result?.firmware ||
    firmwareUpdate?.installedFirmware ||
    device?.firmware ||
    "Unknown";
  const canCheckFirmware = Boolean(device?.board && device?.firmware);
  const checking = Boolean(canCheckFirmware && !firmwareUpdate);
  const macAppRunning = companionStatus === "online";
  const checkingMacApp = Boolean(macAppRunning && !companionRelease);
  const checkingUpdates = checking || checkingMacApp;
  const latestFirmware =
    updateStatus?.result?.firmware ||
    firmwareUpdate?.latestFirmware ||
    (checking ? "Checking" : "Not available");
  const updateAvailable =
    !firmwareUpdateCompleted && hasFirmwareUpdate(firmwareUpdate);
  const macAppUpdateAvailable = Boolean(companionRelease?.updateAvailable);
  const nativeMacUpdateReady = Boolean(
    macAppUpdateAvailable && companionInfo?.app?.installedInApplications,
  );
  const verifiedDmgDownloadUrl = availableMacAppDmgDownloadUrl(companionRelease);
  const macAppMigrationReady = Boolean(
    requiresMacAppMigration && verifiedDmgDownloadUrl,
  );
  const macAppDownloadUrl =
    macAppMigrationReady || macAppUpdateAvailable
      ? verifiedDmgDownloadUrl
      : undefined;
  const macAppDownloadReady = Boolean(macAppDownloadUrl);
  const macAppDownloadAction =
    macAppMigrationReady || (macAppUpdateAvailable && !nativeMacUpdateReady);
  const macAppNativeAction = nativeMacUpdateReady;
  const anyUpdateAvailable =
    updateAvailable || macAppDownloadAction || macAppNativeAction;
  const refreshing = busyAction === "firmware-check";
  const installingUpdate = updateStatus
    ? updateStatus.phase === "installing"
    : busyAction === "firmware-update";
  const installingAnyUpdate = installingUpdate;
  const creatingReport = busyAction === "diagnostics";
  const macAppCheckFailed =
    macAppRunning &&
    (companionRelease?.status === "check_failed" ||
      companionRelease?.dmgDownloadStatus === "check_failed");
  const firmwareCheckFailed = firmwareUpdate?.status === "check_failed";
  const status = firmwareUpdateCompleted
    ? "Up to date"
    : checking
    ? "Checking"
    : firmwareCheckFailed
      ? "Check failed"
      : !canCheckFirmware && !firmwareUpdate
        ? "Not available"
        : updateAvailable
          ? "Update available"
          : "Up to date";
  const companionReleaseStatus = companionReleaseLabel({
    macAppRunning,
    migrationReady: macAppMigrationReady,
    migrationRequired: requiresMacAppMigration,
    release: companionRelease,
  });
  const companionInstalled =
    companionStatus === "missing"
      ? "Not running"
      : companionInfo?.app?.version || companionVersion || "Unknown";
  const companionAvailable =
    companionRelease?.latestVersion || companionRelease?.release || "Checking";
  const pageStatusHeading =
    macAppCheckFailed || firmwareCheckFailed
      ? "Update check failed"
      : anyUpdateAvailable
        ? "Update available"
        : checkingUpdates
          ? "Checking updates"
          : "Up to date";

  async function runPrimaryUpdate() {
    if (updateAvailable) {
      await onInstallUpdate?.();
      return;
    }

    if (macAppCheckFailed) {
      await onCheckUpdates?.();
      return;
    }

    if (macAppDownloadAction) {
      return;
    }

    if (!anyUpdateAvailable) {
      await onCheckUpdates?.();
      return;
    }
  }

  return (
    <div className="mx-auto flex max-w-[1040px] flex-col gap-4 py-4">
      <h2 className="text-2xl font-black">{pageStatusHeading}</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <UpdateCard
          description="Software running on this Mac."
          installedLabel="Installed"
          installedValue={companionInstalled}
          latestLabel="Available"
          latestValue={companionAvailable}
          status={companionReleaseStatus}
          title="Mac App"
          updateAvailable={macAppUpdateAvailable || requiresMacAppMigration}
        />

        <UpdateCard
          description="Software running on your VibeTV."
          installedLabel="Installed firmware"
          installedValue={installedFirmware}
          latestLabel="Available firmware"
          latestValue={latestFirmware}
          status={status}
          title="Firmware update"
          updateAvailable={updateAvailable}
        >
          {updateStatus ? (
            <InlineUpdateProgress
              creatingReport={creatingReport}
              onCreateReport={onCreateReport}
              onRetry={onInstallUpdate}
              status={updateStatus}
            />
          ) : null}
        </UpdateCard>
      </div>

      <PrimaryUpdateAction
        checking={checkingUpdates || refreshing}
        disabled={
          installingAnyUpdate ||
          Boolean(busyAction && busyAction !== "firmware-check")
        }
        downloadUrl={macAppDownloadUrl}
        nativeUpdateUrl={
          macAppNativeAction ? "vibetv://check-for-updates" : undefined
        }
        installingFirmware={installingUpdate}
        firmwareUpdateAvailable={updateAvailable}
        macAppCheckFailed={macAppCheckFailed}
        macAppMigrationRequired={requiresMacAppMigration}
        macAppMigrationReady={macAppMigrationReady}
        macAppUpdateAvailable={macAppUpdateAvailable}
        onClick={runPrimaryUpdate}
        updateReady={Boolean(
          updateAvailable
            ? onInstallUpdate
            : macAppCheckFailed
              ? onCheckUpdates
              : requiresMacAppMigration || macAppUpdateAvailable
                ? macAppDownloadReady
                : anyUpdateAvailable || onCheckUpdates,
        )}
      />
    </div>
  );
}

function PrimaryUpdateAction({
  checking,
  disabled,
  downloadUrl,
  nativeUpdateUrl,
  firmwareUpdateAvailable,
  installingFirmware,
  macAppCheckFailed,
  macAppMigrationRequired,
  macAppMigrationReady,
  macAppUpdateAvailable,
  onClick,
  updateReady,
}: {
  checking: boolean;
  disabled: boolean;
  downloadUrl?: string;
  nativeUpdateUrl?: string;
  firmwareUpdateAvailable: boolean;
  installingFirmware: boolean;
  macAppCheckFailed: boolean;
  macAppMigrationRequired: boolean;
  macAppMigrationReady: boolean;
  macAppUpdateAvailable: boolean;
  onClick: () => void | Promise<void>;
  updateReady: boolean;
}) {
  if (
    macAppUpdateAvailable &&
    nativeUpdateUrl &&
    !disabled &&
    !checking
  ) {
    return (
      <Button asChild className="h-14 w-full text-base font-bold" size="lg">
        <a href={nativeUpdateUrl}>
          <Download data-icon="inline-start" />
          <span>Update</span>
        </a>
      </Button>
    );
  }

  if (
    (macAppMigrationReady || macAppUpdateAvailable) &&
    downloadUrl &&
    !disabled &&
    !checking
  ) {
    return (
      <Button asChild className="h-14 w-full text-base font-bold" size="lg">
        <a href={downloadUrl}>
          <Download data-icon="inline-start" />
          <span>Update</span>
        </a>
      </Button>
    );
  }

  const label = installingFirmware
    ? "Updating VibeTV"
    : firmwareUpdateAvailable
      ? "Update"
      : macAppMigrationRequired
        ? macAppCheckFailed
          ? "Check again"
          : "Update"
        : macAppUpdateAvailable
          ? "Update"
          : checking
            ? "Checking updates"
            : "Check for updates";
  const icon = installingFirmware || checking ? (
    <Spinner data-icon="inline-start" />
  ) : firmwareUpdateAvailable ? (
    <Download data-icon="inline-start" aria-hidden />
  ) : macAppCheckFailed ? (
    <RefreshCw data-icon="inline-start" aria-hidden />
  ) : macAppMigrationRequired ? (
    <Download data-icon="inline-start" aria-hidden />
  ) : (
    <RefreshCw data-icon="inline-start" aria-hidden />
  );

  return (
    <Button
      className="h-14 w-full text-base font-bold"
      disabled={
        disabled ||
        checking ||
        !updateReady ||
        (!firmwareUpdateAvailable &&
          macAppMigrationRequired &&
          !macAppCheckFailed) ||
        (!firmwareUpdateAvailable &&
          macAppUpdateAvailable &&
          !macAppCheckFailed)
      }
      onClick={onClick}
      size="lg"
      type="button"
    >
      {icon}
      <span>{label}</span>
    </Button>
  );
}

function InlineUpdateProgress({
  creatingReport,
  onCreateReport,
  onRetry,
  status,
}: {
  creatingReport: boolean;
  onCreateReport?: () => void;
  onRetry?: () => void;
  status: FirmwareUpdateStatus;
}) {
  const failed = status.phase === "error";
  const complete = status.phase === "complete";
  const attention = status.phase === "attention";
  const progress = clampUpdateProgress(
    failed || complete || attention ? 100 : status.progress,
  );
  const title = failed
    ? "Update failed"
    : attention
      ? "Firmware current — attention needed"
    : complete
      ? "Update complete"
      : "Updating VibeTV";
  const detail = failed
    ? status.error || "Update was not installed."
    : attention
      ? status.message ||
        "The firmware is current, but the connection or picture still needs repair."
    : complete
      ? status.result?.firmware
        ? `Firmware ${status.result.firmware} is installed.`
        : "VibeTV is up to date."
      : status.message ||
        status.logs[status.logs.length - 1] ||
        "Preparing VibeTV update.";
  return (
    <div className="flex flex-col gap-3" role="status" aria-live="polite">
      <Progress value={progress} />
      <Alert variant={failed ? "destructive" : "default"}>
        {failed ? (
          <X aria-hidden />
        ) : complete || attention ? (
          <ShieldCheck aria-hidden />
        ) : (
          <RefreshCw className="animate-spin" aria-hidden />
        )}
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{detail}</AlertDescription>
        {failed || attention ? (
          <AlertAction className="flex gap-2">
            {failed && status.retryAllowed !== false ? (
              <Button
                disabled={!onRetry}
                onClick={onRetry}
                size="sm"
                type="button"
                variant="outline"
              >
                Try again
              </Button>
            ) : null}
            <Button
              disabled={!onCreateReport || creatingReport}
              onClick={onCreateReport}
              size="sm"
              type="button"
            >
              {creatingReport ? <Spinner data-icon="inline-start" /> : null}
              <span>{creatingReport ? "Creating report" : "Create report"}</span>
            </Button>
          </AlertAction>
        ) : null}
      </Alert>
    </div>
  );
}

function UpdateCard({
  children,
  description,
  installedLabel,
  installedValue,
  latestLabel,
  latestValue,
  status,
  title,
  updateAvailable = false,
}: {
  children?: ReactNode;
  description: string;
  installedLabel: string;
  installedValue: string;
  latestLabel: string;
  latestValue: string;
  status: string;
  title: string;
  updateAvailable?: boolean;
}) {
  return (
    <Card className="border-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <Badge
            variant={updateAvailable ? "default" : statusBadgeVariant(status)}
          >
            {status}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ItemGroup>
          <VersionItem
            icon={<Monitor aria-hidden />}
            label={installedLabel}
            value={installedValue}
          />
          <VersionItem
            icon={<RefreshCw aria-hidden />}
            label={latestLabel}
            highlighted={updateAvailable}
            value={latestValue}
          />
          <VersionItem
            icon={<ShieldCheck aria-hidden />}
            label="Status"
            highlighted={updateAvailable}
            value={status}
          />
        </ItemGroup>
        {children}
      </CardContent>
    </Card>
  );
}

function VersionItem({
  highlighted = false,
  icon,
  label,
  value,
}: {
  highlighted?: boolean;
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Item role="listitem" variant="muted">
      <ItemMedia variant="icon">{icon}</ItemMedia>
      <ItemContent>
        <ItemTitle>{label}</ItemTitle>
      </ItemContent>
      <ItemActions>
        <Badge variant={highlighted ? "default" : "secondary"}>{value}</Badge>
      </ItemActions>
    </Item>
  );
}

function statusBadgeVariant(
  status: string,
): "default" | "secondary" | "destructive" {
  const normalized = status.toLowerCase();
  if (normalized.includes("fail")) {
    return "destructive";
  }
  if (normalized.includes("checking") || normalized.includes("not available")) {
    return "secondary";
  }
  if (
    normalized.includes("available") ||
    normalized.includes("complete") ||
    normalized.includes("connected") ||
    normalized.includes("current") ||
    normalized.includes("needed") ||
    normalized.includes("online") ||
    normalized.includes("ready") ||
    normalized.includes("saved") ||
    normalized.includes("success") ||
    normalized.includes("waiting") ||
    normalized.includes("up to date") ||
    normalized.includes("valid") ||
    normalized.includes("setup")
  ) {
    return "default";
  }
  return "secondary";
}

function companionReleaseLabel({
  macAppRunning,
  migrationReady,
  migrationRequired,
  release,
}: {
  macAppRunning: boolean;
  migrationReady: boolean;
  migrationRequired: boolean;
  release: CompanionReleaseInfo | null;
}): string {
  if (macAppRunning) {
    if (migrationRequired) {
      if (
        release?.status === "check_failed" ||
        release?.dmgDownloadStatus === "check_failed"
      ) {
        return "Check failed";
      }
      return migrationReady ? "Update available" : "Update not ready";
    }
    if (release?.updateAvailable) {
      return availableMacAppDmgDownloadUrl(release)
        ? "Update available"
        : "Update waiting";
    }
    if (
      release?.status === "check_failed" ||
      release?.dmgDownloadStatus === "check_failed"
    ) {
      return "Check failed";
    }
    return "Ready";
  }
  if (!release) {
    return "Checking";
  }
  if (release.status === "available") {
    return "Setup needed";
  }
  if (release.status === "missing_asset") {
    return "Setup needed";
  }
  return "Check failed";
}

function clampUpdateProgress(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 5;
  }
  return Math.max(5, Math.min(100, Math.round(value)));
}
