"use client";

import {
  CircleAlert,
  CircleCheck,
  Download,
  Monitor,
  RefreshCw,
  Tv,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Children, useState, type ReactNode } from "react";
import {
  availableMacAppDmgDownloadUrl,
  type CompanionReleaseInfo,
} from "@/lib/companion-release";
import { hasFirmwareUpdate, type FirmwareUpdateInfo } from "@/lib/firmware";
import { copyForHost, statusForHost } from "@/lib/customer-platform";
import { WHATS_NEW } from "@/lib/whats-new";
import type { CompanionInfo } from "./control-center-types";
import { ProcessSteps } from "./process-steps";
import { SetupDialog } from "./setup/setup-dialog";
import { clampProgress } from "./update-jobs";

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
    observedFirmware?: string;
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
  dialogs: ReturnType<typeof useUpdatesDialogs>;
  companionStatus: UpdatesCompanionStatus;
  device: UpdatesDeviceInfo | null;
  companionVersion?: string;
  companionInfo?: CompanionInfo | null;
  companionRelease?: CompanionReleaseInfo | null;
  firmwareUpdate?: FirmwareUpdateInfo | null;
  onCheckUpdates?: () => Promise<void> | void;
  onCreateReport?: () => void;
  onInstallUpdate?: () => Promise<boolean> | boolean | void;
  onRetryThemeUpdate?: () => Promise<boolean> | boolean | void;
  /** Opens the "What's new" notice again. */
  onShowWhatsNew?: () => void;
  /** Another dialog of the app is open (the notes, usage recovery, system busy): a failed check waits until it is closed. */
  otherDialogOpen?: boolean;
  requiresMacAppMigration?: boolean;
  busyAction?: string | null;
  updateStatus?: FirmwareUpdateStatus | null;
  supportReportBusy?: boolean;
  themeUpdateAvailable?: boolean;
  /** The app runs on Windows; the Mac wording stays exactly as it is. */
  windowsHost?: boolean;
};

// The app owns these keys so closing a notice also survives leaving Updates.
export function useUpdatesDialogs({
  companionStatus, device, firmwareUpdate, companionRelease, busyAction,
}: Pick<UpdatesScreenProps, "companionStatus" | "device" | "firmwareUpdate" | "companionRelease" | "busyAction">) {
  // Only a newer failed check may open a closed notice again.
  // One per check: a refresh of the firmware alone must not bring back a Mac
  // App failure the customer closed, and the other way round.
  const [dismissedMacAppCheck, setDismissedMacAppCheck] = useState<string | null>(null);
  const [dismissedFirmwareCheck, setDismissedFirmwareCheck] = useState<string | null>(null);
  // Every check that runs to its end -- "Try again", the header button or
  // the app's own -- may fail anew, so its end lifts the dismissal. Its
  // answer can carry the same second as the failure before, so the end of the
  // check, not a new timestamp, is what opens the dialog again. "Try again"
  // hides the dialog until its check has started.
  const [retryingFailedCheck, setRetryingFailedCheck] = useState(false);
  // The failed-check dialog also needs to know if the update error is open.
  const [dismissedUpdateError, setDismissedUpdateError] = useState<string | null>(null);
  const [macAppCheckWasBusy, setMacAppCheckWasBusy] = useState(false);
  const [firmwareCheckWasBusy, setFirmwareCheckWasBusy] = useState(false);
  const checking = Boolean(device?.board && device?.firmware && !firmwareUpdate);
  const checkingMacApp = Boolean(companionStatus === "online" && !companionRelease);
  const refreshing = busyAction === "firmware-check";
  const checkBusy = checking || checkingMacApp || refreshing;
  // A started check (the header button runs both) hides a pending retry;
  // the end of a check lifts only that check's dismissal.
  const macAppCheckBusy = checkingMacApp || refreshing;
  const firmwareCheckBusy = checking || refreshing;
  if (checkBusy && retryingFailedCheck && (macAppCheckBusy || firmwareCheckBusy)) {
    setRetryingFailedCheck(false);
  }
  if (macAppCheckBusy !== macAppCheckWasBusy) {
    setMacAppCheckWasBusy(macAppCheckBusy);
    if (!macAppCheckBusy) setDismissedMacAppCheck(null);
  }
  if (firmwareCheckBusy !== firmwareCheckWasBusy) {
    setFirmwareCheckWasBusy(firmwareCheckBusy);
    if (!firmwareCheckBusy) setDismissedFirmwareCheck(null);
  }
  return {
    dismissedMacAppCheck, setDismissedMacAppCheck,
    dismissedFirmwareCheck, setDismissedFirmwareCheck,
    dismissedUpdateError, setDismissedUpdateError,
    retryingFailedCheck, setRetryingFailedCheck,
    checking, checkingMacApp,
  };
}

export function UpdatesScreen({
  dialogs,
  companionStatus,
  device,
  companionVersion,
  companionInfo,
  companionRelease = null,
  firmwareUpdate,
  onCheckUpdates,
  onCreateReport,
  onInstallUpdate,
  onRetryThemeUpdate,
  onShowWhatsNew,
  otherDialogOpen = false,
  requiresMacAppMigration = false,
  busyAction,
  updateStatus,
  supportReportBusy = false,
  themeUpdateAvailable = false,
  windowsHost = false,
}: UpdatesScreenProps) {
  const {
    dismissedMacAppCheck, setDismissedMacAppCheck,
    dismissedFirmwareCheck, setDismissedFirmwareCheck,
    dismissedUpdateError, setDismissedUpdateError,
    retryingFailedCheck, setRetryingFailedCheck,
    checking, checkingMacApp,
  } = dialogs;
  const firmwareUpdateCompleted = updateStatus?.phase === "complete";
  // Installed firmware always comes from device truth (live hello or the
  // firmware update check), never from an update job result: a failed job
  // must not claim its target version is installed.
  const installedFirmware =
    device?.firmware || firmwareUpdate?.installedFirmware || "Unknown";
  const canCheckFirmware = Boolean(device?.board && device?.firmware);
  const macAppRunning = companionStatus === "online";
  const checkingUpdates = checking || checkingMacApp;
  // A completed job suppresses only its own stale aftermath: as long as the
  // fresh check still reports the version the job installed (or has not
  // resolved yet), "Update complete" stands alone and never advertises
  // "Update available" next to it. A later check that discovers a different
  // release is a new update and must show — status polling restores the
  // completed job indefinitely, so completion alone can never gate future
  // updates.
  const staleCompletedCheck = Boolean(
    firmwareUpdateCompleted &&
      (!firmwareUpdate?.latestFirmware ||
        firmwareUpdate.latestFirmware === updateStatus?.result?.firmware),
  );
  const updateAvailable =
    !staleCompletedCheck && hasFirmwareUpdate(firmwareUpdate);
  const vibetvUpdateAvailable =
    !staleCompletedCheck && (updateAvailable || themeUpdateAvailable);
  // A finished failure describes an update that is no longer pending once a
  // fresh check reports nothing to install. Keeping it would tell the customer
  // to power-cycle for an update that does not exist; while the update really
  // is still pending, the failure and its advice stay. A failed check is not
  // conclusive: it proved nothing about the pending update, so the failure
  // details and their recovery action must survive it.
  const staleFirmwareFailure = Boolean(
    updateStatus?.phase === "error" &&
      firmwareUpdate &&
      firmwareUpdate.status !== "check_failed" &&
      !updateAvailable,
  );
  const visibleUpdateStatus = staleFirmwareFailure
    ? undefined
    : statusForHost(updateStatus, windowsHost);
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
  const macAppDownloadAction =
    macAppMigrationReady || (macAppUpdateAvailable && !nativeMacUpdateReady);
  const macAppNativeAction = nativeMacUpdateReady;
  const macAppMustUpdateFirst =
    macAppDownloadAction || macAppNativeAction;
  // The firmware stays locked while the Mac App release check is still
  // unresolved, not only when it already reported an update: otherwise a
  // click in that window starts the firmware job before the Mac-App-first
  // rule can engage (the mixed state new-firmware/old-app must never be
  // enterable from here).
  const firmwareUpdateBlocked =
    vibetvUpdateAvailable && (macAppMustUpdateFirst || checkingMacApp);
  // A required migration with nothing verified to download keeps the firmware
  // locked above, but it is no update the customer can take: no "Update
  // available" beside a closed button (Codex review on #798).
  const macAppDownloadOffered =
    macAppDownloadAction && !(requiresMacAppMigration && !verifiedDmgDownloadUrl);
  // Only a Mac App that must update first and has nothing to start takes the
  // firmware out of the headline; while its check is still open it stays.
  const anyUpdateAvailable =
    (vibetvUpdateAvailable && !macAppMustUpdateFirst) ||
    macAppDownloadOffered ||
    macAppNativeAction;
  const refreshing = busyAction === "firmware-check";
  const installingUpdate = updateStatus
    ? updateStatus.phase === "installing"
    : busyAction === "firmware-update";
  const installingAnyUpdate = installingUpdate;
  const creatingReport = supportReportBusy;
  // An installed app's status is the runtime's answer, so a failed hosted DMG check does not fail it (#798).
  const macAppCheckFailed =
    macAppRunning &&
    (companionRelease?.status === "check_failed" ||
      (!companionInfo?.app?.installedInApplications &&
        companionRelease?.dmgDownloadStatus === "check_failed"));
  const firmwareCheckFailed = firmwareUpdate?.status === "check_failed";
  // A newer failed check is a new failure and opens again; a check that
  // answered is not part of it.
  const macAppFailedKey = macAppCheckFailed ? companionRelease?.checkedAt ?? "" : null;
  const firmwareFailedKey = firmwareCheckFailed ? firmwareUpdate?.checkedAt ?? "" : null;
  const undismissedFailure =
    (macAppFailedKey !== null && macAppFailedKey !== dismissedMacAppCheck) ||
    (firmwareFailedKey !== null && firmwareFailedKey !== dismissedFirmwareCheck);
  const companionInstalled =
    companionStatus === "missing"
      ? "Not running"
      : companionInfo?.app?.version || companionVersion || "Unknown";
  // The answer was neither "current" nor an update nor a failure (no release
  // for this board, not supported over this connection): never "up to date".
  const firmwareNoAnswer = Boolean(
    !macAppRunning ||
      !device?.connected ||
      !canCheckFirmware ||
      !firmwareUpdate ||
      !["current", "update_available", "check_failed"].includes(firmwareUpdate.status),
  );
  // The Mac App check answered, but not with "available" (disabled, or no
  // asset to install): that does not establish the app is current either.
  // The same holds for a required migration that has nothing verified to
  // download (the release says "available" but the download is "missing_asset"
  // or "disabled"): the Update button stays closed, and the page must not claim
  // "Everything is up to date" next to it. "available" without an installed
  // version does not establish that the app is current either.
  const macAppMigrationBlocked = Boolean(
    requiresMacAppMigration && !verifiedDmgDownloadUrl,
  );
  const macAppNoAnswer = Boolean(
    !macAppRunning ||
      !companionRelease ||
      (!macAppCheckFailed &&
        (companionRelease.status !== "available" ||
          !companionRelease.installedVersion ||
          macAppMigrationBlocked)),
  );
  const pageStatusHeading =
    installingUpdate
      ? updateStatus?.stage === "rebooting" ||
        updateStatus?.stage === "rediscovering"
        ? "VibeTV is restarting"
        : "Updating VibeTV"
      : // A check the customer started keeps the old answers until it
        // answers; it says what is happening now, not the old result.
        refreshing
        ? "Checking for updates"
        : macAppCheckFailed || firmwareCheckFailed
        ? "Update check failed"
        : anyUpdateAvailable
          ? "Update available"
          : checkingUpdates
            ? "Checking for updates"
            : firmwareNoAnswer || macAppNoAnswer
              ? "No update available"
              : "Everything is up to date";
  const headingTone: Tone = installingUpdate
    ? "ink"
    : refreshing
      ? "muted"
      : macAppCheckFailed || firmwareCheckFailed
        ? "failed"
        : anyUpdateAvailable
          ? "ink"
      : checkingUpdates || firmwareNoAnswer || macAppNoAnswer
        ? "muted"
        : "ok";

  const checkBusy = checkingUpdates || refreshing;
  const updateErrorOpen =
    visibleUpdateStatus?.phase === "error" &&
    dismissedUpdateError !== visibleUpdateStatus.startedAt;
  const actionsLocked =
    installingAnyUpdate ||
    Boolean(busyAction && busyAction !== "firmware-check");
  // The Mac App row offers its update as a link to the Sparkle updater or the
  // verified download; while that cannot start it is the same button, closed.
  const macAppUpdateOffered = macAppUpdateAvailable || requiresMacAppMigration;
  const macAppUpdateHref = macAppNativeAction
    ? "vibetv://check-for-updates"
    : macAppDownloadUrl;
  const firmwareUpdateOffered = vibetvUpdateAvailable && !firmwareUpdateBlocked;
  // A migration that cannot start yet (no verified download) never takes the
  // one Update away from a firmware update that can.
  const macAppUpdateButton = macAppUpdateOffered ? (
    macAppUpdateHref && !actionsLocked && !checkBusy ? (
      <Button asChild size="sm">
        <a href={macAppUpdateHref}>
          <Download data-icon="inline-start" aria-hidden />
          <span>Update</span>
        </a>
      </Button>
    ) : macAppUpdateAvailable || !firmwareUpdateOffered ? (
      <Button disabled size="sm" type="button">
        <Download data-icon="inline-start" aria-hidden />
        <span>Update</span>
      </Button>
    ) : null
  ) : null;
  const firmwareUpdateButton =
    firmwareUpdateOffered && !installingUpdate ? (
      <Button
        // Not while a check runs or the Mac App check failed: only a check that
        // answered tells whether the Mac App has to come first.
        disabled={
          actionsLocked ||
          checkBusy ||
          macAppCheckFailed ||
          !onInstallUpdate
        }
        onClick={() => void onInstallUpdate?.()}
        size="sm"
        type="button"
      >
        <Download data-icon="inline-start" aria-hidden />
        <span>Update</span>
      </Button>
    ) : null;

  // A firmware answer counts as a finished check even without a release
  // version (no release for this board, or the current version).
  const firmwareCheckAnswered = Boolean(
    firmwareUpdate &&
      ["current", "update_available", "no_board_release"].includes(
        firmwareUpdate.status,
      ),
  );
  const checkedText = lastCheckedText(
    companionRelease?.status === "available" ||
      companionRelease?.status === "disabled"
      ? companionRelease.checkedAt
      : undefined,
    firmwareCheckAnswered ? firmwareUpdate?.checkedAt : undefined,
  );
  const whatsNewTitle =
    companionStatus === "online" && companionInstalled !== "Unknown"
      ? `What's new in ${companionInstalled}`
      : "What's new";

  return (
    <div className="pb-10 text-[14px] leading-normal">
      {/*
        The shell draws the page title on its own line and leaves the right of
        it free; this row sits on that line, as in the design.
      */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3.5 lg:relative lg:-mt-10 lg:h-10 lg:flex-nowrap lg:justify-end">
        {checkedText ? (
          <span className="text-[14px] whitespace-nowrap text-muted-foreground">
            {checkedText}
          </span>
        ) : null}
        <Button
          // During the customer's own check the button looks closed and ignores
          // a second press, but is not disabled: that drops keyboard focus to
          // the page (issue #558).
          aria-disabled={refreshing || undefined}
          className="text-sm aria-disabled:pointer-events-none aria-disabled:opacity-50"
          disabled={
            actionsLocked || (checkingUpdates && !refreshing) || !onCheckUpdates
          }
          onClick={refreshing ? undefined : () => void onCheckUpdates?.()}
          type="button"
          variant="outline"
        >
          {checkBusy ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <RefreshCw data-icon="inline-start" aria-hidden />
          )}
          <span>{checkBusy ? "Checking updates" : "Check for updates"}</span>
        </Button>
      </div>

      <div className="mt-6 flex items-center gap-2.5 sm:mt-8">
        <StatusDot tone={headingTone} />
        <h2 className="text-[15px] font-semibold">{pageStatusHeading}</h2>
      </div>

      <div className="mt-4 divide-y divide-foreground/10 overflow-hidden rounded-[var(--radius-card)] bg-card ring-1 ring-foreground/10">
        <UpdateRow
          action={macAppUpdateButton}
          description={
            macAppUpdateAvailable &&
            (companionRelease?.latestVersion || companionRelease?.release)
              ? `Version ${companionRelease.latestVersion || companionRelease.release} is available`
              : copyForHost("App on this Mac", windowsHost)
          }
          icon={<Monitor aria-hidden />}
          status={
            macAppUpdateOffered
              ? undefined
              : !macAppRunning
                ? undefined
                : macAppCheckFailed
                  ? "failed"
                  : checkingMacApp
                    ? "checking"
                    : macAppNoAnswer
                      ? undefined
                      : "ok"
          }
          title="Control Center"
          version={companionInstalled}
        />

        <UpdateRow
          action={firmwareUpdateButton}
          description={
            updateAvailable && firmwareUpdate?.latestFirmware
              ? `Version ${firmwareUpdate.latestFirmware} is available`
              : vibetvUpdateAvailable
                ? "A theme update is available"
                : "Software on your VibeTV"
          }
          icon={<Tv aria-hidden />}
          status={
            installingUpdate
              ? "installing"
              : firmwareUpdateOffered
                ? undefined
                : vibetvUpdateAvailable
                  ? "waiting"
                  : firmwareCheckFailed
                    ? "failed"
                    : checking
                      ? "checking"
                      : canCheckFirmware && !firmwareNoAnswer
                        ? "ok"
                        : undefined
          }
          note={
            firmwareNoAnswer && macAppRunning && device?.connected && canCheckFirmware &&
            !installingUpdate && !vibetvUpdateAvailable
              ? firmwareUpdate?.message
              : undefined
          }
          title="VibeTV firmware"
          version={installedFirmware}
        >
          {firmwareUpdateBlocked ? (
            <div>
              <p className="font-semibold">
                {macAppMustUpdateFirst
                  ? windowsHost
                    ? "Update the app first"
                    : "Update Mac App first"
                  : windowsHost
                    ? "Checking the app"
                    : "Checking Mac App"}
              </p>
              <p className="text-muted-foreground">
                {macAppMustUpdateFirst
                  ? windowsHost
                    ? "Update the app first. The VibeTV firmware update comes next."
                    : "Update the Mac App first. The VibeTV firmware update comes next."
                  : windowsHost
                    ? "Waiting for the app update check. The VibeTV update unlocks when it finishes."
                    : "Waiting for the Mac App update check. The VibeTV update unlocks when it finishes."}
              </p>
            </div>
          ) : null}
          {visibleUpdateStatus ? (
            <InlineUpdateProgress
              key={visibleUpdateStatus.startedAt}
              errorDismissed={dismissedUpdateError === visibleUpdateStatus.startedAt}
              onDismissError={() => setDismissedUpdateError(visibleUpdateStatus.startedAt)}
              creatingReport={creatingReport}
              onCreateReport={onCreateReport}
              onRetry={
                firmwareUpdateBlocked
                  ? undefined
                  : visibleUpdateStatus.phase === "attention"
                    ? onRetryThemeUpdate
                    : onInstallUpdate
              }
              status={visibleUpdateStatus}
            />
          ) : null}
        </UpdateRow>
      </div>

      {onShowWhatsNew ? (
        <div className="mt-6 flex items-center justify-between gap-4 rounded-[var(--radius-card)] bg-foreground/[0.04] px-5 py-4">
          <div className="min-w-0">
            <p className="font-semibold">{whatsNewTitle}</p>
            {WHATS_NEW.length > 0 ? (
              <p className="text-muted-foreground">
                {WHATS_NEW[WHATS_NEW.length - 1].title}
              </p>
            ) : null}
          </div>
          <Button
            className="h-auto shrink-0 px-0 text-sm"
            onClick={onShowWhatsNew}
            type="button"
            variant="link"
          >
            Read notes
          </Button>
        </div>
      ) : null}

      {(macAppCheckFailed || firmwareCheckFailed) &&
      undismissedFailure &&
      !retryingFailedCheck &&
      !checkBusy &&
      !otherDialogOpen &&
      !updateErrorOpen ? (
        <CheckFailedDialog
          onClose={() => {
            setDismissedMacAppCheck(macAppFailedKey);
            setDismissedFirmwareCheck(firmwareFailedKey);
          }}
          onTryAgain={
            onCheckUpdates && !actionsLocked
              ? () => {
                  setRetryingFailedCheck(true);
                  return onCheckUpdates();
                }
              : undefined
          }
        />
      ) : null}
    </div>
  );
}

type Tone = "ok" | "ink" | "muted" | "failed";

// The calm design draws "up to date" in this green; no other screen needs it.
const OK_GREEN = "oklch(0.68 0.15 150)";

function StatusDot({ tone }: { tone: Tone }) {
  return (
    <i
      aria-hidden
      className={`size-2 shrink-0 rounded-full ${
        tone === "ink"
          ? "bg-foreground"
          : tone === "muted"
            ? "bg-muted-foreground"
            : tone === "failed"
              ? "bg-destructive"
              : ""
      }`}
      style={tone === "ok" ? { background: OK_GREEN } : undefined}
    />
  );
}

type RowStatus = "ok" | "checking" | "failed" | "installing" | "waiting";

function UpdateRow({
  action,
  children,
  description,
  icon,
  note,
  status,
  title,
  version,
}: {
  /** The lime "Update" of the row that has an update, instead of a status. */
  action?: ReactNode;
  /** What the row says beneath its line: progress, a lock, a finished update. */
  children?: ReactNode;
  description: string;
  icon: ReactNode;
  /** The check's own words when it answered with neither "current" nor an update. */
  note?: string;
  status?: RowStatus;
  title: string;
  version: string;
}) {
  const hasDetail = Children.toArray(children).length > 0;
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3.5 px-5 py-[18px] sm:grid-cols-[auto_minmax(0,1fr)_auto]">
      <span className="grid size-10 place-items-center rounded-[10px] bg-muted text-foreground [&_svg]:size-[18px]">
        {icon}
      </span>
      <div className="min-w-0">
        <h3 className="font-semibold text-foreground">{title}</h3>
        <p className="text-muted-foreground">{description}</p>
      </div>
      <div className="col-start-2 mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 sm:col-start-3 sm:mt-0">
        <span className="font-mono text-[13px] text-foreground">{version}</span>
        {action ??
          (status ? (
            <RowStatusLabel status={status} />
          ) : note ? (
            <span className="text-muted-foreground">{note}</span>
          ) : null)}
      </div>
      {hasDetail ? (
        <div className="col-start-2 mt-3 flex flex-col gap-3 sm:col-span-2">{children}</div>
      ) : null}
    </div>
  );
}

function RowStatusLabel({ status }: { status: RowStatus }) {
  if (status === "ok") {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <CircleCheck aria-hidden className="size-4" style={{ color: OK_GREEN }} />
        Up to date
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 text-destructive">
        <CircleAlert aria-hidden className="size-4" />
        Check failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      {status === "waiting" ? null : <Spinner className="size-4" />}
      {status === "checking"
        ? "Checking"
        : status === "installing"
          ? "Updating"
          : "Waiting"}
    </span>
  );
}

function CheckFailedDialog({
  onClose,
  onTryAgain,
}: {
  onClose: () => void;
  onTryAgain?: () => Promise<void> | void;
}) {
  return (
    <SetupDialog
      description="Check the internet connection, then try again."
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
      primaryAction={{
        label: "Try again",
        disabled: !onTryAgain,
        onSelect: () => {
          void onTryAgain?.();
        },
      }}
      title="Could not check for updates"
    />
  );
}

function InlineUpdateProgress({
  creatingReport,
  errorDismissed,
  onDismissError,
  onCreateReport,
  onRetry,
  status,
}: {
  creatingReport: boolean;
  errorDismissed: boolean;
  onDismissError: () => void;
  onCreateReport?: () => void;
  onRetry?: () => void;
  status: FirmwareUpdateStatus;
}) {
  if (status.phase === "error") {
    if (errorDismissed) return null;
    const reportAction = {
      label: "Create report",
      busy: creatingReport,
      disabled: !onCreateReport,
      onSelect: () => onCreateReport?.(),
    };
    return (
      <SetupDialog
        description={status.error || "Update was not installed."}
        onOpenChange={(open) => {
          if (!open) onDismissError();
        }}
        open
        primaryAction={status.retryAllowed !== false ? {
          label: "Try again", disabled: !onRetry, onSelect: () => onRetry?.(),
        } : reportAction}
        secondaryAction={status.retryAllowed !== false ? reportAction : undefined}
        title="Update failed"
      />
    );
  }
  const complete = status.phase === "complete";
  const attention = status.phase === "attention";
  const restarting =
    status.phase === "installing" &&
    (status.stage === "rebooting" || status.stage === "rediscovering");
  const progress = clampProgress(
    complete || attention ? 100 : status.progress,
  );
  const title = attention
      ? "Firmware current — attention needed"
    : complete
      ? "Update complete"
      : restarting
        ? "VibeTV is restarting"
      : "Updating VibeTV";
  const detail = attention
      ? status.message ||
        "The firmware is current, but the connection or picture still needs repair."
    : complete
      ? status.result?.firmware
        ? `Firmware ${status.result.firmware} is installed.`
        : "VibeTV is up to date."
      : restarting
        ? "Keep VibeTV connected to power and wait. No action is required."
      : status.message ||
        status.logs[status.logs.length - 1] ||
        "Preparing VibeTV update.";
  return (
    <div className="flex flex-col gap-3" role="status" aria-live="polite">
      {complete || attention ? (
        <div>
          <p className="font-semibold">{title}</p>
          <p className="text-muted-foreground">{detail}</p>
        </div>
      ) : (
        <>
          <p className="sr-only">{title}</p>
          <Progress aria-label={title} value={progress} />
          <ProcessSteps steps={[{ id: detail, text: detail }]} variant="single" />
        </>
      )}
      {attention ? (
        <div className="flex gap-2">
          {status.outcome === "firmware_current_theme_attention" ? (
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
        </div>
      ) : null}
    </div>
  );
}

/**
 * "Checked today, 08:44": the newest of the checks that answered. Older than
 * yesterday gets its date.
 */
function lastCheckedText(...values: Array<string | undefined>): string {
  const times = values
    .map((value) => new Date(value || "").getTime())
    .filter(Number.isFinite);
  if (times.length === 0) {
    return "";
  }
  const checked = new Date(Math.max(...times));
  const sameDay = (a: Date, b: Date) =>
    a.toDateString() === b.toDateString();
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const day = sameDay(checked, now)
    ? "today"
    : sameDay(checked, yesterday)
      ? "yesterday"
      : new Intl.DateTimeFormat(undefined, {
          day: "numeric",
          month: "short",
        }).format(checked);
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(checked);
  return `Checked ${day}, ${time}`;
}
