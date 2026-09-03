"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { availableMacAppDmgDownloadUrl } from "@/lib/companion-release";
import {
  NO_THEME_UPGRADE,
  resolveActiveLiveTheme,
  resolveActiveThemeUpgrade,
  resolveScreensaverUpgrade,
} from "@/lib/active-theme-upgrade";
import { hasFirmwareUpdate, type FirmwareUpdateInfo } from "@/lib/firmware";
import { buildThemePack } from "@/lib/theme-studio";
import type { ThemeCatalogResponse, ThemeProduct } from "@/lib/themes";
import { ControlCenterShell } from "./control-center-shell";
import {
  checkForMacAppUpdate,
  companionRequestUrl,
  finishCodexBarRecovery,
  isLocalCompanionOrigin,
  isNativeControlCenterApp,
  localizeCompanionAssetUrl,
  localControlCenterUrl,
  launchCodexBarRepair,
  needsLoopbackTargetAddressSpace,
  repairLocalControlCenterRuntime,
  restartLocalControlCenterApp,
  shouldRedirectToLocalControlCenter,
  shouldUseHostedSetupShell,
} from "./control-center-runtime";
import {
  deviceCanContinueThemeSetup,
  deviceCompletedThemeSetup,
  deviceIsActive,
  deviceIsCustomerConnected,
  deviceImageIsStuck,
  deviceIsReady,
  deviceNeedsExplicitConnect,
  deviceNeedsThemeSetup,
  providerSetupIsChecking,
  providerSetupNeedsEngineRecovery,
  providerSetupRequiresRecovery,
  type ActiveTab,
  type AppearanceSection,
  type ApiError,
  type CompanionInfo,
  type CompanionStatus,
  type ControlCenterEvent,
  type DeviceCandidate,
  type DeviceInfo,
  type DeviceSearchState,
  type DeviceState,
  type ProviderSetupInfo,
  type ProviderDisplaySelection,
  type ProviderSelectionSetup,
  type PreferenceDescriptor,
  type StandbySettings,
  type SupportDiagnostics,
  type UsageSnapshot,
} from "./control-center-types";
import {
  applyDeviceRecoveryStatus,
  deviceRecoveryConfirmedLoss,
  createDeviceRecoveryGateState,
  DEVICE_RECOVERY_NORMAL_FAILURE_LIMIT,
  DEVICE_RECOVERY_OPERATION_FAILURE_LIMIT,
  resetDeviceRecoveryGate,
  selectRecoveryDevice,
  type DeviceRecoveryGateState,
  type DeviceRecoveryPickerReason,
} from "./device-recovery-gate";
import { useCompanionRelease } from "./companion-installer-actions";
import { LogsScreen } from "./logs-screen";
import {
  hasRenderableUsage,
  type DisplayFrameSnapshot,
  useLatestDisplayFrame,
} from "./live-vibetv-preview";
import { OverviewScreen } from "./overview-screen";
import {
  PROVIDER_RECONCILE_WINDOW_MS,
  providerUsageNeedsReconcile,
  scheduleProviderUsageReconcile,
} from "./provider-usage-reconcile";
import {
  providerPreferencesNeedPolling,
  startProviderPreferencesPolling,
} from "./provider-preferences-polling";
import { isProviderItem } from "./provider-picker";
import { MacAppDownloadScreen } from "./setup/mac-app-download-screen";
import { SetupWelcomeScreen } from "./setup/setup-welcome-screen";
import { buildAiFixPrompt } from "./setup/setup-ai-prompt";
import type { SetupConnectSteps } from "./setup/setup-connect";
import { displayPreviewsFor } from "./setup/setup-display-previews";
import { setupProviderCanDisplay } from "./setup/setup-providers-screen";
import {
  deriveSetupStep,
  setupDeviceIsUsable,
  setupDisplayIsConfigured,
  setupDisplaySelectionSupported,
  setupProviderInventoryIsLoading,
  setupStepForProviderRefusal,
} from "./setup/setup-step";
import {
  SetupUsageDialog,
  setupUsageCauseFor,
} from "./setup/setup-usage-dialog";
import { SetupRecoveryDialogs } from "./setup/setup-recovery-dialogs";
import { SetupWizard } from "./setup/setup-wizard";
import { SettingsScreen } from "./settings-screen";
import { collectSupportReport } from "./support-report";
import {
  buildThemeInstallBlocker,
  ThemeLibraryScreen,
  themeNeedsUpgradeableFirmware,
} from "./theme-library-screen";
import {
  clearRetiredAiThemeStorage,
  type ThemeStudioInstallPayload,
} from "./theme-studio-screen";
import { UpdatesScreen } from "./updates-screen";
import { UsageScreen } from "./usage-screen";
import { startUsageSurfacePolling } from "./usage-surface-polling";

const DEVICE_TARGET_STORAGE_KEY = "vibetv.controlCenter.deviceTarget";
const COMPANION_REQUEST_TIMEOUT_MS = 45_000;
const COMPANION_REPAIR_REQUEST_TIMEOUT_MS = 120_000;
const DEVICE_SEARCH_REQUEST_TIMEOUT_MS = 40_000;
const RECENT_COMPANION_REQUEST_MS = 5_000;
// launchd restarts the service itself: KeepAlive with a 10s ThrottleInterval
// (main.swift:3759-3761), then the process start, then the 5s poll that sees it
// -- about seventeen seconds before the app has learnt anything. Repairing at
// twelve took the service down again just as launchd was bringing it up, and
// turned a restart into an outage.
const LAUNCHD_RECOVERY_GRACE_MS = 25_000;
// Only a safety net for a native side that never answers at all, so it has to
// outlast the repair's own bounded worst case: 8s initial health gate + 20s
// unregister quiesce + 2s settle + 35s health wait, plus provisioning and app
// launch (main.swift:37-43). At 55s this fired while the repair was still
// working, reported failure, and then discarded the successful native result.
const NATIVE_RUNTIME_REPAIR_TIMEOUT_MS = 120_000;
// The Help menu hands the last 20 of these to an AI along with the current
// screen, so the log has to be at least that deep.
const RECENT_EVENT_LIMIT = 20;
const NATIVE_RUNTIME_REPAIR_RESULT_EVENT = "vibetv:runtime-repair-result";
const NATIVE_CODEXBAR_REPAIR_RESULT_EVENT = "vibetv:codexbar-repair-result";

type LocalNetworkRequestInit = RequestInit & {
  targetAddressSpace?: "loopback";
};

type ThemeSetupDeviceIdentity = {
  deviceId: string;
  target: string;
};

type SettingsResponse = {
  settings?: {
    display?: {
      brightnessPercent?: number;
    };
    standby?: StandbySettings;
  };
  device?: DeviceInfo;
};

type ThemeInstallResult = {
  themeId: string;
  packId: string;
  name: string;
  activePath: string;
  themeRev: number;
};

type InstallResponse = {
  job?: ThemeInstallJob;
  result?: ThemeInstallResult;
  logs?: string[];
};

type InstallableTheme = Pick<
  ThemeProduct,
  | "packUrl"
  | "packSha256"
  | "packSizeBytes"
  | "themeId"
  | "themeSpecPath"
  | "title"
  | "usage"
> & {
  packBytes?: Uint8Array;
};

type ThemeInstallJob = {
  id: string;
  themeId?: string;
  themeName?: string;
  slot?: "live" | "screensaver";
  phase: "installing" | "complete" | "error";
  message?: string;
  progress?: number;
  startedAt?: string;
  finishedAt?: string;
  logs?: string[];
  result?: ThemeInstallResult;
  error?: ApiError;
};

type FirmwareUpdateResult = {
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

type FirmwareUpdateJob = {
  id: string;
  phase: "installing" | "complete" | "attention" | "error";
  stage?: string;
  outcome?: string;
  retryPolicy?: "power_cycle";
  message?: string;
  progress?: number;
  startedAt?: string;
  finishedAt?: string;
  logs?: string[];
  result?: FirmwareUpdateResult;
  error?: ApiError;
};

type FirmwareUpdateStatus = {
  phase: "installing" | "complete" | "attention" | "error";
  stage?: string;
  outcome?: string;
  retryAllowed?: boolean;
  startedAt: string;
  finishedAt?: string;
  message?: string;
  progress?: number;
  logs: string[];
  result?: FirmwareUpdateResult;
  error?: string;
};

type FirmwareUpdateResponse = {
  job?: FirmwareUpdateJob;
};

type Props = {
  catalog: ThemeCatalogResponse;
  initialThemeId?: string;
};

type ThemeInstallStatus = {
  phase: "installing" | "complete" | "error";
  themeId: string;
  title: string;
  startedAt: string;
  finishedAt?: string;
  message?: string;
  progress?: number;
  logs: string[];
  result?: ThemeInstallResult;
  error?: string;
};

type RunCompanion = <T>(
  path: string,
  init?: RequestInit,
  options?: { preserveLastError?: boolean; timeoutMs?: number },
) => Promise<T>;

type FirmwareCheckOptions = {
  board?: string;
  firmware?: string;
  signal?: AbortSignal;
};

type RuntimeSurface = "unknown" | "hosted-setup" | "local-control-center";
export function ControlCenterApp({ catalog, initialThemeId }: Props) {
  useEffect(() => {
    clearRetiredAiThemeStorage();
  }, []);

  const initialTheme = useMemo(
    () =>
      initialThemeId
        ? catalog.themes.find((theme) => theme.themeId === initialThemeId)
        : undefined,
    [catalog.themes, initialThemeId],
  );
  const initialThemeIsScreensaver = initialTheme?.usage === "screensaver";
  const [selectedThemeId, setSelectedThemeId] = useState(
    initialThemeIsScreensaver
      ? ""
      : initialTheme?.themeId || initialThemeId || "",
  );
  const [selectedScreensaverId, setSelectedScreensaverId] = useState(
    initialThemeIsScreensaver ? initialTheme?.themeId || "" : "",
  );
  const [appearanceSection, setAppearanceSection] = useState<AppearanceSection>(
    initialThemeIsScreensaver ? "screensavers" : "themes",
  );
  const [activeTab, setActiveTab] = useState<ActiveTab>(
    initialThemeId ? "theme-library" : "overview",
  );
  const runtimeSurface = useSyncExternalStore(
    subscribeRuntimeSurface,
    getRuntimeSurfaceSnapshot,
    getRuntimeSurfaceServerSnapshot,
  );
  const hostedSetup = runtimeSurface === "hosted-setup";
  const [companionStatus, setCompanionStatus] =
    useState<CompanionStatus>("unknown");
  const [initialCompanionCheckComplete, setInitialCompanionCheckComplete] =
    useState(false);
  const [companionInfo, setCompanionInfo] = useState<CompanionInfo | null>(
    null,
  );
  const [deviceState, setDeviceState] = useState<DeviceState>("unknown");
  const [deviceCandidates, setDeviceCandidates] = useState<DeviceCandidate[]>(
    [],
  );
  const [deviceSearchState, setDeviceSearchState] =
    useState<DeviceSearchState>("idle");
  const [deviceRecoveryPickerReason, setDeviceRecoveryPickerReason] =
    useState<DeviceRecoveryPickerReason | null>(null);
  const [deviceSession, setDeviceSession] = useState<{
    device: DeviceInfo | null;
    themeSetupIdentity: ThemeSetupDeviceIdentity | null;
  }>({
    device: null,
    themeSetupIdentity: null,
  });
  const device = deviceSession.device;
  const themeSetupIdentity = deviceSession.themeSetupIdentity;
  const setDevice = useCallback(
    (
      update:
        DeviceInfo | null | ((current: DeviceInfo | null) => DeviceInfo | null),
    ) => {
      setDeviceSession((current) => ({
        ...current,
        device: typeof update === "function" ? update(current.device) : update,
      }));
    },
    [],
  );
  const [deviceTarget, setDeviceTarget] = useState(readInitialDeviceTarget);
  const [brightness, setBrightness] = useState<number | null>(null);
  const [standby, setStandby] = useState<StandbySettings | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [supportReportBusy, setSupportReportBusy] = useState(false);
  const [lastError, setLastError] = useState<ApiError | null>(null);
  const [lastInstall, setLastInstall] = useState<InstallResponse["result"]>();
  const [themeInstallStatus, setThemeInstallStatus] =
    useState<ThemeInstallStatus | null>(null);
  const [firmwareUpdate, setFirmwareUpdate] =
    useState<FirmwareUpdateInfo | null>(null);
  const [firmwareUpdateStatus, setFirmwareUpdateStatus] =
    useState<FirmwareUpdateStatus | null>(null);
  const firmwareUpdateInProgress = firmwareUpdateStatus?.phase === "installing";
  const themeInstallInProgress = themeInstallStatus?.phase === "installing";
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [usageError, setUsageError] = useState<ApiError | null>(null);
  const [providerSetup, setProviderSetup] = useState<ProviderSetupInfo | null>(
    null,
  );
  const [providerPreferences, setProviderPreferences] = useState<
    PreferenceDescriptor[] | null
  >(null);
  const [providerPreferencesError, setProviderPreferencesError] =
    useState<ApiError | null>(null);
  const [providerDisplay, setProviderDisplay] =
    useState<ProviderDisplaySelection | null>(null);
  const [providerDisplayError, setProviderDisplayError] =
    useState<ApiError | null>(null);
  const [providerSelectionSetup, setProviderSelectionSetup] =
    useState<ProviderSelectionSetup | null>(null);
  const [pendingProviderCheckIds, setPendingProviderCheckIds] = useState<
    Set<string>
  >(() => new Set());
  const [pendingProviderDisplayId, setPendingProviderDisplayId] = useState<
    string | null
  >(null);
  const [pendingPreferenceIds, setPendingPreferenceIds] = useState<Set<string>>(
    () => new Set(),
  );
  const providerReconcileDeadlineRef = useRef(0);
  const providerCheckQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [setupPreviewStep, setSetupPreviewStep] = useState<"mac-app" | null>(
    readLocalSetupPreviewStep,
  );
  // null until the app has to step in. launchd brings the service back on its
  // own, and saying so first turned a restart nobody would have noticed into a
  // dialog over whatever the customer was doing.
  const [runtimeRecoveryPhase, setRuntimeRecoveryPhase] = useState<
    "repairing" | "failed" | null
  >(null);
  const [themeInstallEnabled, setThemeInstallEnabled] = useState(false);
  const [hasEnteredControlCenter, setHasEnteredControlCenter] = useState(false);
  // The closing step is shown for a moment before the app takes over, but only
  // to someone who actually walked through setup.
  // Flipped by the wizard once its closing step has been seen. A VibeTV that
  // was already set up reaches the shell without it, because nothing put the
  // customer on a step to close.
  const [setupFinished, setSetupFinished] = useState(false);
  const finishSetup = useCallback(() => setSetupFinished(true), []);
  // The completion response clears providerSelectionRequired before the first
  // renderable frame necessarily exists. Keep this setup's confirmed device
  // usable so the next screen is Display Mode, never a flash of Connect.
  const [
    providerSetupCompletedThisSession,
    setProviderSetupCompletedThisSession,
  ] = useState(false);
  const [setupThemeInstallRequested, setSetupThemeInstallRequested] =
    useState(false);
  const [setupThemeChoiceRequired, setSetupThemeChoiceRequired] =
    useState(false);
  // Dismissing the recovery dialog only hides it; the repair itself runs on.
  const [runtimeRecoveryHidden, setRuntimeRecoveryHidden] = useState(false);
  // Hiding the usage dialog hides the announcement; the repair itself runs on.
  const [usageFailureHidden, setUsageFailureHidden] = useState(false);
  const lastFirmwareErrorRef = useRef<ApiError | null>(null);
  const [supportDiagnostics, setSupportDiagnostics] =
    useState<SupportDiagnostics | null>(null);
  const brightnessDirtyRef = useRef(false);
  const standbyDirtyRef = useRef(false);
  // Last standby settings the device confirmed (loaded or saved). A failed
  // save rolls back to this, never to the in-flight slider value.
  const lastSavedStandbyRef = useRef<StandbySettings | null>(null);
  const setupGenerationRef = useRef(0);
  const deviceSearchAttemptRef = useRef(0);
  const didRunInitialConnectionCheck = useRef(false);
  const didRunAutomaticDeviceSearch = useRef(false);
  const didRunAutoDisplayReload = useRef(false);
  const didRunSetupVerification = useRef(false);
  const pendingPairingCandidate = useRef<DeviceCandidate | null>(null);
  const legacyRecoverySearchInFlight = useRef(false);
  const lastCompanionRequestAt = useRef(0);
  const statusPollInFlight = useRef(false);
  const deviceRecoveryGateRef = useRef<DeviceRecoveryGateState>(
    createDeviceRecoveryGateState(),
  );
  const recoverySearchStartedRef = useRef(false);
  const recoveryPreferredConnectAttemptRef = useRef("");
  const runtimeRepairAttempted = useRef(false);
  const runtimeRepairTimeout = useRef<number | null>(null);
  const codexBarRepairTimeout = useRef<number | null>(null);
  // The timeout handle is not the same thing as an outstanding recovery: the
  // success path clears it before awaiting the provider retry. Only this ref
  // says whether the native side still holds a temporary CodexBar for us.
  const codexBarRecoveryOutstanding = useRef(false);
  const providerRecoveryAttempted = useRef(false);
  const providerRecoveryManualAttempted = useRef(false);
  const themeInstallPollJobRef = useRef("");
  const activeThemeUpgradeAttemptRef = useRef("");
  const [events, setEvents] = useState<ControlCenterEvent[]>(() => [
    {
      id: "session-start",
      label: "Control Center opened",
      detail: "Browser session started.",
      at: "Session",
      tone: "unknown",
    },
  ]);

  const selectedTheme = useMemo(
    () => catalog.themes.find((theme) => theme.themeId === selectedThemeId),
    [catalog.themes, selectedThemeId],
  );
  const selectedScreensaver = useMemo(
    () =>
      catalog.themes.find((theme) => theme.themeId === selectedScreensaverId),
    [catalog.themes, selectedScreensaverId],
  );
  const localControlCenterPath = useMemo(
    () => localControlCenterPathForTheme(initialThemeId),
    [initialThemeId],
  );
  const companionInstallationMode =
    companionInfo?.installationMode ||
    (companionInfo?.features?.macAppSelfUpdateEnabled === true
      ? "legacy"
      : undefined);
  const requiresMacAppMigration = Boolean(
    companionStatus === "online" && companionInstallationMode === "legacy",
  );

  const mergeDevice = useCallback((next: DeviceInfo) => {
    if (deviceIsReady(next)) {
      didRunAutomaticDeviceSearch.current = false;
      setLastError(null);
    }
    if (deviceNeedsThemeSetup(next)) {
      setSetupThemeChoiceRequired(true);
    }
    setDeviceSession((current) => {
      const mergedDevice = mergeDeviceInfo(current.device, next);
      return {
        device: mergedDevice,
        themeSetupIdentity: reconcileThemeSetupIdentity(
          current.themeSetupIdentity,
          mergedDevice,
        ),
      };
    });
  }, []);

  const markDeviceLost = useCallback(() => {
    setDeviceSession((current) => ({
      ...current,
      device: markDeviceDisconnected(current.device),
    }));
  }, []);

  const addEvent = useCallback(
    (event: Omit<ControlCenterEvent, "id" | "at"> & { at?: string }) => {
      setEvents((current) =>
        [
          {
            id: `${Date.now()}-${current.length}`,
            at: event.at || formatTime(),
            ...event,
          },
          ...current,
        ].slice(0, RECENT_EVENT_LIMIT),
      );
    },
    [],
  );

  const setDeviceRecoveryGate = useCallback((next: DeviceRecoveryGateState) => {
    deviceRecoveryGateRef.current = next;
    setDeviceRecoveryPickerReason(next.pickerReason);
    if (!next.pickerReason) {
      recoverySearchStartedRef.current = false;
      recoveryPreferredConnectAttemptRef.current = "";
    }
  }, []);

  const operationRecoveryGraceActive =
    firmwareUpdateStatus?.phase === "installing" ||
    themeInstallStatus?.phase === "installing";

  const acceptDeviceSnapshot = useCallback(
    (next: DeviceInfo) => {
      setDeviceRecoveryGate(
        selectRecoveryDevice(deviceRecoveryGateRef.current, next),
      );
      mergeDevice(next);
      if (next.target) {
        setDeviceTarget(next.target);
        rememberDeviceTarget(next.target);
      }
      setDeviceState(
        next.paired ? "paired" : next.connected ? "online" : "unknown",
      );
      // Deliberately not clearing deviceCandidates: setup holds the device
      // step for the whole connect-and-firmware sequence, so emptying the list
      // here took the customer's own selection off the screen mid-connect and
      // left the count reading "0 VibeTVs found on your WiFi." Only a fresh
      // scan and a confirmed device loss clear the list.
      setDeviceSearchState("idle");
    },
    [mergeDevice, setDeviceRecoveryGate],
  );

  const applyPolledDeviceSnapshot = useCallback(
    (
      next: DeviceInfo | null | undefined,
      sourcePoll: string,
      countFailure = false,
    ) => {
      const transition = applyDeviceRecoveryStatus(
        deviceRecoveryGateRef.current,
        {
          countFailure,
          device: next,
          operationInProgress: operationRecoveryGraceActive,
        },
      );
      setDeviceRecoveryGate(transition.state);

      if (transition.acceptDevice && next?.target) {
        mergeDevice(next);
        setDeviceTarget(next.target);
        rememberDeviceTarget(next.target);
        setDeviceState(
          next.paired ? "paired" : next.connected ? "online" : "unknown",
        );
        if (transition.closePicker) {
          setDeviceCandidates([]);
          setDeviceSearchState("idle");
        }
        return true;
      }

      if (transition.state.preferredDeviceId) {
        // Confirmed loss is the failure limit being reached, not the first
        // miss: openPicker stays false until then. Ending the incident here on
        // every missed poll also reset the automatic-attempt guard, so the next
        // provider_setup_required snapshot started a second native repair
        // instead of showing the approved Try again -- the exact case
        // markDeviceLost was split out to avoid.
        if (deviceRecoveryConfirmedLoss(transition)) {
          markDeviceLost();
        } else {
          setDevice((current) => markDeviceDisconnected(current));
        }
        if (transition.openPicker) {
          setDeviceSearchState("searching");
          addEvent({
            label: "VibeTV recovery opened",
            detail: `${sourcePoll} missed the selected VibeTV ${transition.state.failedNormalChecks} times.`,
            tone: "attention",
          });
        }
        return false;
      }

      markDeviceLost();
      setDeviceState("offline");
      return false;
    },
    [
      addEvent,
      markDeviceLost,
      mergeDevice,
      operationRecoveryGraceActive,
      setDevice,
      setDeviceRecoveryGate,
    ],
  );

  const markCompanionUnavailable = useCallback(() => {
    setCompanionStatus("missing");
    setCompanionInfo(null);
    setThemeInstallEnabled(false);
    setUsage(null);
    setUsageError(null);
    // Without the companion there is no live device evidence. Keep the device
    // configured but stop presenting stale state as a live connection.
    setDevice((current) => markDeviceDisconnected(current));
    setDeviceState("offline");
  }, [setDevice]);

  const markCompanionAccessBlocked = useCallback(() => {
    setCompanionStatus("unknown");
    setCompanionInfo(null);
    setThemeInstallEnabled(false);
    setUsage(null);
    setUsageError(null);
    setDevice((current) => markDeviceDisconnected(current));
    setDeviceState("offline");
  }, [setDevice]);

  const handleCompanionUnavailableForRepair = useCallback(
    (quiet: boolean) => {
      const normalized = companionUnavailableError();
      markCompanionUnavailable();
      if (!quiet) {
        setLastError(normalized);
        addEvent({
          label: "Mac App needs setup",
          detail: normalized.nextAction,
          tone: "attention",
        });
      }
    },
    [addEvent, markCompanionUnavailable],
  );

  useEffect(() => {
    async function handleBlockedBrowserFetch() {
      const accessState = await readLocalNetworkAccessState();
      if (localNetworkAccessNeedsUserAction(accessState)) {
        const normalized = localNetworkAccessError(accessState);
        markCompanionAccessBlocked();
        setBusyAction(null);
        setLastError(normalized);
        return;
      }
      markCompanionUnavailable();
      setBusyAction(null);
      setLastError({
        code: "COMPANION_UNREACHABLE",
        message: "Mac App needs setup.",
        nextAction: "Run setup again, then try again.",
      });
    }

    function isRecentCompanionRequest() {
      return (
        Date.now() - lastCompanionRequestAt.current <
        RECENT_COMPANION_REQUEST_MS
      );
    }

    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      if (
        isRecentCompanionRequest() &&
        isLocalCompanionFetchFailureReason(event.reason)
      ) {
        event.preventDefault();
        void handleBlockedBrowserFetch();
      }
    }

    function handleWindowError(event: ErrorEvent) {
      if (
        isRecentCompanionRequest() &&
        isLocalCompanionFetchFailureReason(event.error || event.message)
      ) {
        event.preventDefault();
        void handleBlockedBrowserFetch();
      }
    }

    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    window.addEventListener("error", handleWindowError);
    return () => {
      window.removeEventListener(
        "unhandledrejection",
        handleUnhandledRejection,
      );
      window.removeEventListener("error", handleWindowError);
    };
  }, [markCompanionAccessBlocked, markCompanionUnavailable]);

  const runCompanion = useCallback(
    async <T,>(
      path: string,
      init?: RequestInit,
      options?: { preserveLastError?: boolean; timeoutMs?: number },
    ): Promise<T> => {
      if (!options?.preserveLastError) {
        setLastError(null);
      }
      const headers = new Headers(init?.headers);
      if (init?.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
      const requestUrl = companionRequestUrl(path);
      const controller = new AbortController();
      const timeout = window.setTimeout(() => {
        controller.abort();
      }, options?.timeoutMs ?? COMPANION_REQUEST_TIMEOUT_MS);
      const requestInit: LocalNetworkRequestInit = {
        ...init,
        headers,
        signal: controller.signal,
      };
      if (needsLoopbackTargetAddressSpace(requestUrl)) {
        requestInit.targetAddressSpace = "loopback";
      }
      lastCompanionRequestAt.current = Date.now();
      try {
        const response = await fetch(requestUrl, requestInit);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.ok === false) {
          throw normalizeError(payload?.error, response.status);
        }
        return payload as T;
      } catch (error) {
        if (error instanceof Error && isCompanionConnectionError(error)) {
          const accessState = await readLocalNetworkAccessState();
          if (localNetworkAccessNeedsUserAction(accessState)) {
            throw localNetworkAccessError(accessState);
          }
        }
        if (error instanceof DOMException && error.name === "AbortError") {
          throw {
            code: "COMPANION_TIMEOUT",
            message: "Mac App took too long to answer.",
            nextAction: "Run setup again, then try again.",
          } satisfies ApiError;
        }
        throw error;
      } finally {
        window.clearTimeout(timeout);
      }
    },
    [],
  );

  const refreshDevice = useCallback(
    async ({ quiet = false }: { quiet?: boolean } = {}) => {
      const setupGeneration = setupGenerationRef.current;
      try {
        const payload = await runCompanion<{ device: DeviceInfo }>(
          "/v1/device",
        );
        if (setupGeneration !== setupGenerationRef.current) {
          return null;
        }
        acceptDeviceSnapshot(payload.device);
        if (!quiet) {
          const ready = deviceIsReady(payload.device);
          addEvent({
            label: "VibeTV checked",
            detail: ready
              ? "VibeTV is ready."
              : payload.device.connected
                ? "VibeTV was found, but its screen is not ready yet."
                : "VibeTV is waiting for signal.",
            tone: ready ? "ready" : "attention",
          });
        }
        return payload.device;
      } catch (error) {
        if (setupGeneration !== setupGenerationRef.current) {
          return null;
        }
        const normalized = normalizeCaughtError(
          error,
          "VibeTV needs attention.",
        );
        if (isLocalNetworkAccessError(normalized)) {
          markCompanionAccessBlocked();
        } else if (isCompanionMissingError(normalized)) {
          markCompanionUnavailable();
        } else if (!quiet) {
          applyPolledDeviceSnapshot(null, "/v1/device");
        }
        if (!quiet) {
          setLastError(normalized);
          addEvent({
            label: "Device check needs attention",
            detail: normalized.nextAction,
            tone: "attention",
          });
        }
        return null;
      }
    },
    [
      addEvent,
      markCompanionAccessBlocked,
      markCompanionUnavailable,
      acceptDeviceSnapshot,
      applyPolledDeviceSnapshot,
      runCompanion,
    ],
  );

  const loadSettings = useCallback(async () => {
    const setupGeneration = setupGenerationRef.current;
    setBusyAction("settings");
    try {
      const payload = await runCompanion<SettingsResponse>("/v1/settings");
      if (setupGeneration !== setupGenerationRef.current) {
        return;
      }
      const loadedBrightness =
        payload.settings?.display?.brightnessPercent ?? null;
      if (!brightnessDirtyRef.current) {
        setBrightness(loadedBrightness);
      }
      if (!standbyDirtyRef.current) {
        lastSavedStandbyRef.current = payload.settings?.standby ?? null;
        setStandby(payload.settings?.standby ?? null);
      }
      if (payload.device) {
        const activeLiveTheme = resolveActiveLiveTheme(
          catalog.themes,
          payload.device,
        );
        if (!initialThemeId && activeLiveTheme) {
          setSelectedThemeId(activeLiveTheme.themeId);
        }
      }
      addEvent({
        label: "Settings loaded",
        detail:
          loadedBrightness == null
            ? "Brightness is ready to load."
            : `Brightness is set to ${loadedBrightness}%.`,
        tone: "ready",
      });
    } catch (error) {
      if (setupGeneration !== setupGenerationRef.current) {
        return;
      }
      const normalized = normalizeCaughtError(
        error,
        "Settings need attention.",
      );
      if (isLocalNetworkAccessError(normalized)) {
        markCompanionAccessBlocked();
      } else if (isCompanionMissingError(normalized)) {
        markCompanionUnavailable();
      }
      setLastError(normalized);
      addEvent({
        label: "Settings check needs attention",
        detail: normalized.nextAction,
        tone: "attention",
      });
    } finally {
      if (setupGeneration === setupGenerationRef.current) {
        setBusyAction(null);
      }
    }
  }, [
    addEvent,
    catalog.themes,
    initialThemeId,
    markCompanionAccessBlocked,
    markCompanionUnavailable,
    runCompanion,
  ]);

  const deviceConnectedForSettings = deviceIsCustomerConnected(device);

  useEffect(() => {
    if (activeTab !== "settings" || !deviceConnectedForSettings) {
      return;
    }
    const timer = window.setTimeout(() => {
      void loadSettings();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeTab, device?.target, deviceConnectedForSettings, loadSettings]);

  const applyThemeInstallJob = useCallback(
    (
      job: ThemeInstallJob,
      fallback?: { startedAt?: string; themeId?: string; title?: string },
    ) => {
      const status = themeInstallStatusFromJob(job, catalog.themes, fallback);
      setThemeInstallStatus(status);
      if (job.phase === "installing" && status.themeId) {
        const usage =
          job.slot ||
          catalog.themes.find((theme) => theme.themeId === status.themeId)
            ?.usage ||
          "live";
        if (usage === "screensaver") {
          setSelectedScreensaverId(status.themeId);
          setAppearanceSection("screensavers");
        } else {
          setSelectedThemeId(status.themeId);
          setAppearanceSection("themes");
        }
      }
      if (job.phase === "complete" && job.result) {
        setLastInstall(job.result);
      }
      return status;
    },
    [catalog.themes],
  );

  const resumeThemeInstallJob = useCallback(
    async (job: ThemeInstallJob) => {
      const initialStatus = applyThemeInstallJob(job);
      if (job.phase !== "installing" || themeInstallPollJobRef.current) {
        return;
      }

      themeInstallPollJobRef.current = job.id;
      setBusyAction("install");
      try {
        const finishedJob = await pollThemeInstallJob({
          applyInstallJob: (nextJob) => applyThemeInstallJob(nextJob),
          jobId: job.id,
          runCompanion,
        });
        const finishedStatus = applyThemeInstallJob(finishedJob);
        if (finishedJob.phase === "error") {
          if (finishedJob.error) {
            setLastError(finishedJob.error);
          }
          addEvent({
            label: "Theme install needs attention",
            detail:
              finishedJob.error?.nextAction ||
              finishedStatus.message ||
              "Keep VibeTV powered on and retry the install.",
            tone: "attention",
          });
          return;
        }
        setLastError(null);
        addEvent({
          label: "Theme installed",
          detail: finishedJob.result?.name || finishedStatus.title,
          tone: "ready",
        });
      } catch (error) {
        const normalized = normalizeCaughtError(
          error,
          "Theme install needs attention.",
        );
        if (isLocalNetworkAccessError(normalized)) {
          markCompanionAccessBlocked();
        } else if (isCompanionMissingError(normalized)) {
          markCompanionUnavailable();
        }
        setLastError(normalized);
        setThemeInstallStatus({
          ...initialStatus,
          phase: "error",
          finishedAt: formatTime(),
          message: normalized.nextAction,
          progress: 100,
          logs: [
            ...initialStatus.logs,
            normalized.message,
            normalized.nextAction,
          ],
          error: themeInstallErrorText(normalized),
        });
        addEvent({
          label: "Theme install needs attention",
          detail: normalized.nextAction,
          tone: "attention",
        });
      } finally {
        if (themeInstallPollJobRef.current === job.id) {
          themeInstallPollJobRef.current = "";
        }
        setBusyAction((current) => (current === "install" ? null : current));
      }
    },
    [
      addEvent,
      applyThemeInstallJob,
      markCompanionAccessBlocked,
      markCompanionUnavailable,
      runCompanion,
    ],
  );

  const verifyLocalControlCenterAvailable = useCallback(async () => {
    const requestUrl = localControlCenterUrl(localControlCenterPath);
    const requestInit: LocalNetworkRequestInit = {
      cache: "no-store",
      method: "GET",
    };
    if (needsLoopbackTargetAddressSpace(requestUrl)) {
      requestInit.targetAddressSpace = "loopback";
    }
    const response = await fetch(requestUrl, requestInit);
    if (!response.ok) {
      throw localControlCenterUnavailableError();
    }
  }, [localControlCenterPath]);

  const checkCompanion = useCallback(
    async (options?: { quiet?: boolean }) => {
      if (statusPollInFlight.current) {
        return;
      }
      statusPollInFlight.current = true;
      const setupGeneration = setupGenerationRef.current;
      const quiet = Boolean(options?.quiet);
      if (!quiet) {
        setBusyAction("status");
      }
      try {
        const payload = await runCompanion<{
          companion?: CompanionInfo;
          device?: DeviceInfo;
          themeInstall?: ThemeInstallJob;
          firmwareUpdate?: FirmwareUpdateJob;
          providerSetup?: ProviderSetupInfo;
          setup?: ProviderSelectionSetup;
        }>("/v1/status", undefined, { preserveLastError: quiet });
        if (setupGeneration !== setupGenerationRef.current) {
          return;
        }
        const checkedAt = formatTime();
        const wasMissing = companionStatus === "missing";
        setCompanionStatus("online");
        setCompanionInfo(payload.companion || null);
        setProviderSetup(payload.providerSetup || null);
        setProviderSelectionSetup(payload.setup || null);
        const pairingRejection = pairingRejectionForDevice(payload.device);
        if (pairingRejection) {
          setLastError(pairingRejection);
        } else if (!quiet || deviceIsReady(payload.device)) {
          setLastError(null);
        }
        setThemeInstallEnabled(
          Boolean(payload.companion?.features?.themeInstallEnabled),
        );
        if (payload.themeInstall) {
          applyThemeInstallJob(payload.themeInstall);
          if (payload.themeInstall.phase === "installing") {
            setActiveTab("theme-library");
            void resumeThemeInstallJob(payload.themeInstall);
          }
        }
        if (payload.firmwareUpdate) {
          setFirmwareUpdateStatus(
            firmwareUpdateStatusFromJob(payload.firmwareUpdate),
          );
          if (payload.firmwareUpdate.phase === "installing") {
            setActiveTab("updates");
          }
        }
        if (
          shouldRedirectToLocalControlCenter() &&
          payload.companion?.installationMode !== "dmg"
        ) {
          try {
            await verifyLocalControlCenterAvailable();
            if (setupGeneration !== setupGenerationRef.current) {
              return;
            }
          } catch (error) {
            if (setupGeneration !== setupGenerationRef.current) {
              return;
            }
            const normalized = await normalizeLocalControlCenterError(error);
            setSetupPreviewStep("mac-app");
            setLastError(normalized);
            addEvent({
              label: "Mac App update needed",
              detail: normalized.nextAction,
              tone: "attention",
            });
            return;
          }
        }
        if (!quiet) {
          try {
            await runCompanion<unknown>("/v1/usage", undefined, {
              preserveLastError: true,
            });
            if (setupGeneration !== setupGenerationRef.current) {
              return;
            }
          } catch (error) {
            if (setupGeneration !== setupGenerationRef.current) {
              return;
            }
            const usageError = normalizeUsageError(
              normalizeCaughtError(error, "Mac App needs attention."),
            );
            if (usageError.code === "MAC_APP_UPDATE_REQUIRED") {
              setSetupPreviewStep("mac-app");
              setLastError(usageError);
              addEvent({
                label: "Mac App update needed",
                detail: usageError.nextAction,
                tone: "attention",
              });
              return;
            }
          }
          setSetupPreviewStep(null);
        }
        const acceptedDevice = applyPolledDeviceSnapshot(
          payload.device,
          "/v1/status",
        );
        if (acceptedDevice && payload.device) {
          if (deviceIsReady(payload.device)) {
            void loadSettings();
          }
        }
        if (!quiet || wasMissing) {
          addEvent({
            label: wasMissing ? "Mac App reconnected" : "Mac App checked",
            detail: payload.device?.target
              ? "Mac App is ready."
              : "VibeTV still needs to be connected.",
            at: checkedAt,
            tone: "ready",
          });
        }
      } catch (error) {
        if (setupGeneration !== setupGenerationRef.current) {
          return;
        }
        const normalized = normalizeCaughtError(
          error,
          "Mac App needs attention.",
        );
        if (isLocalNetworkAccessError(normalized)) {
          markCompanionAccessBlocked();
        } else {
          markCompanionUnavailable();
        }
        if (!quiet) {
          setLastError(normalized);
          addEvent({
            label: "Mac App check needs attention",
            detail: normalized.nextAction,
            tone: "attention",
          });
        }
      } finally {
        statusPollInFlight.current = false;
        setInitialCompanionCheckComplete(true);
        if (!quiet && setupGeneration === setupGenerationRef.current) {
          setBusyAction(null);
        }
      }
    },
    [
      addEvent,
      applyPolledDeviceSnapshot,
      applyThemeInstallJob,
      companionStatus,
      loadSettings,
      markCompanionAccessBlocked,
      markCompanionUnavailable,
      runCompanion,
      resumeThemeInstallJob,
      verifyLocalControlCenterAvailable,
    ],
  );

  const syncLocalStatus = useCallback(async () => {
    if (statusPollInFlight.current) {
      return;
    }
    statusPollInFlight.current = true;
    const setupGeneration = setupGenerationRef.current;
    try {
      const payload = await runCompanion<{
        companion?: CompanionInfo;
        device?: DeviceInfo;
        themeInstall?: ThemeInstallJob;
        firmwareUpdate?: FirmwareUpdateJob;
        providerSetup?: ProviderSetupInfo;
        setup?: ProviderSelectionSetup;
      }>("/v1/status", undefined, { preserveLastError: true });
      if (setupGeneration !== setupGenerationRef.current) {
        return;
      }
      setCompanionStatus("online");
      setCompanionInfo(payload.companion || null);
      setProviderSetup(payload.providerSetup || null);
      setProviderSelectionSetup(payload.setup || null);
      const pairingRejection = pairingRejectionForDevice(payload.device);
      if (pairingRejection) {
        setLastError(pairingRejection);
      } else if (deviceIsReady(payload.device)) {
        setLastError(null);
      }
      setThemeInstallEnabled(
        Boolean(payload.companion?.features?.themeInstallEnabled),
      );
      if (payload.themeInstall) {
        applyThemeInstallJob(payload.themeInstall);
        if (payload.themeInstall.phase === "installing") {
          void resumeThemeInstallJob(payload.themeInstall);
        }
      }
      if (payload.firmwareUpdate) {
        setFirmwareUpdateStatus(
          firmwareUpdateStatusFromJob(payload.firmwareUpdate),
        );
      }
      applyPolledDeviceSnapshot(payload.device, "/v1/status", true);
    } catch (error) {
      if (setupGeneration !== setupGenerationRef.current) {
        return;
      }
      const normalized = normalizeCaughtError(
        error,
        "Mac App needs attention.",
      );
      if (isLocalNetworkAccessError(normalized)) {
        markCompanionAccessBlocked();
      } else {
        markCompanionUnavailable();
      }
    } finally {
      statusPollInFlight.current = false;
    }
  }, [
    applyPolledDeviceSnapshot,
    applyThemeInstallJob,
    markCompanionAccessBlocked,
    markCompanionUnavailable,
    resumeThemeInstallJob,
    runCompanion,
  ]);

  const searchAndConnect = useCallback(async () => {
    const setupGeneration = setupGenerationRef.current;
    const searchAttempt = ++deviceSearchAttemptRef.current;
    const searchIsCurrent = () =>
      setupGeneration === setupGenerationRef.current &&
      searchAttempt === deviceSearchAttemptRef.current;
    setBusyAction("search");
    pendingPairingCandidate.current = null;
    setDeviceCandidates([]);
    setDeviceSearchState("searching");
    setLastError(null);
    try {
      const payload = await runCompanion<{ devices?: DeviceCandidate[] }>(
        "/v1/device/search",
        { method: "POST" },
        { timeoutMs: DEVICE_SEARCH_REQUEST_TIMEOUT_MS },
      );
      if (!searchIsCurrent()) {
        return;
      }
      const candidates = (payload.devices || []).filter(
        (candidate) => candidate.target && candidate.networkMode !== "setup",
      );
      if (candidates.length > 0) {
        setDeviceCandidates(candidates);
        setDeviceSearchState("multiple");
        return;
      }
      setDeviceSearchState("not-found");
      setDeviceState("offline");
    } catch (error) {
      if (!searchIsCurrent()) {
        return;
      }
      const normalized = normalizeCaughtError(
        error,
        "Automatic VibeTV search could not finish.",
      );
      if (isCompanionMissingError(normalized)) {
        handleCompanionUnavailableForRepair(false);
        setDeviceSearchState("failed");
      } else if (normalized.code === "device_not_found") {
        setDeviceSearchState("not-found");
        setDeviceState("offline");
        setLastError(null);
      } else {
        setDeviceSearchState("failed");
        setLastError(normalized);
      }
    } finally {
      if (searchIsCurrent()) {
        setBusyAction(null);
      }
    }
  }, [handleCompanionUnavailableForRepair, runCompanion]);

  useEffect(() => {
    if (deviceRecoveryPickerReason !== "confirmed-loss") {
      recoverySearchStartedRef.current = false;
      return;
    }
    if (recoverySearchStartedRef.current) {
      return;
    }
    recoverySearchStartedRef.current = true;
    void searchAndConnect();
  }, [deviceRecoveryPickerReason, searchAndConnect]);

  // Resolves with null once the VibeTV is connected, or with the error the
  // customer should be shown. The setup wizard needs the outcome to choose a
  // dialog; every other caller ignores it and reads the state instead.
  const selectAndConnectDevice = useCallback(
    async (candidate: DeviceCandidate): Promise<ApiError | null> => {
      if (!candidate.deviceId) {
        const error: ApiError = {
          code: "device_identity_missing",
          message: "This VibeTV did not provide a stable device identity.",
          nextAction: "Search again, then choose a VibeTV with a device ID.",
        };
        setLastError(error);
        setDeviceSearchState("repair-failed");
        return error;
      }
      const setupGeneration = setupGenerationRef.current;
      pendingPairingCandidate.current = candidate;
      setBusyAction("select");
      setLastError(null);
      try {
        const payload = await runCompanion<{ device: DeviceInfo }>(
          "/v1/device/select",
          {
            method: "POST",
            body: JSON.stringify({
              target: candidate.target,
              expectedDeviceId: candidate.deviceId,
            }),
          },
          { timeoutMs: COMPANION_REPAIR_REQUEST_TIMEOUT_MS },
        );
        if (setupGeneration !== setupGenerationRef.current) {
          return null;
        }
        acceptDeviceSnapshot(payload.device);
        pendingPairingCandidate.current = null;
        setDeviceSearchState("idle");
        setLastError(null);
        addEvent({
          label: "VibeTV selected",
          detail:
            "The selected VibeTV is connected. Its display will update automatically.",
          tone: "ready",
        });
        void loadSettings();
        return null;
      } catch (error) {
        if (setupGeneration !== setupGenerationRef.current) {
          return null;
        }
        const normalized = connectionErrorForCustomer(
          normalizeCaughtError(
            error,
            "The selected VibeTV could not be connected.",
          ),
        );
        try {
          const statusPayload = await runCompanion<{ device?: DeviceInfo }>(
            "/v1/status",
            undefined,
            { preserveLastError: true },
          );
          if (setupGeneration !== setupGenerationRef.current) {
            return null;
          }
          if (
            deviceMatchesExpectedConnection(
              statusPayload.device,
              candidate.target,
              candidate.deviceId,
            )
          ) {
            acceptDeviceSnapshot(statusPayload.device);
            pendingPairingCandidate.current = null;
            setDeviceSearchState("idle");
            setLastError(null);
            addEvent({
              label: "VibeTV selected",
              detail:
                "The selected VibeTV is connected. Its display will update automatically.",
              tone: "ready",
            });
            void loadSettings();
            return null;
          }
        } catch {
          // Keep the select error unless a read-only status check proves that
          // the requested VibeTV is already connected and paired.
        }
        setLastError(normalized);
        setDeviceCandidates((current) =>
          current.length > 0 ? current : [candidate],
        );
        setDeviceSearchState("multiple");
        addEvent({
          label: "VibeTV selection failed",
          detail: normalized.nextAction,
          tone: "attention",
        });
        return normalized;
      } finally {
        if (setupGeneration === setupGenerationRef.current) {
          setBusyAction(null);
        }
      }
    },
    [acceptDeviceSnapshot, addEvent, loadSettings, runCompanion],
  );

  useEffect(() => {
    if (deviceRecoveryPickerReason !== "confirmed-loss" || busyAction) {
      return;
    }
    const preferredDeviceId = deviceRecoveryGateRef.current.preferredDeviceId;
    if (!preferredDeviceId) {
      return;
    }
    const candidate = deviceCandidates.find(
      (entry) => entry.deviceId === preferredDeviceId,
    );
    if (
      !candidate ||
      recoveryPreferredConnectAttemptRef.current === preferredDeviceId
    ) {
      return;
    }
    recoveryPreferredConnectAttemptRef.current = preferredDeviceId;
    void selectAndConnectDevice(candidate);
  }, [
    busyAction,
    deviceCandidates,
    deviceRecoveryPickerReason,
    selectAndConnectDevice,
  ]);

  // Resolves with the VibeTV at that address, or throws the error the customer
  // must be shown. Connecting is deliberately left to the wizard's connect
  // sequence: a typed address then gets the same pairing, firmware check and
  // log as a chosen card, instead of a second connect path of its own.
  const findManualTarget = useCallback(
    async (targetOverride: string): Promise<DeviceCandidate> => {
      const setupGeneration = setupGenerationRef.current;
      const searchAttempt = ++deviceSearchAttemptRef.current;
      const searchIsCurrent = () =>
        setupGeneration === setupGenerationRef.current &&
        searchAttempt === deviceSearchAttemptRef.current;
      const target = normalizeDeviceTarget(targetOverride);
      setBusyAction("manual-target");
      try {
        const payload = await runCompanion<{ devices?: DeviceCandidate[] }>(
          "/v1/device/search",
          {
            method: "POST",
            body: JSON.stringify({ target }),
          },
          { timeoutMs: DEVICE_SEARCH_REQUEST_TIMEOUT_MS },
        );
        const candidate = (payload.devices || []).find(
          (entry) =>
            entry.networkMode !== "setup" &&
            Boolean(entry.deviceId?.trim()) &&
            normalizeDeviceTarget(entry.target) === target,
        );
        if (!candidate) {
          throw {
            code: "device_not_found",
            message: "No VibeTV answered at that IP address.",
            nextAction:
              "Check the IP address shown on the VibeTV screen, then try again.",
          } satisfies ApiError;
        }
        return candidate;
      } catch (error) {
        const normalized = normalizeCaughtError(
          error,
          "That IP address did not answer as a VibeTV.",
        );
        setLastError(normalized);
        addEvent({
          label: "Manual VibeTV connection failed",
          detail: normalized.nextAction,
          tone: "attention",
        });
        // Settle the search this one superseded. Taking over the attempt
        // counter silently ends the running scan, and leaving its state on
        // "searching" strands the device step: nothing to pick, nothing to
        // explain it, and no way to scan again.
        if (searchIsCurrent()) {
          setDeviceSearchState("not-found");
        }
        throw normalized;
      } finally {
        if (searchIsCurrent()) {
          setBusyAction(null);
        }
      }
    },
    [addEvent, runCompanion],
  );

  const reloadDisplay = useCallback(
    async (options?: { quiet?: boolean }) => {
      const setupGeneration = setupGenerationRef.current;
      const quiet = Boolean(options?.quiet);
      setBusyAction("reload-display");
      try {
        const payload = await runCompanion<{ device: DeviceInfo }>(
          "/v1/device/reload-display",
          { method: "POST" },
          {
            preserveLastError: quiet,
            timeoutMs: COMPANION_REPAIR_REQUEST_TIMEOUT_MS,
          },
        );
        if (setupGeneration !== setupGenerationRef.current) {
          return;
        }
        setCompanionStatus("online");
        setLastError(null);
        acceptDeviceSnapshot(payload.device);
        if (!quiet || !deviceImageIsStuck(payload.device)) {
          addEvent({
            label: deviceImageIsStuck(payload.device)
              ? "Image is still stuck"
              : "Image reloaded",
            detail: deviceImageIsStuck(payload.device)
              ? "Press Reload image again."
              : "VibeTV redrew the current image.",
            tone: deviceImageIsStuck(payload.device) ? "attention" : "ready",
          });
        }
      } catch (error) {
        if (setupGeneration !== setupGenerationRef.current) {
          return;
        }
        const normalized = normalizeCaughtError(error, "Image reload failed.");
        if (isLocalNetworkAccessError(normalized)) {
          markCompanionAccessBlocked();
        } else if (isCompanionMissingError(normalized)) {
          markCompanionUnavailable();
        }
        if (!quiet) {
          setLastError(normalized);
          addEvent({
            label: "Image reload failed",
            detail: normalized.nextAction,
            tone: "attention",
          });
        }
      } finally {
        if (setupGeneration === setupGenerationRef.current) {
          setBusyAction(null);
        }
      }
    },
    [
      addEvent,
      acceptDeviceSnapshot,
      markCompanionAccessBlocked,
      markCompanionUnavailable,
      runCompanion,
    ],
  );

  const resetSetup = useCallback(async () => {
    const setupGeneration = setupGenerationRef.current;
    setBusyAction("reset-setup");
    setLastError(null);
    try {
      const payload = await runCompanion<{
        companion?: CompanionInfo;
        device?: DeviceInfo;
        providerSetup?: ProviderSetupInfo;
        setup?: ProviderSelectionSetup;
      }>("/v1/setup/reset", { method: "POST" });
      if (setupGeneration !== setupGenerationRef.current) {
        return;
      }
      setupGenerationRef.current += 1;
      forgetDeviceTarget();
      setDeviceRecoveryGate(resetDeviceRecoveryGate());
      setDeviceTarget("");
      setDeviceSession({ device: null, themeSetupIdentity: null });
      setDeviceState("unknown");
      setDeviceCandidates([]);
      setDeviceSearchState("idle");
      brightnessDirtyRef.current = false;
      setBrightness(null);
      standbyDirtyRef.current = false;
      lastSavedStandbyRef.current = null;
      setStandby(null);
      setLastInstall(undefined);
      setThemeInstallStatus(null);
      setSupportDiagnostics(null);
      setFirmwareUpdate(null);
      setFirmwareUpdateStatus(null);
      setUsage(null);
      setUsageError(null);
      setProviderSetup(null);
      // The reset deletes the saved display choice on the companion, so
      // holding the old one here would let a slow or failed re-read skip the
      // display step over a selection that no longer exists.
      setProviderDisplay(null);
      setProviderDisplayError(null);
      // The latch that says the wizard has already handed the screen back.
      // Left standing, the rerun reaches its closing step and is treated as
      // finished before it renders, so the customer never sees VibeTV running.
      setSetupFinished(false);
      setProviderSetupCompletedThisSession(false);
      setSetupThemeInstallRequested(false);
      setSetupThemeChoiceRequired(false);
      didRunAutoDisplayReload.current = false;
      didRunAutomaticDeviceSearch.current = false;
      didRunSetupVerification.current = false;
      setSetupPreviewStep(null);
      setActiveTab("overview");
      setCompanionStatus("online");
      setCompanionInfo(payload.companion || null);
      setProviderSetup(payload.providerSetup || null);
      setProviderSelectionSetup(
        payload.setup || {
          providerSelectionRequired: true,
          providerSelectionComplete: false,
        },
      );
      setThemeInstallEnabled(
        Boolean(payload.companion?.features?.themeInstallEnabled),
      );
      setHasEnteredControlCenter(false);
      if (payload.device) {
        setDevice(payload.device.connected ? payload.device : null);
      }
      addEvent({
        label: "Setup restarted",
        detail: "Local VibeTV connection was cleared.",
        tone: "unknown",
      });
      setBusyAction(null);
    } catch (error) {
      if (setupGeneration !== setupGenerationRef.current) {
        return;
      }
      const normalized = normalizeCaughtError(error, "Setup reset locally.");
      if (isLocalNetworkAccessError(normalized)) {
        markCompanionAccessBlocked();
      } else if (isCompanionMissingError(normalized)) {
        markCompanionUnavailable();
      } else {
        setCompanionStatus("online");
        setLastError(normalized);
      }
      addEvent({
        label: "Setup was not restarted",
        detail: normalized.nextAction,
        tone: "attention",
      });
      setBusyAction(null);
    }
  }, [
    addEvent,
    markCompanionAccessBlocked,
    markCompanionUnavailable,
    runCompanion,
    setDevice,
    setDeviceRecoveryGate,
  ]);

  const saveBrightness = useCallback(
    async (value: number) => {
      const setupGeneration = setupGenerationRef.current;
      brightnessDirtyRef.current = true;
      setBrightness(value);
      setBusyAction("brightness");
      try {
        const payload = await runCompanion<SettingsResponse>("/v1/settings", {
          method: "POST",
          body: JSON.stringify({ brightnessPercent: value }),
        });
        if (setupGeneration !== setupGenerationRef.current) {
          return;
        }
        const savedValue =
          payload.settings?.display?.brightnessPercent ?? value;
        brightnessDirtyRef.current = false;
        setBrightness(savedValue);
        addEvent({
          label: "Brightness saved",
          detail: `Display brightness is set to ${savedValue}%.`,
          tone: "ready",
        });
      } catch (error) {
        if (setupGeneration !== setupGenerationRef.current) {
          return;
        }
        const normalized = normalizeCaughtError(
          error,
          "Brightness needs attention.",
        );
        if (isLocalNetworkAccessError(normalized)) {
          markCompanionAccessBlocked();
        } else if (isCompanionMissingError(normalized)) {
          markCompanionUnavailable();
        }
        setLastError(normalized);
        addEvent({
          label: "Brightness save needs attention",
          detail: normalized.nextAction,
          tone: "attention",
        });
      } finally {
        if (setupGeneration === setupGenerationRef.current) {
          setBusyAction(null);
        }
      }
    },
    [
      addEvent,
      markCompanionAccessBlocked,
      markCompanionUnavailable,
      runCompanion,
    ],
  );

  const changeBrightness = useCallback((value: number) => {
    brightnessDirtyRef.current = true;
    setBrightness(value);
  }, []);

  const saveStandby = useCallback(
    async (value: StandbySettings) => {
      const setupGeneration = setupGenerationRef.current;
      standbyDirtyRef.current = true;
      setStandby(value);
      setBusyAction("standby");
      try {
        const payload = await runCompanion<SettingsResponse>("/v1/settings", {
          method: "POST",
          body: JSON.stringify({ standby: value }),
        });
        if (setupGeneration !== setupGenerationRef.current) {
          return;
        }
        const saved = payload.settings?.standby ?? value;
        standbyDirtyRef.current = false;
        lastSavedStandbyRef.current = saved;
        setStandby(saved);
        addEvent({
          label: "Screensaver saved",
          detail: saved.enabled
            ? `The screensaver starts after ${saved.timeoutMinutes} minutes at ${saved.brightnessPercent}% brightness.`
            : "The screensaver is off.",
          tone: "ready",
        });
      } catch (error) {
        if (setupGeneration !== setupGenerationRef.current) {
          return;
        }
        standbyDirtyRef.current = false;
        setStandby(lastSavedStandbyRef.current);
        const normalized = normalizeCaughtError(
          error,
          "Screensaver needs attention.",
        );
        if (isLocalNetworkAccessError(normalized)) {
          markCompanionAccessBlocked();
        } else if (isCompanionMissingError(normalized)) {
          markCompanionUnavailable();
        }
        setLastError(normalized);
        addEvent({
          label: "Screensaver save needs attention",
          detail: normalized.nextAction,
          tone: "attention",
        });
      } finally {
        if (setupGeneration === setupGenerationRef.current) {
          setBusyAction(null);
        }
      }
    },
    [
      addEvent,
      markCompanionAccessBlocked,
      markCompanionUnavailable,
      runCompanion,
    ],
  );

  const changeStandbyBrightness = useCallback((value: number) => {
    standbyDirtyRef.current = true;
    setStandby((current) =>
      current ? { ...current, brightnessPercent: value } : current,
    );
  }, []);

  const installTheme = useCallback(
    async (
      theme: InstallableTheme | undefined = selectedTheme,
    ): Promise<boolean> => {
      if (!theme) {
        return false;
      }
      if (
        theme.themeId === device?.activeTheme &&
        theme.themeSpecPath &&
        theme.themeSpecPath !== device.display?.themeSpec?.path
      ) {
        activeThemeUpgradeAttemptRef.current = [
          device.deviceId,
          device.display?.themeSpec?.path,
          theme.themeSpecPath,
        ].join("|");
      }
      const requiresThemeSetupVerification =
        theme.usage !== "screensaver" &&
        (deviceNeedsThemeSetup(device) ||
          deviceMatchesThemeSetupIdentity(themeSetupIdentity, device));
      setBusyAction("install");
      setLastInstall(undefined);
      if (theme.usage === "screensaver") {
        setSelectedScreensaverId(theme.themeId);
      } else {
        setSelectedThemeId(theme.themeId);
      }
      const startedAt = formatTime();
      const initialLogs = ["Preparing theme install."];
      const completeMessage =
        theme.usage === "screensaver"
          ? "Screensaver is ready on VibeTV."
          : "Theme is active on VibeTV.";
      let installJobId = "";
      const applyInstallJob = (job: ThemeInstallJob) => {
        const phase =
          job.phase === "complete"
            ? "complete"
            : job.phase === "error"
              ? "error"
              : "installing";
        const logs = customerInstallLogs(job.logs, initialLogs);
        setThemeInstallStatus({
          phase,
          themeId: theme.themeId,
          title: theme.title,
          startedAt,
          finishedAt:
            phase === "complete" || phase === "error"
              ? formatTime()
              : undefined,
          message:
            job.message || logs[logs.length - 1] || "Preparing theme install.",
          progress: clampProgress(job.progress),
          logs,
          result: job.result,
          error: job.error ? themeInstallErrorText(job.error) : undefined,
        });
      };
      setThemeInstallStatus({
        phase: "installing",
        themeId: theme.themeId,
        title: theme.title,
        startedAt,
        message: initialLogs[0],
        progress: 5,
        logs: initialLogs,
      });
      addEvent({
        label: "Theme install started",
        detail: `${theme.title} is ready for device install.`,
        at: startedAt,
        tone: "unknown",
      });
      try {
        const uploadedPack = theme.packBytes;
        let requestPath = "/v1/themes/install";
        let requestInit: RequestInit;
        if (uploadedPack) {
          const body = new ArrayBuffer(uploadedPack.byteLength);
          new Uint8Array(body).set(uploadedPack);
          requestPath += `?${new URLSearchParams({
            async: "true",
            slot: theme.usage || "live",
            themeId: theme.themeId,
            themeName: theme.title,
          }).toString()}`;
          requestInit = {
            method: "POST",
            body,
            headers: { "Content-Type": "application/zip" },
          };
        } else {
          requestInit = {
            method: "POST",
            body: JSON.stringify({
              themeId: theme.themeId,
              themeName: theme.title,
              packUrl: localizeCompanionAssetUrl(theme.packUrl),
              packSha256: theme.packSha256,
              packSizeBytes: theme.packSizeBytes,
              slot: theme.usage || "live",
              skipFirmwareUpdate: true,
              async: true,
            }),
          };
        }
        const payload = await runCompanion<InstallResponse>(
          requestPath,
          requestInit,
        );
        let result = payload.result;
        let logs = customerInstallLogs(payload.logs, initialLogs);
        // The Companion owns what the install ended as. A providerless VibeTV
        // finishes with "shows it once AI usage is ready", and overwriting that
        // here told the customer the theme was active while the device was
        // still drawing the error frame.
        let finalMessage = completeMessage;
        if (payload.job) {
          installJobId = payload.job.id;
          themeInstallPollJobRef.current = installJobId;
          applyInstallJob(payload.job);
          const finishedJob = await pollThemeInstallJob({
            applyInstallJob,
            jobId: payload.job.id,
            runCompanion,
          });
          if (finishedJob.phase === "error") {
            throw (
              finishedJob.error || {
                code: "theme_install_failed",
                message: "Theme install failed.",
                nextAction: "Keep VibeTV powered on and retry the install.",
              }
            );
          }
          result = finishedJob.result;
          logs = customerInstallLogs(finishedJob.logs, logs);
          finalMessage = finishedJob.message || completeMessage;
        }
        if (!result) {
          throw {
            code: "theme_install_failed",
            message: "Theme install failed.",
            nextAction: "Keep VibeTV powered on and retry the install.",
          } satisfies ApiError;
        }
        setLastInstall(result);
        const finishedAt = formatTime();
        setThemeInstallStatus({
          phase: "complete",
          themeId: theme.themeId,
          title: theme.title,
          startedAt,
          finishedAt,
          message: finalMessage,
          progress: 100,
          logs: customerInstallLogs([...logs, finalMessage]),
          result,
        });
        const [, verifiedDevice] = await Promise.all([
          loadSettings(),
          refreshDevice({ quiet: true }),
        ]);
        const setupVerified =
          !requiresThemeSetupVerification ||
          deviceCompletedThemeSetup(verifiedDevice);
        addEvent({
          label: setupVerified
            ? theme.usage === "screensaver"
              ? "Screensaver installed"
              : "Theme installed"
            : "Waiting for VibeTV confirmation",
          detail: setupVerified
            ? result.name || theme.title
            : "The theme is installed. VibeTV is still confirming its display.",
          at: finishedAt,
          tone: setupVerified ? "ready" : "unknown",
        });
        return setupVerified;
      } catch (error) {
        const normalized = normalizeCaughtError(
          error,
          "Theme install needs attention.",
        );
        if (isLocalNetworkAccessError(normalized)) {
          markCompanionAccessBlocked();
        } else if (isCompanionMissingError(normalized)) {
          markCompanionUnavailable();
        }
        setLastError(normalized);
        setThemeInstallStatus({
          phase: "error",
          themeId: theme.themeId,
          title: theme.title,
          startedAt,
          finishedAt: formatTime(),
          message: normalized.nextAction,
          progress: 100,
          logs: [...initialLogs, normalized.message, normalized.nextAction],
          error: themeInstallErrorText(normalized),
        });
        addEvent({
          label: "Theme install needs attention",
          detail: normalized.nextAction,
          tone: "attention",
        });
        return false;
      } finally {
        if (themeInstallPollJobRef.current === installJobId) {
          themeInstallPollJobRef.current = "";
        }
        setBusyAction(null);
      }
    },
    [
      addEvent,
      loadSettings,
      markCompanionAccessBlocked,
      markCompanionUnavailable,
      refreshDevice,
      runCompanion,
      selectedTheme,
      device,
      themeSetupIdentity,
    ],
  );

  const installCustomTheme = useCallback(
    async ({
      assets,
      packName,
      spec,
      usage = "live",
    }: ThemeStudioInstallPayload): Promise<boolean> => {
      const pack = buildThemePack(spec, packName, assets, usage);
      return installTheme({
        packBytes: pack.zipBytes,
        themeId: pack.manifest.id,
        title: pack.manifest.name,
        usage,
      });
    },
    [installTheme],
  );

  useEffect(() => {
    if (hostedSetup) {
      return;
    }
    if (setupPreviewStep) {
      return;
    }
    if (didRunInitialConnectionCheck.current) {
      return;
    }
    didRunInitialConnectionCheck.current = true;

    const timer = window.setTimeout(() => {
      void checkCompanion({ quiet: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [checkCompanion, hostedSetup, setupPreviewStep]);

  const connectionRecoveryRequired =
    isConnectionRecoveryError(lastError) || deviceNeedsExplicitConnect(device);

  // A search the background service did not survive answered nothing, and
  // nothing is not an answer. The service restarts several times while it
  // installs its usage engine on a fresh Mac, so the first search regularly
  // lands in one of those gaps; keeping its empty result told the customer
  // their VibeTV was not on the network. Once the service is back, search again.
  const companionWasOnline = useRef(false);
  // Sticky: a service that has answered once is one launchd will restart.
  const companionEverOnline = useRef(false);
  useEffect(() => {
    const online = companionStatus === "online";
    const returned = online && !companionWasOnline.current;
    companionWasOnline.current = online;
    companionEverOnline.current = companionEverOnline.current || online;
    if (!returned || deviceIsCustomerConnected(device)) {
      return;
    }
    didRunAutomaticDeviceSearch.current = false;
    setDeviceSearchState((current) =>
      current === "not-found" || current === "failed" ? "idle" : current,
    );
  }, [companionStatus, device]);

  useEffect(() => {
    if (
      hostedSetup ||
      setupPreviewStep ||
      requiresMacAppMigration ||
      firmwareUpdateInProgress ||
      connectionRecoveryRequired ||
      !initialCompanionCheckComplete ||
      companionStatus !== "online" ||
      deviceIsCustomerConnected(device) ||
      busyAction ||
      deviceSearchState !== "idle" ||
      didRunAutomaticDeviceSearch.current
    ) {
      return;
    }
    didRunAutomaticDeviceSearch.current = true;
    void searchAndConnect();
  }, [
    busyAction,
    companionStatus,
    connectionRecoveryRequired,
    device,
    deviceSearchState,
    firmwareUpdateInProgress,
    hostedSetup,
    requiresMacAppMigration,
    initialCompanionCheckComplete,
    searchAndConnect,
    setupPreviewStep,
  ]);

  useEffect(() => {
    if (
      lastError?.code !== "legacy_pairing_recovery_required" ||
      companionStatus !== "online"
    ) {
      return;
    }

    let cancelled = false;
    const refreshLegacyTarget = async () => {
      if (legacyRecoverySearchInFlight.current) {
        return;
      }
      legacyRecoverySearchInFlight.current = true;
      try {
        const payload = await runCompanion<{ devices?: DeviceCandidate[] }>(
          "/v1/device/search",
          { method: "POST" },
          {
            preserveLastError: true,
            timeoutMs: DEVICE_SEARCH_REQUEST_TIMEOUT_MS,
          },
        );
        if (cancelled) {
          return;
        }
        const expectedDeviceId =
          pendingPairingCandidate.current?.deviceId || device?.deviceId;
        const expectedTarget = normalizeDeviceTarget(
          pendingPairingCandidate.current?.target || deviceTarget,
        );
        const candidates = (payload.devices || []).filter(
          (candidate) => candidate.target && candidate.networkMode !== "setup",
        );
        const candidate =
          candidates.find(
            (entry) =>
              Boolean(expectedDeviceId) && entry.deviceId === expectedDeviceId,
          ) ||
          candidates.find(
            (entry) =>
              Boolean(expectedTarget) &&
              normalizeDeviceTarget(entry.target) === expectedTarget,
          ) ||
          (candidates.length === 1 ? candidates[0] : undefined);
        if (!candidate) {
          setDeviceCandidates([]);
          setDeviceSearchState("idle");
          return;
        }
        pendingPairingCandidate.current = candidate;
        setDeviceCandidates([candidate]);
        setDeviceSearchState("multiple");
        setDeviceTarget(candidate.target);
        rememberDeviceTarget(candidate.target);
      } catch {
        // The legacy VibeTV is expected to disappear while WiFi is reset.
        // Keep the recovery instructions visible and try discovery again.
      } finally {
        legacyRecoverySearchInFlight.current = false;
      }
    };

    const initialTimer = window.setTimeout(() => {
      void refreshLegacyTarget();
    }, 1_000);
    const interval = window.setInterval(() => {
      void refreshLegacyTarget();
    }, 8_000);
    return () => {
      cancelled = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
    };
  }, [
    companionStatus,
    device?.deviceId,
    deviceTarget,
    lastError?.code,
    runCompanion,
  ]);

  useEffect(() => {
    if (hostedSetup) {
      return;
    }
    if (!deviceIsReady(device) || !deviceImageIsStuck(device)) {
      didRunAutoDisplayReload.current = false;
      return;
    }
    if (
      setupPreviewStep ||
      didRunAutoDisplayReload.current ||
      busyAction ||
      companionStatus !== "online"
    ) {
      return;
    }
    didRunAutoDisplayReload.current = true;
    void reloadDisplay({ quiet: true });
  }, [
    busyAction,
    activeTab,
    companionStatus,
    device,
    hostedSetup,
    reloadDisplay,
    setupPreviewStep,
  ]);

  useEffect(() => {
    const shouldPollIncompleteSetup =
      companionStatus === "missing" ||
      // "unknown" (for example a local-network privacy block) must keep
      // polling too; otherwise no timer runs anymore and the app freezes on
      // stale state without any retry path.
      companionStatus === "unknown" ||
      (companionStatus === "online" && !deviceIsReady(device));
    if (hostedSetup || !shouldPollIncompleteSetup) {
      return;
    }

    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden" || busyAction) {
        return;
      }
      void checkCompanion({ quiet: true });
    }, 5000);

    return () => window.clearInterval(timer);
  }, [busyAction, checkCompanion, companionStatus, device, hostedSetup]);

  const deviceBoard = device?.board;
  const deviceFirmware = device?.firmware;

  const refreshFirmwareUpdate = useCallback(
    async (options: FirmwareCheckOptions = {}) => {
      const board = options.board || deviceBoard || "";
      const firmware = options.firmware || deviceFirmware || "";

      if (!board || !firmware) {
        setFirmwareUpdate(null);
        return null;
      }

      const params = new URLSearchParams({
        board,
        firmware,
      });

      try {
        if (isLocalCompanionOrigin()) {
          const payload = await runCompanion<FirmwareUpdateInfo>(
            `/v1/updates/latest?${params.toString()}`,
            { signal: options.signal },
            { preserveLastError: true },
          );
          setFirmwareUpdate(payload);
          return payload;
        } else {
          const response = await fetch(
            `/api/firmware/latest?${params.toString()}`,
            {
              signal: options.signal,
            },
          );
          if (!response.ok) {
            throw new Error(`firmware check failed: ${response.status}`);
          }
          const payload = (await response.json()) as FirmwareUpdateInfo;
          setFirmwareUpdate(payload);
          return payload;
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return null;
        }
        const failed: FirmwareUpdateInfo = {
          checkedAt: new Date().toISOString(),
          installedFirmware: firmware,
          updateAvailable: false,
          status: "check_failed",
          message: "Firmware check failed.",
        };
        setFirmwareUpdate(failed);
        return failed;
      }
    },
    [deviceBoard, deviceFirmware, runCompanion],
  );
  const {
    refresh: refreshHostedCompanionRelease,
    release: hostedCompanionRelease,
  } = useCompanionRelease(
    companionInfo?.app?.version || companionInfo?.version,
  );

  const checkUpdates = useCallback(async () => {
    setBusyAction("firmware-check");
    try {
      const checks: Array<Promise<unknown>> = [
        checkCompanion({ quiet: true }),
        refreshFirmwareUpdate(),
        refreshHostedCompanionRelease(),
      ];
      await Promise.all(checks);
    } finally {
      setBusyAction(null);
    }
  }, [checkCompanion, refreshFirmwareUpdate, refreshHostedCompanionRelease]);

  const installFirmwareUpdate = useCallback(async () => {
    const activeThemeUpgrade = resolveActiveThemeUpgrade(
      catalog.themes,
      device,
    );
    const shouldUpgradeActiveTheme = Boolean(
      activeThemeUpgrade.theme && activeThemeUpgrade.needed,
    );
    const startedAt = formatTime();
    const initialLogs = ["Preparing VibeTV update."];
    const firmwareIsKnownCurrent = Boolean(
      firmwareUpdate?.status === "current" &&
      (!firmwareUpdate.installedFirmware ||
        firmwareUpdate.installedFirmware === device?.firmware),
    );
    const shouldUpgradeOnlyActiveTheme = Boolean(
      activeThemeUpgrade.theme &&
      activeThemeUpgrade.needsThemeSpec &&
      !activeThemeUpgrade.needsFirmwareCapability &&
      firmwareIsKnownCurrent,
    );
    if (shouldUpgradeOnlyActiveTheme && activeThemeUpgrade.theme) {
      setBusyAction("firmware-update");
      setFirmwareUpdateStatus({
        phase: "installing",
        startedAt,
        message: "Updating VibeTV.",
        progress: 95,
        logs: initialLogs,
      });
      addEvent({
        label: "VibeTV update started",
        detail: "VibeTV is being updated.",
        at: startedAt,
        tone: "unknown",
      });
      if (!(await installTheme(activeThemeUpgrade.theme))) {
        const message =
          "The firmware is current, but VibeTV still needs attention.";
        setFirmwareUpdateStatus({
          phase: "attention",
          outcome: "firmware_current_theme_attention",
          startedAt,
          finishedAt: formatTime(),
          message,
          progress: 100,
          logs: customerUpdateLogs([...initialLogs, message]),
        });
        addEvent({
          label: "VibeTV update needs attention",
          detail: message,
          tone: "attention",
        });
        return false;
      }
      setFirmwareUpdateStatus({
        phase: "complete",
        startedAt,
        finishedAt: formatTime(),
        message: "Update complete.",
        progress: 100,
        logs: customerUpdateLogs([...initialLogs, "Update complete."]),
      });
      addEvent({
        label: "VibeTV updated",
        detail: `${activeThemeUpgrade.theme.title} is current.`,
        tone: "ready",
      });
      return true;
    }
    const applyUpdateJob = (job: FirmwareUpdateJob) => {
      setFirmwareUpdateStatus(firmwareUpdateStatusFromJob(job, startedAt));
    };
    setBusyAction("firmware-update");
    setFirmwareUpdateStatus({
      phase: "installing",
      startedAt,
      message: initialLogs[0],
      progress: 5,
      logs: initialLogs,
    });
    addEvent({
      label: "VibeTV update started",
      detail: "VibeTV is being updated.",
      at: startedAt,
      tone: "unknown",
    });
    try {
      const payload = await runCompanion<FirmwareUpdateResponse>(
        "/v1/updates/install",
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      );
      if (!payload.job) {
        throw {
          code: "firmware_update_failed",
          message: "VibeTV update failed.",
          nextAction: "Keep VibeTV powered on, then try again.",
        } satisfies ApiError;
      }
      applyUpdateJob(payload.job);
      const finishedJob = await pollFirmwareUpdateJob({
        applyUpdateJob,
        jobId: payload.job.id,
        runCompanion,
      });
      if (finishedJob.phase === "error") {
        throw (
          finishedJob.error || {
            code: "firmware_update_failed",
            message: "VibeTV update failed.",
            nextAction: "Keep VibeTV powered on, then try again.",
          }
        );
      }
      if (finishedJob.phase === "attention") {
        const logs = customerUpdateLogs(finishedJob.logs, initialLogs);
        const finishedAt = formatTime();
        setFirmwareUpdateStatus({
          phase: "attention",
          stage: finishedJob.stage,
          outcome: finishedJob.outcome,
          startedAt,
          finishedAt,
          message:
            finishedJob.message ||
            "The firmware is current, but VibeTV still needs attention.",
          progress: 100,
          logs,
          result: finishedJob.result,
        });
        const installedFirmware = finishedJob.result?.firmware?.trim() || "";
        if (installedFirmware) {
          setDevice((current) =>
            current ? { ...current, firmware: installedFirmware } : current,
          );
          setFirmwareUpdate(currentFirmwareUpdate(installedFirmware));
        }
        addEvent({
          label: "VibeTV update needs attention",
          detail:
            finishedJob.message ||
            "The firmware is current, but the connection or picture still needs repair.",
          at: finishedAt,
          tone: "attention",
        });
        return true;
      }
      const logs = customerUpdateLogs(finishedJob.logs, initialLogs);
      const finishedAt = formatTime();
      const installedFirmware = finishedJob.result?.firmware?.trim() || "";
      if (installedFirmware) {
        setDevice((current) =>
          current ? { ...current, firmware: installedFirmware } : current,
        );
        setFirmwareUpdate(currentFirmwareUpdate(installedFirmware));
      }
      const refreshedDevice = await refreshDevice({ quiet: true });
      const firmwareForCheck = installedFirmware || refreshedDevice?.firmware;
      const boardForCheck = refreshedDevice?.board || deviceBoard;
      if (installedFirmware) {
        setDevice((current) =>
          current
            ? { ...current, firmware: installedFirmware }
            : refreshedDevice
              ? { ...refreshedDevice, firmware: installedFirmware }
              : current,
        );
      }
      if (boardForCheck && firmwareForCheck) {
        await refreshFirmwareUpdate({
          board: boardForCheck,
          firmware: firmwareForCheck,
        });
      }
      const completedLogs = logs;
      const refreshedActiveThemeUpgrade = resolveActiveThemeUpgrade(
        catalog.themes,
        refreshedDevice,
      );
      if (
        refreshedActiveThemeUpgrade.unresolved &&
        !deviceNeedsThemeSetup(refreshedDevice)
      ) {
        const message =
          "The firmware is current, but VibeTV still needs attention.";
        setFirmwareUpdateStatus({
          phase: "attention",
          outcome: "firmware_current_theme_catalog_attention",
          startedAt,
          finishedAt,
          message,
          progress: 100,
          logs: customerUpdateLogs([...logs, message]),
          result: finishedJob.result,
        });
        addEvent({
          label: "VibeTV update needs attention",
          detail: message,
          at: finishedAt,
          tone: "attention",
        });
        return true;
      }
      if (shouldUpgradeActiveTheme || refreshedActiveThemeUpgrade.needed) {
        if (
          !refreshedActiveThemeUpgrade.theme ||
          refreshedActiveThemeUpgrade.needsFirmwareCapability
        ) {
          const message =
            "The firmware is current, but VibeTV still needs attention.";
          setFirmwareUpdateStatus({
            phase: "attention",
            outcome: "firmware_current_theme_support_attention",
            startedAt,
            finishedAt,
            message,
            progress: 100,
            logs: customerUpdateLogs([...logs, message]),
            result: finishedJob.result,
          });
          addEvent({
            label: "VibeTV update needs attention",
            detail: message,
            at: finishedAt,
            tone: "attention",
          });
          return true;
        }
        setFirmwareUpdateStatus({
          phase: "installing",
          startedAt,
          message: "Updating VibeTV.",
          progress: 95,
          logs,
          result: finishedJob.result,
        });
        if (!(await installTheme(refreshedActiveThemeUpgrade.theme))) {
          const message =
            "The firmware is current, but VibeTV still needs attention.";
          setFirmwareUpdateStatus({
            phase: "attention",
            outcome: "firmware_current_theme_attention",
            startedAt,
            finishedAt: formatTime(),
            message,
            progress: 100,
            logs: customerUpdateLogs([...logs, message]),
            result: finishedJob.result,
          });
          addEvent({
            label: "VibeTV update needs attention",
            detail: message,
            tone: "attention",
          });
          return true;
        }
      }
      setFirmwareUpdateStatus({
        phase: "complete",
        startedAt,
        finishedAt: formatTime(),
        message: "Update complete.",
        progress: 100,
        logs: customerUpdateLogs([...completedLogs, "Update complete."]),
        result: finishedJob.result,
      });
      addEvent({
        label: "VibeTV updated",
        detail: installedFirmware
          ? `Firmware ${installedFirmware} is installed.`
          : "Update complete.",
        tone: "ready",
      });
      return true;
    } catch (error) {
      const normalized = normalizeCaughtError(error, "VibeTV update failed.");
      if (isLocalNetworkAccessError(normalized)) {
        markCompanionAccessBlocked();
      } else if (isCompanionMissingError(normalized)) {
        markCompanionUnavailable();
      }
      setLastError(normalized);
      lastFirmwareErrorRef.current = normalized;
      setFirmwareUpdateStatus({
        phase: "error",
        startedAt,
        finishedAt: formatTime(),
        message: normalized.nextAction,
        progress: 100,
        logs: [...initialLogs, normalized.message, normalized.nextAction],
        error: normalized.nextAction,
        retryAllowed: normalized.code !== "firmware_update_restart_required",
      });
      addEvent({
        label: "VibeTV update failed",
        detail: normalized.nextAction,
        tone: "attention",
      });
      return false;
    } finally {
      setBusyAction(null);
    }
  }, [
    addEvent,
    catalog.themes,
    device,
    deviceBoard,
    firmwareUpdate,
    installTheme,
    markCompanionAccessBlocked,
    markCompanionUnavailable,
    refreshDevice,
    refreshFirmwareUpdate,
    runCompanion,
    setDevice,
  ]);

  const retryActiveThemeUpgrade = useCallback(async (): Promise<boolean> => {
    const activeThemeUpgrade = resolveActiveThemeUpgrade(
      catalog.themes,
      device,
    );
    if (!activeThemeUpgrade.theme) {
      return false;
    }
    const previousStatus = firmwareUpdateStatus;
    const startedAt = previousStatus?.startedAt || formatTime();
    const logs = previousStatus?.logs || ["Preparing VibeTV update."];
    setFirmwareUpdateStatus({
      phase: "installing",
      startedAt,
      message: "Updating VibeTV.",
      progress: 95,
      logs,
      result: previousStatus?.result,
    });
    if (!(await installTheme(activeThemeUpgrade.theme))) {
      const message =
        "The firmware is current, but VibeTV still needs attention.";
      setFirmwareUpdateStatus({
        phase: "attention",
        outcome: "firmware_current_theme_attention",
        startedAt,
        finishedAt: formatTime(),
        message,
        progress: 100,
        logs: customerUpdateLogs([...logs, message]),
        result: previousStatus?.result,
      });
      return false;
    }
    setFirmwareUpdateStatus({
      phase: "complete",
      startedAt,
      finishedAt: formatTime(),
      message: "Update complete.",
      progress: 100,
      logs: customerUpdateLogs([...logs, "Update complete."]),
      result: previousStatus?.result,
    });
    return true;
  }, [catalog.themes, device, firmwareUpdateStatus, installTheme]);

  const refreshUsage = useCallback(
    async (options?: { quiet?: boolean }) => {
      const quiet = Boolean(options?.quiet);
      if (!quiet) {
        setBusyAction("usage");
      }
      try {
        const payload = await runCompanion<UsageSnapshot>(
          quiet ? "/v1/usage" : "/v1/usage?refresh=1",
          undefined,
          { preserveLastError: quiet },
        );
        setUsage(payload);
        setUsageError(null);
        setCompanionStatus("online");
        if (!quiet) {
          const refreshEvent = usageRefreshEvent(payload);
          addEvent({
            label: refreshEvent.label,
            detail: refreshEvent.detail,
            tone: refreshEvent.tone,
          });
        }
      } catch (error) {
        const normalized = normalizeUsageError(
          normalizeCaughtError(error, "Usage needs attention."),
        );
        if (normalized.code === "usage_unavailable") {
          setUsageError(null);
          return;
        }
        if (isLocalNetworkAccessError(normalized)) {
          markCompanionAccessBlocked();
        } else if (isCompanionMissingError(normalized)) {
          markCompanionUnavailable();
        }
        setUsageError(normalized);
        if (!quiet) {
          setLastError(normalized);
          addEvent({
            label: "Usage refresh needs attention",
            detail: normalized.nextAction,
            tone: "attention",
          });
        }
      } finally {
        if (!quiet) {
          setBusyAction(null);
        }
      }
    },
    [
      addEvent,
      markCompanionAccessBlocked,
      markCompanionUnavailable,
      runCompanion,
    ],
  );

  const refreshProviderPreferences = useCallback(
    async (options?: { quiet?: boolean }) => {
      try {
        const payload = await runCompanion<{ items: PreferenceDescriptor[] }>(
          "/v1/preferences?section=providers",
          undefined,
          { preserveLastError: Boolean(options?.quiet) },
        );
        setProviderPreferences(payload.items || []);
        setProviderPreferencesError(null);
      } catch (error) {
        setProviderPreferencesError(
          normalizeCaughtError(error, "Provider settings need attention."),
        );
      }
    },
    [runCompanion],
  );

  const refreshProviderDisplay = useCallback(
    async (options?: { quiet?: boolean }) => {
      try {
        const payload = await runCompanion<{
          selection: ProviderDisplaySelection;
        }>("/v1/provider-display", undefined, {
          preserveLastError: Boolean(options?.quiet),
        });
        setProviderDisplay(payload.selection);
        setProviderDisplayError(null);
      } catch (error) {
        setProviderDisplayError(
          normalizeCaughtError(error, "Display selection needs attention."),
        );
      }
    },
    [runCompanion],
  );

  const checkProvider = useCallback(
    (item: PreferenceDescriptor) => {
      const providerId = item.providerId?.trim().toLowerCase();
      if (!providerId) {
        return Promise.resolve();
      }
      setPendingProviderCheckIds((current) =>
        new Set(current).add(providerId),
      );
      const runCheck = async () => {
        try {
          await runCompanion(
            `/v1/providers/retry?provider=${encodeURIComponent(providerId)}`,
            { method: "POST" },
          );
          await refreshProviderPreferences({ quiet: true });
          setProviderPreferencesError(null);
        } catch (error) {
          setProviderPreferencesError(
            normalizeCaughtError(error, `${item.label} could not be checked.`),
          );
        } finally {
          setPendingProviderCheckIds((current) => {
            const next = new Set(current);
            next.delete(providerId);
            return next;
          });
        }
      };
      const queuedCheck = providerCheckQueueRef.current.then(
        runCheck,
        runCheck,
      );
      providerCheckQueueRef.current = queuedCheck;
      return queuedCheck;
    },
    [refreshProviderPreferences, runCompanion],
  );

  const updateProviderDisplay = useCallback(
    async (
      selection: Pick<ProviderDisplaySelection, "mode" | "providerIds">,
      providerId: string,
    ) => {
      const previous = providerDisplay;
      setPendingProviderDisplayId(providerId);
      setProviderDisplay({ ...selection, configured: true, valid: true });
      try {
        const payload = await runCompanion<{
          selection: ProviderDisplaySelection;
        }>("/v1/provider-display", {
          method: "PATCH",
          body: JSON.stringify(selection),
        });
        setProviderDisplay(payload.selection);
        setProviderDisplayError(null);
        void refreshUsage({ quiet: true });
        return true;
      } catch (error) {
        setProviderDisplay(previous);
        setProviderDisplayError(
          normalizeCaughtError(error, "Display selection could not be saved."),
        );
        return false;
      } finally {
        setPendingProviderDisplayId(null);
      }
    },
    [providerDisplay, refreshUsage, runCompanion],
  );

  const completeProviderSetup = useCallback(async () => {
    setBusyAction("provider-setup-complete");
    try {
      const payload = await runCompanion<{
        setup: ProviderSelectionSetup;
      }>("/v1/setup/providers/complete", { method: "POST" });
      setProviderSelectionSetup(payload.setup);
      setProviderSetupCompletedThisSession(true);
      setSetupThemeInstallRequested(false);
      setProviderDisplayError(null);
      setLastError(null);
      return true;
    } catch (error) {
      const refusal = normalizeCaughtError(
        error,
        "Provider setup is not complete yet.",
      );
      // The selection is read again so the step it names shows what is
      // actually saved, and that read runs before the refusal is written
      // because a read that succeeds clears it.
      const step = setupStepForProviderRefusal(refusal.code);
      if (step) {
        await refreshProviderDisplay({ quiet: true });
        setProviderDisplayError(refusal);
        return step;
      }
      setProviderDisplayError(refusal);
      return false;
    } finally {
      setBusyAction(null);
    }
  }, [refreshProviderDisplay, runCompanion]);

  /**
   * Keeps the Automatic pool equal to the set of switched-on providers.
   *
   * Only for Automatic: a fixed selection names one provider on purpose, and
   * widening it would undo the customer's choice. A fixed selection whose
   * provider was just switched off is left alone too -- the companion refuses
   * it, and refusing is what hands the customer back to the display step where
   * they can pick another one.
   */
  const syncAutomaticProviderPool = useCallback(
    async (item: PreferenceDescriptor, enabled: boolean) => {
      const providerId = item.providerId;
      // Maintains an existing selection; never creates one. Writing a pool
      // before the customer has made the choice marks the display configured
      // and makes setup skip the very step that asks for it.
      if (
        !providerId ||
        providerDisplay?.configured !== true ||
        providerDisplay.mode !== "automatic"
      ) {
        return;
      }
      const current = new Set(providerDisplay.providerIds || []);
      if (current.has(providerId) === enabled) {
        return;
      }
      if (enabled) {
        current.add(providerId);
      } else {
        current.delete(providerId);
      }
      // An empty pool is a selection the companion refuses. Switching off the
      // last provider is a real state -- it is what the provider step is for --
      // so leave the stored pool as it is rather than writing one that cannot
      // be stored.
      if (current.size === 0) {
        return;
      }
      await updateProviderDisplay(
        { mode: "automatic", providerIds: [...current] },
        providerId,
      );
    },
    [providerDisplay, updateProviderDisplay],
  );

  const updateProviderPreference = useCallback(
    async (item: PreferenceDescriptor, value: boolean) => {
      if (value) {
        providerReconcileDeadlineRef.current =
          Date.now() + PROVIDER_RECONCILE_WINDOW_MS;
      }
      setPendingPreferenceIds((current) => new Set(current).add(item.id));
      setProviderPreferences((current) =>
        (current || []).map((preference) =>
          preference.id === item.id
            ? {
                ...preference,
                value,
                effectiveValue: value,
                health: value
                  ? {
                      ...preference.health,
                      state: "checking",
                      service: "unknown",
                      message: "Checking provider status.",
                    }
                  : {
                      ...preference.health,
                      state: "disabled",
                      service: "unknown",
                      message: "Provider is off.",
                    },
              }
            : preference,
        ),
      );
      try {
        const payload = await runCompanion<{ item: PreferenceDescriptor }>(
          `/v1/preferences/${encodeURIComponent(item.id)}`,
          { method: "PATCH", body: JSON.stringify({ value }) },
        );
        setProviderPreferences((current) =>
          (current || []).map((preference) =>
            preference.id === payload.item.id ? payload.item : preference,
          ),
        );
        setProviderPreferencesError(null);
        // Automatic means "every provider that is switched on", so switching
        // one on or off IS the change to the pool. The runtime filters strictly
        // by the stored list (daemon.go applyProviderDisplaySelection), so a
        // provider left out of it is enabled, healthy, and permanently invisible
        // on the device -- with nothing on screen saying why. Writing the pool
        // here is the one central rule that keeps them equal; the alternative
        // was a per-row inclusion control plus a repair effect to finish what it
        // half-did.
        await syncAutomaticProviderPool(payload.item, value);
        if (value) {
          await checkProvider(payload.item);
        }
        void Promise.all([
          refreshProviderPreferences({ quiet: true }),
          refreshProviderDisplay({ quiet: true }),
          refreshUsage({ quiet: true }),
        ]);
      } catch (error) {
        setProviderPreferences((current) =>
          (current || []).map((preference) =>
            preference.id === item.id ? item : preference,
          ),
        );
        setProviderPreferencesError(
          normalizeCaughtError(error, "Provider could not be updated."),
        );
      } finally {
        setPendingPreferenceIds((current) => {
          const next = new Set(current);
          next.delete(item.id);
          return next;
        });
      }
    },
    [
      checkProvider,
      refreshProviderDisplay,
      refreshProviderPreferences,
      refreshUsage,
      runCompanion,
      syncAutomaticProviderPool,
    ],
  );

  useEffect(() => {
    if (
      activeTab !== "usage" ||
      providerReconcileDeadlineRef.current <= Date.now()
    ) {
      return;
    }
    const needsReconcile = providerUsageNeedsReconcile(
      providerPreferences,
      usage,
    );
    if (!needsReconcile) {
      providerReconcileDeadlineRef.current = 0;
      return;
    }
    return scheduleProviderUsageReconcile({
      deadline: providerReconcileDeadlineRef.current,
      preferences: providerPreferences,
      usage,
      refresh: () => {
        void Promise.all([
          refreshProviderPreferences({ quiet: true }),
          refreshUsage({ quiet: true }),
        ]);
      },
    });
  }, [
    activeTab,
    providerPreferences,
    refreshProviderPreferences,
    refreshUsage,
    usage,
  ]);

  // Resolves with the collected report, or null when nothing could be read.
  // The Help menu saves what it gets and says which of the two happened.
  const loadSupportDiagnostics = useCallback(async (): Promise<
    SupportDiagnostics | null
  > => {
    const setupGeneration = setupGenerationRef.current;
    setSupportReportBusy(true);
    try {
      const payload = await collectSupportReport(
        () => runCompanion<SupportDiagnostics>("/v1/diagnostics"),
        {
          runtimeSurface,
          activeTab,
          companionStatus,
          companion: companionInfo,
          deviceState,
          deviceTarget,
          device,
          deviceSearchState,
          deviceCandidates,
          deviceRecovery: {
            preferredDeviceId:
              deviceRecoveryGateRef.current.preferredDeviceId || undefined,
            failedNormalChecks:
              deviceRecoveryGateRef.current.failedNormalChecks,
            pickerReason: deviceRecoveryPickerReason,
            normalFailureLimit: DEVICE_RECOVERY_NORMAL_FAILURE_LIMIT,
            operationFailureLimit: DEVICE_RECOVERY_OPERATION_FAILURE_LIMIT,
          },
          providerSetup,
          lastError,
          recentEvents: events,
          firmwareUpdate,
          firmwareUpdateStatus,
          themeInstallStatus,
          usage,
        },
      );
      if (setupGeneration !== setupGenerationRef.current) {
        return null;
      }
      setSupportDiagnostics(payload);
      const partial = Boolean(payload.collectionErrors?.length);
      if (!partial) {
        setCompanionStatus("online");
        setCompanionInfo(payload.companion || null);
        setProviderSetup(payload.providerSetup || null);
        setThemeInstallEnabled(
          Boolean(payload.companion?.features?.themeInstallEnabled),
        );
      }
      addEvent({
        label: partial
          ? "Support report ready with gaps"
          : "Support report ready",
        detail: partial
          ? "Browser and setup details were saved even though the Mac App did not answer."
          : `${payload.checks?.length || 0} items ready for support.`,
        tone:
          partial || payload.checks?.some((check) => check.status === "fail")
            ? "attention"
            : "ready",
      });
      return payload;
    } catch (error) {
      if (setupGeneration !== setupGenerationRef.current) {
        return null;
      }
      const normalized = normalizeCaughtError(error, "Support report failed.");
      if (isLocalNetworkAccessError(normalized)) {
        markCompanionAccessBlocked();
      } else {
        markCompanionUnavailable();
      }
      setSupportDiagnostics(null);
      setLastError(normalized);
      addEvent({
        label: "Support report failed",
        detail: normalized.nextAction,
        tone: "attention",
      });
      return null;
    } finally {
      setSupportReportBusy(false);
    }
  }, [
    addEvent,
    activeTab,
    companionInfo,
    companionStatus,
    device,
    deviceCandidates,
    deviceRecoveryPickerReason,
    deviceSearchState,
    deviceState,
    deviceTarget,
    events,
    firmwareUpdate,
    firmwareUpdateStatus,
    lastError,
    markCompanionAccessBlocked,
    markCompanionUnavailable,
    providerSetup,
    runCompanion,
    runtimeSurface,
    themeInstallStatus,
    usage,
  ]);

  const retryProviderSetup = useCallback(async () => {
    const setupGeneration = setupGenerationRef.current;
    setBusyAction("providers-retry");
    setLastError(null);
    try {
      const payload = await runCompanion<{
        providerSetup?: ProviderSetupInfo;
      }>("/v1/providers/retry", { method: "POST" });
      await refreshProviderPreferences({ quiet: true });
      if (setupGeneration === setupGenerationRef.current) {
        const setup = payload.providerSetup || null;
        setProviderSetup(setup);
        setCompanionStatus("online");
        return setup;
      }
    } catch (error) {
      if (setupGeneration === setupGenerationRef.current) {
        setLastError(
          normalizeCaughtError(error, "Usage check could not finish."),
        );
      }
    } finally {
      if (setupGeneration === setupGenerationRef.current) {
        setBusyAction(null);
      }
    }
    return null;
  }, [refreshProviderPreferences, runCompanion]);

  // One place tells the native side it may drop the temporary CodexBar, and it
  // is the same place that clears the outstanding flag. Every exit from a
  // recovery goes through here.
  const endCodexBarRecovery = useCallback(() => {
    codexBarRecoveryOutstanding.current = false;
    finishCodexBarRecovery();
  }, []);

  const repairUsageService = useCallback(() => {
    if (!isNativeControlCenterApp()) {
      void retryProviderSetup();
      return;
    }
    if (codexBarRepairTimeout.current !== null) {
      window.clearTimeout(codexBarRepairTimeout.current);
    }
    setBusyAction("usage-service-repair");
    setLastError(null);
    addEvent({
      label: "Usage service repair started",
      detail: "Restarting the managed usage service.",
      tone: "unknown",
    });
    launchCodexBarRepair();
    codexBarRecoveryOutstanding.current = true;
    codexBarRepairTimeout.current = window.setTimeout(() => {
      codexBarRepairTimeout.current = null;
      setBusyAction(null);
      setLastError({
        code: "CODEXBAR_REPAIR_TIMEOUT",
        message: "Repair could not finish.",
        nextAction: "Try the repair again or create a support report.",
      });
      addEvent({
        label: "Usage service restart timed out",
        detail: "The managed usage service did not return in time.",
        tone: "attention",
      });
      endCodexBarRecovery();
    }, NATIVE_RUNTIME_REPAIR_TIMEOUT_MS);
  }, [addEvent, endCodexBarRecovery, retryProviderSetup]);

  useEffect(() => {
    const handleResult = (event: Event) => {
      if (codexBarRepairTimeout.current === null) {
        return;
      }
      window.clearTimeout(codexBarRepairTimeout.current);
      codexBarRepairTimeout.current = null;
      const detail = (event as CustomEvent<{ success?: boolean }>).detail;
      if (detail?.success) {
        addEvent({
          label: "Usage service restarted",
          detail: "Checking whether valid usage data is available now.",
          tone: "unknown",
        });
        void retryProviderSetup()
          .then((setup) => {
            if (!setup || providerSetupRequiresRecovery(setup)) {
              return;
            }
            providerRecoveryManualAttempted.current = false;
          })
          .finally(endCodexBarRecovery);
        return;
      }
      setBusyAction(null);
      setLastError({
        code: "CODEXBAR_REPAIR_FAILED",
        message: "Repair could not finish.",
        nextAction: "Try the repair again or create a support report.",
      });
      addEvent({
        label: "Usage service restart failed",
        detail: "The managed usage service could not restart.",
        tone: "attention",
      });
      endCodexBarRecovery();
    };
    window.addEventListener(NATIVE_CODEXBAR_REPAIR_RESULT_EVENT, handleResult);
    return () => {
      window.removeEventListener(
        NATIVE_CODEXBAR_REPAIR_RESULT_EVENT,
        handleResult,
      );
      if (codexBarRepairTimeout.current !== null) {
        window.clearTimeout(codexBarRepairTimeout.current);
        codexBarRepairTimeout.current = null;
      }
      // A reload here would otherwise leave the temporary CodexBar this
      // recovery started running for the rest of the window session: the native
      // side only stops it on the finish action or on window close. This also
      // covers a reload during the provider retry, where the timeout handle is
      // already cleared but the retry's own finish can no longer be sent.
      if (codexBarRecoveryOutstanding.current) {
        endCodexBarRecovery();
      }
    };
  }, [addEvent, endCodexBarRecovery, retryProviderSetup]);

  const retryUsageService = useCallback(() => {
    providerRecoveryManualAttempted.current = true;
    repairUsageService();
  }, [repairUsageService]);

  useEffect(() => {
    if (!deviceBoard || !deviceFirmware) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void refreshFirmwareUpdate({ signal: controller.signal });
    }, 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [deviceBoard, deviceFirmware, refreshFirmwareUpdate]);

  const logs = events.map((event) => ({
    id: event.id,
    label: event.label,
    detail: event.detail,
    timestamp: event.at,
  }));
  const effectiveFirmwareUpdate =
    firmwareUpdate?.installedFirmware === device?.firmware
      ? firmwareUpdate
      : null;
  const firmwareUpdateAvailable = hasFirmwareUpdate(effectiveFirmwareUpdate);
  const activeThemeUpgrade = resolveActiveThemeUpgrade(catalog.themes, device);
  // Read the slot from the polled VibeTV snapshot, the way the live slot reads
  // its own path. The settings screen carries the same value, but only after
  // someone opens it, so keying the automatic update off that state left every
  // customer who stays on Overview with an outdated screensaver.
  // Only the path matters here. Depending on the whole standby object would
  // re-run the install effect on every poll, because each poll hands back a
  // fresh object.
  const screensaverPath =
    device?.standby?.screensaverPath?.trim() || undefined;
  const screensaverUpgrade = useMemo(
    () => resolveScreensaverUpgrade(catalog.themes, screensaverPath),
    [catalog.themes, screensaverPath],
  );
  // While standby is up the screensaver IS the screen on display, and
  // installing into the slot restores the live theme first — the display would
  // wake with nobody asking. It resolves on its own: standby ends on the first
  // frame that moves the usage numbers.
  const screensaverSlotOnScreen = device?.standby?.active === true;
  // One install per round, live slot first: the screensaver only shows once
  // standby takes over, so the screen the customer is looking at wins.
  const pendingUpgrade = activeThemeUpgrade.needsThemeSpec
    ? activeThemeUpgrade
    : screensaverSlotOnScreen
      ? NO_THEME_UPGRADE
      : screensaverUpgrade;
  // In the installed native app the runtime's release check is authoritative:
  // it honors the release-feed override and Sparkle is always an actionable
  // update path — the 2026-08-09 rehearsal entered the firmware-ahead mixed
  // state because the hosted browser check shadowed the runtime's pending
  // update. Outside the native app the hosted check keeps priority: it owns
  // DMG asset verification, and an update without a verified DMG must stay
  // unannounced.
  const runtimeRelease = companionInfo?.update;
  const companionRelease =
    runtimeRelease &&
    runtimeRelease.status !== "check_failed" &&
    companionInfo?.app?.installedInApplications
      ? { ...(hostedCompanionRelease ?? {}), ...runtimeRelease }
      : hostedCompanionRelease?.status === "check_failed" && runtimeRelease
        ? { ...runtimeRelease, ...hostedCompanionRelease }
        : hostedCompanionRelease || runtimeRelease || null;
  const macAppUpdateAvailable = Boolean(
    companionInfo?.update?.updateAvailable || companionRelease?.updateAvailable,
  );
  // A pending Mac App update must resolve immediately once the customer is in
  // the app — most urgently in the mixed state where the device firmware is
  // already ahead of this app and renders degraded. Surface the native Sparkle
  // dialog once per offered version; the Updates tab stays the manual path if
  // the dialog is dismissed.
  const macAppUpdateOfferedVersion =
    companionRelease?.latestVersion || companionRelease?.release || "";
  const macAppUpdatePromptedFor = useRef("");
  useEffect(() => {
    if (
      hostedSetup ||
      !hasEnteredControlCenter ||
      !macAppUpdateAvailable ||
      !macAppUpdateOfferedVersion ||
      firmwareUpdateInProgress ||
      !isNativeControlCenterApp() ||
      macAppUpdatePromptedFor.current === macAppUpdateOfferedVersion
    ) {
      return;
    }
    macAppUpdatePromptedFor.current = macAppUpdateOfferedVersion;
    window.location.href = "vibetv://check-for-updates";
  }, [
    firmwareUpdateInProgress,
    hasEnteredControlCenter,
    hostedSetup,
    macAppUpdateAvailable,
    macAppUpdateOfferedVersion,
  ]);
  const activeThemeUpdateAvailable = Boolean(
    activeThemeUpgrade.theme &&
      activeThemeUpgrade.needed &&
      !activeThemeUpgrade.unresolved,
  );
  useEffect(() => {
    const theme = pendingUpgrade.theme;
    if (
      hostedSetup ||
      setupPreviewStep ||
      requiresMacAppMigration ||
      (setupThemeChoiceRequired && !setupFinished) ||
      !themeInstallEnabled ||
      companionStatus !== "online" ||
      !deviceIsReady(device) ||
      busyAction ||
      firmwareUpdateInProgress ||
      !theme ||
      themeInstallStatus?.phase === "installing" ||
      (themeInstallStatus?.phase === "error" &&
        themeInstallStatus.themeId === theme.themeId) ||
      !pendingUpgrade.needsThemeSpec ||
      themeNeedsUpgradeableFirmware(theme, device, themeInstallEnabled) ||
      macAppUpdateAvailable ||
      initialThemeId ||
      pendingUpgrade.unresolved
    ) {
      return;
    }

    // Both slots share the guard, so the key carries both installed paths:
    // a live install must not mark the screensaver's own attempt as done.
    const attempt = [
      device?.deviceId,
      device?.display?.themeSpec?.path,
      screensaverPath,
      theme.themeSpecPath,
    ].join("|");
    if (activeThemeUpgradeAttemptRef.current === attempt) {
      return;
    }
    activeThemeUpgradeAttemptRef.current = attempt;
    void installTheme(theme);
  }, [
    busyAction,
    companionStatus,
    device,
    firmwareUpdateInProgress,
    hostedSetup,
    initialThemeId,
    installTheme,
    macAppUpdateAvailable,
    pendingUpgrade,
    requiresMacAppMigration,
    screensaverPath,
    setupFinished,
    setupThemeChoiceRequired,
    setupPreviewStep,
    themeInstallEnabled,
    themeInstallStatus?.phase,
    themeInstallStatus?.themeId,
  ]);
  const macAppMigrationAvailable = Boolean(
    requiresMacAppMigration && availableMacAppDmgDownloadUrl(companionRelease),
  );
  const anyUpdateAvailable =
    firmwareUpdateAvailable ||
    activeThemeUpdateAvailable ||
    macAppUpdateAvailable ||
    macAppMigrationAvailable;
  const deviceConnected = deviceIsCustomerConnected(device);
  const deviceReady = deviceIsReady(device);
  const handleDisplayFrame = useCallback((frame: DisplayFrameSnapshot) => {
    if (hasRenderableUsage(frame)) {
      setHasEnteredControlCenter(true);
    }
  }, []);
  const hasActiveDevice = deviceIsActive(device);
  const displaySessionActive = Boolean(
    deviceConnected ||
      (hasEnteredControlCenter && hasActiveDevice && device?.paired !== false),
  );
  const displayFrame = useLatestDisplayFrame(
    displaySessionActive,
    handleDisplayFrame,
  );
  const themeSetupEntryRequired =
    companionStatus === "online" && deviceNeedsThemeSetup(device);
  const themeSetupSessionMatches =
    deviceCanContinueThemeSetup(device) &&
    deviceMatchesThemeSetupIdentity(themeSetupIdentity, device);
  const themeSetupComplete = deviceCompletedThemeSetup(device);
  const themeSetupRequired =
    companionStatus === "online" &&
    !themeSetupComplete &&
    (themeSetupEntryRequired || themeSetupSessionMatches);
  const startupDeviceCandidates =
    deviceCandidates.length > 0
      ? deviceCandidates
      : connectionRecoveryRequired && device?.target
        ? [
            {
              target: device.target,
              deviceId: device.deviceId,
              board: device.board,
              firmware: device.firmware,
              networkMode: "station",
              known: true,
              active: true,
            } satisfies DeviceCandidate,
          ]
        : [];
  const waitingForFirstUsage =
    hasActiveDevice &&
    device?.connected === true &&
    device.paired !== false &&
    !connectionRecoveryRequired &&
    !hasEnteredControlCenter;
  // A repair takes the Mac App down on purpose, so the incident holds while one
  // runs. But an incident whose Mac App never comes back is a Mac App outage:
  // holding it forever hid the recovery screen behind "AI usage could not start"
  // and offered a CodexBar download that cannot restart a dead runtime.
  // Both busy states belong to one incident. The repair hands straight over to
  // the provider retry, which flips busyAction before the Companion reports
  // online again -- and dropping recovery in that gap put the Mac App recovery
  // screen in front of a repair that had just succeeded.
  const providerRecoveryBusy =
    busyAction === "usage-service-repair" || busyAction === "providers-retry";
  // What the VibeTV reports as `provider_setup_required` is the ordinary state
  // of a Mac whose customer has not picked a provider yet -- nothing is
  // switched on for CodexBar to read. Treating it as a broken usage service
  // sent the automatic recovery after it, and that recovery unregisters the
  // background service for some twenty seconds before it reinstalls the engine
  // (main.swift:3162-3204). The VibeTV then reported "no provider" again and it
  // started over: a Mac left on the provider step tore its own background
  // service down every couple of minutes.
  //
  // Only CodexBar's own verdict on its engine decides now. Reinstalling an
  // engine that reports ready cannot switch a provider on.
  const providerRecoveryRequired =
    (companionStatus === "online" || providerRecoveryBusy) &&
    providerSetupNeedsEngineRecovery(providerSetup);
  // A usage service that cannot answer is not the provider step's private
  // problem: it can fail at any moment, and it used to say so only there.
  const usageFailure = providerRecoveryRequired
    ? setupUsageCauseFor(providerSetup)
    : null;

  // A dismissal covers the incident it was made during, not the next one. A
  // "checking" answer is the probe still running, not the incident ending:
  // the companion reports it during every cache refresh, and treating it as
  // the end re-opened a dismissed dialog every thirty seconds.
  useEffect(() => {
    if (usageFailure || providerSetupIsChecking(providerSetup)) {
      return;
    }
    const timer = window.setTimeout(() => setUsageFailureHidden(false), 0);
    return () => window.clearTimeout(timer);
  }, [providerSetup, usageFailure]);

  useEffect(() => {
    if (!providerRecoveryRequired) {
      // A Mac App that briefly disappears does not end a provider incident, and
      // the native repair takes it down on purpose. Ending the incident on that
      // gap would relaunch the automatic repair instead of showing the approved
      // Try again. A "checking" answer does not end one either -- the companion
      // reports it during every cache refresh, and re-arming on it fired the
      // automatic repair once per probe cycle, tearing the background service
      // down over and over. Only a reachable Mac App whose settled answer no
      // longer needs recovery ends one.
      if (
        companionStatus === "online" &&
        !providerSetupIsChecking(providerSetup)
      ) {
        providerRecoveryAttempted.current = false;
        providerRecoveryManualAttempted.current = false;
      }
      return;
    }
    if (providerRecoveryAttempted.current) {
      return;
    }
    // A theme install job and its worker live inside the Companion process, and
    // the repair unregisters that process on purpose: firing now would delete a
    // running install together with the status the UI is polling for it. The
    // native shutdown hold covers firmware jobs only. Defer rather than skip --
    // the attempt flag stays down, so this runs again on the terminal phase.
    if (themeInstallInProgress) {
      return;
    }
    providerRecoveryAttempted.current = true;
    const timer = window.setTimeout(() => {
      if (isNativeControlCenterApp()) {
        repairUsageService();
      }
    }, 0);
    // Deliberately not cleared on re-run: companionStatus and
    // providerRecoveryRequired change while this incident is open, and clearing
    // the pending timer there dropped the automatic repair for the whole
    // incident. providerRecoveryAttempted already prevents a second one.
    void timer;
  }, [
    companionStatus,
    providerRecoveryRequired,
    providerSetup,
    repairUsageService,
    themeInstallInProgress,
  ]);

  const startupDeviceSearchState: DeviceSearchState = waitingForFirstUsage
    ? "waiting"
    : connectionRecoveryRequired && startupDeviceCandidates.length > 0
      ? "multiple"
      : deviceSearchState;
  const recoveryPickerOpen = deviceRecoveryPickerReason !== null;

  const setupComplete = Boolean(
    !setupPreviewStep &&
    companionStatus === "online" &&
    deviceReady &&
    providerSelectionSetup?.providerSelectionComplete &&
    hasEnteredControlCenter,
  );
  const providerPickerProps = {
    display: providerDisplay,
    displayError: providerDisplayError,
    displayPendingProviderId: pendingProviderDisplayId,
    items: providerPreferences,
    preferencesError: providerPreferencesError,
    pendingCheckIds: pendingProviderCheckIds,
    pendingPreferenceIds,
    onCheck: checkProvider,
    onDisplayChange: updateProviderDisplay,
    onPreferenceChange: updateProviderPreference,
  };
  // The usage-service recovery unregisters the background service on purpose
  // and re-registers it some twenty seconds later. That is this page's own
  // request, so reporting it as an outage announced our own work as a fault.
  const needsRuntimeRecovery =
    companionStatus === "missing" && !providerRecoveryBusy;

  const controlCenterAvailable =
    hasActiveDevice && !connectionRecoveryRequired && !recoveryPickerOpen;
  const disabledTabs: ActiveTab[] = hasEnteredControlCenter
    ? []
    : ["overview", "usage", "settings", "theme-library", "updates", "logs"];
  const activeShellTab = disabledTabs.includes(activeTab)
    ? "overview"
    : activeTab;

  const clearRuntimeRepairTimeout = useCallback(() => {
    if (runtimeRepairTimeout.current !== null) {
      window.clearTimeout(runtimeRepairTimeout.current);
      runtimeRepairTimeout.current = null;
    }
  }, []);

  const requestRuntimeRepair = useCallback(() => {
    clearRuntimeRepairTimeout();
    setRuntimeRecoveryPhase("repairing");
    if (!isNativeControlCenterApp()) {
      void checkCompanion({ quiet: true }).finally(() => {
        setRuntimeRecoveryPhase("failed");
      });
      return;
    }
    runtimeRepairAttempted.current = true;
    repairLocalControlCenterRuntime();
    runtimeRepairTimeout.current = window.setTimeout(() => {
      runtimeRepairTimeout.current = null;
      setRuntimeRecoveryPhase("failed");
    }, NATIVE_RUNTIME_REPAIR_TIMEOUT_MS);
  }, [checkCompanion, clearRuntimeRepairTimeout]);

  useEffect(() => {
    if (!needsRuntimeRecovery) {
      clearRuntimeRepairTimeout();
      runtimeRepairAttempted.current = false;
      const resetTimer = window.setTimeout(() => {
        setRuntimeRecoveryPhase(null);
        setRuntimeRecoveryHidden(false);
      }, 0);
      return () => window.clearTimeout(resetTimer);
    }
    if (runtimeRepairAttempted.current) {
      return;
    }
    // A service that never answered has no restart coming: repairing it is the
    // only way forward and the customer is told at once. One that disappeared
    // mid-session gets the grace first, and hears nothing until it is over.
    const timer = window.setTimeout(
      requestRuntimeRepair,
      companionEverOnline.current ? LAUNCHD_RECOVERY_GRACE_MS : 0,
    );
    return () => window.clearTimeout(timer);
  }, [clearRuntimeRepairTimeout, needsRuntimeRecovery, requestRuntimeRepair]);

  useEffect(() => {
    const handleRuntimeRepairResult = (event: Event) => {
      const detail = (event as CustomEvent<{ success?: boolean }>).detail;
      clearRuntimeRepairTimeout();
      if (detail?.success) {
        void checkCompanion({ quiet: true });
        return;
      }
      setRuntimeRecoveryPhase("failed");
    };
    window.addEventListener(
      NATIVE_RUNTIME_REPAIR_RESULT_EVENT,
      handleRuntimeRepairResult,
    );
    return () => {
      window.removeEventListener(
        NATIVE_RUNTIME_REPAIR_RESULT_EVENT,
        handleRuntimeRepairResult,
      );
      clearRuntimeRepairTimeout();
    };
  }, [checkCompanion, clearRuntimeRepairTimeout]);

  useEffect(() => {
    if (
      hostedSetup ||
      setupPreviewStep ||
      companionStatus !== "online" ||
      !controlCenterAvailable
    ) {
      return;
    }

    const refreshStatus = () => {
      if (
        document.visibilityState === "hidden" ||
        (busyAction && busyAction !== "firmware-update")
      ) {
        return;
      }
      void syncLocalStatus();
    };

    const initialTimer = window.setTimeout(refreshStatus, 0);
    const timer = window.setInterval(refreshStatus, 5000);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [
    activeShellTab,
    busyAction,
    companionStatus,
    controlCenterAvailable,
    hostedSetup,
    setupPreviewStep,
    syncLocalStatus,
  ]);

  useEffect(() => {
    if (
      (activeShellTab !== "usage" && activeShellTab !== "overview") ||
      companionStatus !== "online" ||
      !controlCenterAvailable
    ) {
      return;
    }

    return startUsageSurfacePolling({
      refreshUsage: () => refreshUsage({ quiet: true }),
      refreshProviderHealth: () =>
        refreshProviderPreferences({ quiet: true }),
    });
  }, [
    activeShellTab,
    companionStatus,
    controlCenterAvailable,
    refreshProviderPreferences,
    refreshUsage,
  ]);

  // Settings and the provider step show the display selection; setup also has
  // to read it, because it cannot tell whether one exists — or whether this
  // companion can keep one at all — without asking.
  const providerDisplayWanted =
    companionStatus === "online" &&
    (activeShellTab === "settings" ||
      providerSelectionSetup?.providerSelectionRequired === true ||
      !(setupFinished || setupComplete));
  const providerPreferencesPollingWanted = providerPreferencesNeedPolling(
    providerDisplayWanted,
    providerPreferences,
  );

  useEffect(() => {
    if (!providerPreferencesPollingWanted) {
      return;
    }
    return startProviderPreferencesPolling({
      refresh: () => refreshProviderPreferences({ quiet: true }),
    });
  }, [providerPreferencesPollingWanted, refreshProviderPreferences]);

  useEffect(() => {
    if (!providerDisplayWanted) {
      return;
    }
    const timer = window.setTimeout(() => {
      void Promise.all([
        refreshProviderPreferences({ quiet: true }),
        refreshProviderDisplay({ quiet: true }),
      ]);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    activeShellTab,
    companionStatus,
    providerSelectionSetup?.providerSelectionRequired,
    refreshProviderDisplay,
    refreshProviderPreferences,
  ]);

  const setupDeviceSummary = deviceReady
    ? `VibeTV ${device?.deviceId || ""} on ${device?.target || "an unknown address"}`.trim()
    : deviceSearchState === "not-found"
      ? "not found on this WiFi"
      : "not connected yet";

  // The log reads as an order of events, not as a set of statuses: everything
  // above the newest line is dimmed, and the newest one carries the caret.
  // Tying the dimming to whether each step had finished made three lines flip
  // back and forth while the customer watched, for no information they could
  // act on.
  const setupWelcomeLines = [
    { id: "service", text: "starting background service" },
    { id: "usage", text: "reading provider usage on this Mac" },
    { id: "wifi", text: "scanning your WiFi" },
    { id: "device", text: "looking for your VibeTV" },
  ].map((line, index, lines) => ({
    ...line,
    tone: index < lines.length - 1 ? ("done" as const) : undefined,
  }));

  // ---- Setup wizard -------------------------------------------------------
  // Once the customer is inside, a device that is only reconnecting stays
  // theirs. Handing the screen back to setup for it would drop them out of
  // whatever they were doing over a missed poll.
  // Deliberately not setupComplete: that needs a field an older companion
  // never reports, so the guard would not exist on exactly the Macs that have
  // one.
  // A VibeTV whose only problem is that no provider is set up yet reports
  // ready:false -- readiness needs a rendered usage frame, and there is no
  // usage to render. Without the middle term the wizard parks a brand-new
  // customer on the device step and never offers the provider step that is the
  // only way to fix it. Narrowed to the case that step actually answers:
  // letting a device through once the provider selection is already done would
  // carry someone whose provider just died to the live step and tell them
  // their VibeTV is running.
  const providerSelectionRequired =
    !providerSetupCompletedThisSession &&
    providerSelectionSetup?.providerSelectionRequired === true;
  // The Companion already owns the long-running scan. The provider setup
  // summary can become ready before the separate preferences inventory has
  // answered, so the inventory itself is the loading boundary. Waiting for
  // both kept a connected customer on the completed firmware log while the
  // scan was still running out of sight.
  const providersLoading = setupProviderInventoryIsLoading(
    providerSelectionRequired,
    providerPreferences,
    providerPreferencesError,
  );
  const deviceUsableForSetup = setupDeviceIsUsable({
    deviceConnected,
    connectionRecoveryRequired,
    hasActiveDevice,
    hasEnteredControlCenter,
    providerSelectionRequired,
    providerSetupCompletedThisSession,
    ready: deviceReady,
  });

  const setupLiveHandoverActive =
    providerSetupCompletedThisSession ||
    setupThemeInstallRequested;
  const setupStep = deriveSetupStep({
    deviceUsable: deviceUsableForSetup,
    displayConfigured: setupDisplayIsConfigured(providerDisplay),
    displaySelectionSupported: setupDisplaySelectionSupported(
      providerDisplay,
      providerDisplayError,
    ),
    initialCheckComplete: initialCompanionCheckComplete,
    providerSelectionRequired,
    // Everything before there is a VibeTV to choose belongs to the welcome
    // step: the background service coming up, and the search itself.
    //
    // The service restarts several times on a fresh install -- it installs its
    // own usage engine -- and a search running into one of those restarts comes
    // back empty. Treating that as an answer is what put a customer on
    // "0 VibeTVs found on your WiFi." with a dead Connect while the service was
    // still starting, and let them press it. A service that is genuinely gone
    // is not hidden by this: its recovery dialog is drawn over whatever step is
    // on screen.
    searchingForDevice:
      startupDeviceCandidates.length === 0 &&
      (companionStatus !== "online" ||
        startupDeviceSearchState === "idle" ||
        startupDeviceSearchState === "searching"),
    themeSetupRequired:
      themeSetupRequired ||
      (setupLiveHandoverActive && !hasRenderableUsage(displayFrame)) ||
      (setupThemeChoiceRequired &&
        !(
          setupThemeInstallRequested &&
          themeInstallStatus?.phase === "complete" &&
          Boolean(selectedThemeId) &&
          themeInstallStatus.themeId === selectedThemeId &&
          themeInstallStatus.result?.themeId === selectedThemeId
        )),
  });
  const setupOwnsScreen =
    !(setupThemeChoiceRequired && !deviceConnected) &&
    (setupStep !== "live" ||
      !(
        setupFinished ||
        (!setupLiveHandoverActive &&
          (setupComplete || hasEnteredControlCenter))
      ));

  const setupProviders = (providerPreferences || []).filter(isProviderItem);
  // The display step may only offer providers that can actually show something.
  // Filtering on "switched on" alone let a broken provider into the rotation
  // and into the Manual list, where pinning to it produced a blank device.
  const displayableProviders = setupProviders.filter(setupProviderCanDisplay);
  const enabledProviderIds = displayableProviders
    .map((item) => item.providerId)
    .filter((id): id is string => Boolean(id));
  const setupPreviews = displayPreviewsFor(
    usage,
    displayableProviders.map((item) => ({
      id: item.providerId,
      label: item.label,
    })),
  );
  // Step 05 keeps offering all four live themes: hiding one would make the
  // device's limitation invisible. The Install is gated by the same rules the
  // theme library uses, so setup cannot promise what the device would refuse.
  const setupThemes = catalog.themes
    .filter((theme) => (theme.usage || "live") === "live")
    .map((theme) => ({
      id: theme.themeId,
      name: theme.title,
      themeSpecPath: theme.themeSpecPath,
      blockedReason:
        buildThemeInstallBlocker({
          // Inside the wizard the device is connected and paired, but `ready`
          // can still be false while the first frame is pending. Refusing on
          // that would deadlock the step.
          allowUnreadyInstall: true,
          device,
          theme,
          themeInstallBlockedReason: "",
          themeInstallEnabled,
        })?.reason ?? null,
    }));

  const setupConnectSteps: SetupConnectSteps = {
    checkFirmware: async (connected) => {
      const update = await refreshFirmwareUpdate({
        board: connected.board,
        firmware: connected.firmware,
      });
      // A check that could not be made is not a check that found nothing. Both
      // resolve rather than reject, and treating them as "up to date" told the
      // customer their firmware was current while it was simply unknown.
      if (!update || update.status === "check_failed") {
        throw {
          code: "firmware_check_failed",
          message: "Could not check VibeTV's firmware.",
          nextAction: "Check the internet connection, then try again.",
        };
      }
      return hasFirmwareUpdate(update) && update?.latestFirmware
        ? {
            from: update.installedFirmware || connected.firmware || "",
            to: update.latestFirmware,
          }
        : null;
    },
    connect: async (candidate) => {
      const error = await selectAndConnectDevice(candidate);
      if (error) {
        throw error;
      }
      setSetupThemeChoiceRequired(true);
      // Read the device back rather than trusting this render's copy, which
      // still describes whatever was connected before this one.
      const connected = await refreshDevice({ quiet: true });
      return { board: connected?.board, firmware: connected?.firmware };
    },
    installFirmware: async () => {
      lastFirmwareErrorRef.current = null;
      if (!(await installFirmwareUpdate())) {
        throw (
          lastFirmwareErrorRef.current ?? {
            code: "firmware_update_failed",
            message: "Firmware update did not finish.",
            nextAction:
              "Unplug VibeTV from power, plug it back in, then try again.",
          }
        );
      }
    },
  };

  // setupLog is what the failing screen is showing; the wizard owns it and
  // passes it in. Optional so the pre-hydration welcome paint, which has no
  // wizard behind it yet, can still offer the same Help control.
  const setupAiFixPrompt = (setupLog: string[] = []) =>
    buildAiFixPrompt({
      appBuild: companionInfo?.app?.build,
      appVersion: companionInfo?.app?.version,
      companionCommit: companionInfo?.runtime?.commit,
      companionVersion: companionInfo?.version,
      deviceSummary: setupDeviceSummary,
      events,
      lastError,
      osVersion: supportDiagnostics?.environment?.os,
      providers: setupProviders.map((item) => ({
        id: item.providerId || item.id,
        message: item.health?.message,
        state: item.health?.state,
      })),
      screen: setupStep,
      setupLog,
    });

  // The background service can die at any point, so its recovery is drawn
  // over whatever is on screen rather than replacing it. Everything else is
  // one screen at a time.
  function renderScreen() {
    // The first paint is the wizard's own welcome step, not a second loading
    // screen that happens to look like it. The native window shows the same
    // brand and the same running log until the WebView takes over, so the
    // customer sees one screen from launch, not a handover between two.
    if (runtimeSurface === "unknown") {
      return (
        <SetupWelcomeScreen
          aiFixPrompt={setupAiFixPrompt}
          lines={setupWelcomeLines}
          onCreateSupportReport={loadSupportDiagnostics}
        />
      );
    }

    if (runtimeSurface === "hosted-setup") {
      return (
        <MacAppDownloadScreen
          onCreateSupportReport={loadSupportDiagnostics}
          release={companionRelease}
        />
      );
    }

    if (setupOwnsScreen) {
      return (
        <SetupWizard
          aiFixPrompt={setupAiFixPrompt}
          usageFailure={usageFailureHidden ? null : usageFailure}
          onRepairUsageService={retryUsageService}
          onDismissUsageFailure={() => setUsageFailureHidden(true)}
          automaticPreviews={setupPreviews}
          connectSteps={setupConnectSteps}
          device={device}
          deviceCandidates={startupDeviceCandidates}
          deviceSearchState={startupDeviceSearchState}
          displayFrame={displayFrame}
          displayMode={providerDisplay?.mode ?? "automatic"}
          displayProviderId={providerDisplay?.providerIds?.[0] ?? null}
          firmwareProgress={firmwareUpdateStatus?.progress}
          displayProviders={displayableProviders.map((item) => ({
            id: item.providerId,
            label: item.label,
          }))}
          installingTheme={themeInstallStatus?.phase === "installing"}
          onFindManualTarget={findManualTarget}
          onCreateSupportReport={loadSupportDiagnostics}
          onFinished={finishSetup}
          onDisplayContinue={(selection) =>
            updateProviderDisplay(
              selection,
              selection.providerIds[0] ?? enabledProviderIds[0] ?? "",
            )
          }
          onInstallTheme={() => {
            setSetupThemeInstallRequested(true);
            void installTheme();
          }}
          onProviderCheck={(provider) => void checkProvider(provider)}
          onProviderToggle={(provider, enabled) =>
            void updateProviderPreference(provider, enabled)
          }
          onProvidersContinue={completeProviderSetup}
          pendingCheckIds={pendingProviderCheckIds}
          pendingPreferenceIds={pendingPreferenceIds}
          providersLoading={providersLoading}
          onDismissProviderError={() => {
            setProviderDisplayError(null);
            setProviderPreferencesError(null);
          }}
          onRetryProviders={() => {
            void refreshProviderPreferences();
            void refreshProviderDisplay();
          }}
          searchError={
            startupDeviceSearchState === "failed" && !needsRuntimeRecovery
              ? lastError
              : null
          }
          providerError={providerDisplayError || providerPreferencesError}
          onSearchDevices={() => void searchAndConnect()}
          onUpdateMacApp={checkForMacAppUpdate}
          displaySavePending={pendingProviderDisplayId !== null}
          onSelectTheme={(theme) => setSelectedThemeId(theme.id)}
          providers={setupProviders}
          selectedThemeId={selectedThemeId}
          step={setupStep}
          themeInstallLogs={themeInstallStatus?.logs || []}
          themes={setupThemes}
          usage={usage}
          welcomeLines={setupWelcomeLines}
        />
      );
    }

    return (
      <ControlCenterShell
        activeTab={activeShellTab}
        activeAppearanceSection={appearanceSection}
        disabledTabs={disabledTabs}
        device={device}
        updateAvailable={anyUpdateAvailable}
        onAppearanceSectionChange={setAppearanceSection}
        onTabChange={(tab) => {
          if (disabledTabs.includes(tab)) {
            return;
          }
          setActiveTab(tab);
        }}
      >
        {activeShellTab === "overview" ? (
          <OverviewScreen
            companionVersion={companionInfo?.version}
            companionStatus={companionStatus}
            device={device}
            displayFrame={displayFrame}
            firmwareUpdateStatus={firmwareUpdateStatus}
            usage={usage}
          />
        ) : null}

        {activeShellTab === "usage" ? (
          <UsageScreen
            busyAction={busyAction}
            companionStatus={companionStatus}
            onRefresh={() => refreshUsage()}
            usage={usage}
            usageError={usageError}
          />
        ) : null}

        {activeShellTab === "settings" ? (
          <SettingsScreen
            automaticPreviews={setupPreviews}
            brightness={brightness}
            busyAction={firmwareUpdateInProgress ? "firmware-update" : busyAction}
            device={device}
            standby={standby}
            onBrightnessChange={changeBrightness}
            onChooseScreensaver={() => {
              setAppearanceSection("screensavers");
              setActiveTab("theme-library");
            }}
            onResetSetup={resetSetup}
            onSaveBrightness={saveBrightness}
            providerPicker={providerPickerProps}
            onSaveStandby={saveStandby}
            onStandbyBrightnessChange={changeStandbyBrightness}
          />
        ) : null}

        {activeShellTab === "theme-library" ? (
          <ThemeLibraryScreen
            busyAction={firmwareUpdateInProgress ? "firmware-update" : busyAction}
            companionStatus={companionStatus}
            device={device}
            installStatus={themeInstallStatus}
            catalogIssue={catalog.issue}
            lastInstall={lastInstall}
            onInstallCustomTheme={installCustomTheme}
            onInstallTheme={installTheme}
            onSelectTheme={
              appearanceSection === "screensavers"
                ? setSelectedScreensaverId
                : setSelectedThemeId
            }
            installEntry={
              appearanceSection === "themes" && Boolean(initialThemeId)
            }
            requestedThemeId={
              appearanceSection === "themes" ? initialThemeId : undefined
            }
            selectedTheme={
              appearanceSection === "screensavers"
                ? selectedScreensaver
                : selectedTheme
            }
            selectedThemeId={
              appearanceSection === "screensavers"
                ? selectedScreensaverId
                : selectedThemeId
            }
            standby={standby}
            storefrontConfigured={catalog.storefrontConfigured}
            themeInstallEnabled={themeInstallEnabled}
            themes={catalog.themes}
            usage={appearanceSection === "screensavers" ? "screensaver" : "live"}
            onSaveStandby={saveStandby}
          />
        ) : null}

        {activeShellTab === "updates" ? (
          <UpdatesScreen
            busyAction={busyAction}
            companionRelease={companionRelease}
            companionStatus={companionStatus}
            companionVersion={companionInfo?.version}
            companionInfo={companionInfo}
            device={device}
            firmwareUpdate={effectiveFirmwareUpdate}
            onCheckUpdates={checkUpdates}
            onCreateReport={() => {
              setActiveTab("logs");
              void loadSupportDiagnostics();
            }}
            onInstallUpdate={installFirmwareUpdate}
            onRetryThemeUpdate={retryActiveThemeUpgrade}
            requiresMacAppMigration={requiresMacAppMigration}
            supportReportBusy={supportReportBusy}
            themeUpdateAvailable={activeThemeUpdateAvailable}
            updateStatus={firmwareUpdateStatus}
          />
        ) : null}

        {activeShellTab === "logs" ? (
          <LogsScreen
            busyAction={busyAction}
            device={device}
            diagnostics={supportDiagnostics}
            events={logs}
            lastError={lastError}
            onLoadDiagnostics={loadSupportDiagnostics}
            onRefresh={checkCompanion}
            onRunSetupAgain={resetSetup}
            supportReportBusy={supportReportBusy}
          />
        ) : null}
      </ControlCenterShell>
    );
  }

  return (
    <>
      {renderScreen()}
      <SetupRecoveryDialogs
        onHide={() => setRuntimeRecoveryHidden(true)}
        onRestart={restartLocalControlCenterApp}
        onRetry={requestRuntimeRepair}
        phase={
          needsRuntimeRecovery && !runtimeRecoveryHidden
            ? runtimeRecoveryPhase
            : null
        }
        retrying={busyAction === "runtime-repair"}
      />
      {/*
        Every one of these is centred, so a second one lands on top of the
        first: two stacked cards, the lower one's buttons unreachable behind
        the upper one. That is what a customer met after pressing Connect on a
        fresh Mac -- the firmware check failed over "Finish AI setup on this
        Mac", and neither could be answered.

        The runtime repair wins over this one: it is what took the Mac App down.
        And the whole of setup wins over it too. Every failure inside the wizard
        is already a dialog over the step that caused it, and the provider step
        is where a usage problem is dealt with -- so this ambient surface has
        nothing to add there and is still waiting once setup is done.
      */}
      {usageFailure &&
      !usageFailureHidden &&
      !needsRuntimeRecovery &&
      !setupOwnsScreen ? (
        <SetupUsageDialog
          cause={usageFailure}
          onCreateSupportReport={() => void loadSupportDiagnostics()}
          onOpenChange={(open) => setUsageFailureHidden(!open)}
          onRepair={retryUsageService}
          open
        />
      ) : null}
    </>
  );
}

function getRuntimeSurfaceSnapshot(): RuntimeSurface {
  return shouldUseHostedSetupShell() ? "hosted-setup" : "local-control-center";
}

function getRuntimeSurfaceServerSnapshot(): RuntimeSurface {
  return "unknown";
}

function usageRefreshEvent(payload: UsageSnapshot): {
  label: string;
  detail: string;
  tone: "ready" | "attention";
} {
  switch (payload.refresh?.state) {
    case "refreshing":
      return {
        label: "Usage refresh started",
        detail: "VibeTV is waiting for a new usage snapshot.",
        tone: "attention",
      };
    case "unavailable":
      return {
        label: "Usage is still loading",
        detail: "VibeTV will update automatically when usage is ready.",
        tone: "attention",
      };
    default:
      return {
        label: "Usage refreshed",
        detail: `${payload.providers?.length || 0} provider tiles loaded.`,
        tone: payload.providers?.length ? "ready" : "attention",
      };
  }
}

function subscribeRuntimeSurface(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  const timer = window.setTimeout(onStoreChange, 0);
  return () => window.clearTimeout(timer);
}

function localControlCenterPathForTheme(themeId: string | undefined): string {
  const cleanThemeId = themeId?.trim();
  if (!cleanThemeId) {
    return "/control-center";
  }
  return `/control-center/install/${encodeURIComponent(cleanThemeId)}`;
}

function normalizeError(error: unknown, status: number): ApiError {
  if (error && typeof error === "object") {
    const maybeError = error as Partial<ApiError>;
    return {
      code: maybeError.code || `HTTP_${status}`,
      message: maybeError.message || "Request failed.",
      nextAction: maybeError.nextAction || "Try again.",
    };
  }
  return {
    code: `HTTP_${status}`,
    message: "Request failed.",
    nextAction: "Try again.",
  };
}

async function pollThemeInstallJob({
  applyInstallJob,
  jobId,
  runCompanion,
}: {
  applyInstallJob: (job: ThemeInstallJob) => void;
  jobId: string;
  runCompanion: RunCompanion;
}): Promise<ThemeInstallJob> {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    await delay(500);
    const payload = await runCompanion<{ job: ThemeInstallJob }>(
      `/v1/themes/install/status?jobId=${encodeURIComponent(jobId)}`,
      undefined,
      { preserveLastError: true },
    );
    applyInstallJob(payload.job);
    if (payload.job.phase === "complete" || payload.job.phase === "error") {
      return payload.job;
    }
  }
  throw {
    code: "theme_install_timeout",
    message: "Theme install is taking longer than expected.",
    nextAction: "Keep VibeTV powered on, then check the theme again.",
  } satisfies ApiError;
}

async function pollFirmwareUpdateJob({
  applyUpdateJob,
  jobId,
  runCompanion,
}: {
  applyUpdateJob: (job: FirmwareUpdateJob) => void;
  jobId: string;
  runCompanion: RunCompanion;
}): Promise<FirmwareUpdateJob> {
  for (let attempt = 0; attempt < 1200; attempt += 1) {
    await delay(500);
    const payload = await runCompanion<{ job: FirmwareUpdateJob }>(
      `/v1/updates/install/status?jobId=${encodeURIComponent(jobId)}`,
      undefined,
      { preserveLastError: true },
    );
    applyUpdateJob(payload.job);
    if (payload.job.phase === "complete" || payload.job.phase === "error") {
      return payload.job;
    }
  }
  throw {
    code: "firmware_update_timeout",
    message: "VibeTV update is taking longer than expected.",
    nextAction: "Keep VibeTV powered on, then create a support report.",
  } satisfies ApiError;
}

function themeInstallStatusFromJob(
  job: ThemeInstallJob,
  themes: ThemeProduct[],
  fallback: { startedAt?: string; themeId?: string; title?: string } = {},
): ThemeInstallStatus {
  const phase =
    job.phase === "complete"
      ? "complete"
      : job.phase === "error"
        ? "error"
        : "installing";
  const themeId = job.result?.themeId || job.themeId || fallback.themeId || "";
  const catalogTitle = themes.find((theme) => theme.themeId === themeId)?.title;
  const title =
    job.result?.name ||
    job.themeName ||
    fallback.title ||
    catalogTitle ||
    themeId ||
    "Theme";
  const logs = customerInstallLogs(job.logs);
  const finished = phase === "complete" || phase === "error";
  return {
    phase,
    themeId,
    title,
    startedAt: job.startedAt || fallback.startedAt || formatTime(),
    finishedAt: finished ? job.finishedAt || formatTime() : undefined,
    message:
      job.error?.nextAction ||
      job.message ||
      logs[logs.length - 1] ||
      "Preparing theme install.",
    progress: clampProgress(job.progress),
    logs,
    result: job.result,
    error: job.error ? themeInstallErrorText(job.error) : undefined,
  };
}

function firmwareUpdateStatusFromJob(
  job: FirmwareUpdateJob,
  fallbackStartedAt = formatTime(),
): FirmwareUpdateStatus {
  const phase =
    job.phase === "complete"
      ? "complete"
      : job.phase === "attention"
        ? "attention"
        : job.phase === "error"
          ? "error"
          : "installing";
  const logs = customerUpdateLogs(job.logs);
  const finished =
    phase === "complete" || phase === "attention" || phase === "error";
  return {
    phase,
    stage: job.stage,
    outcome: job.outcome,
    retryAllowed: job.retryPolicy !== "power_cycle",
    startedAt: job.startedAt || fallbackStartedAt,
    finishedAt: finished ? job.finishedAt || formatTime() : undefined,
    message:
      job.error?.nextAction ||
      job.message ||
      logs[logs.length - 1] ||
      "Preparing VibeTV update.",
    progress: clampProgress(job.progress),
    logs,
    result: job.result,
    error: job.error?.nextAction,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function currentFirmwareUpdate(firmware: string): FirmwareUpdateInfo {
  return {
    checkedAt: new Date().toISOString(),
    installedFirmware: firmware,
    latestFirmware: firmware,
    updateAvailable: false,
    status: "current",
    message: "Firmware is up to date.",
  };
}

function customerInstallLogs(
  logs: string[] | undefined,
  fallback: string[] = ["Preparing theme install."],
): string[] {
  const cleaned = (logs || [])
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line, index, all) => all.indexOf(line) === index);
  return cleaned.length > 0 ? cleaned : fallback;
}

function themeInstallErrorText(error: ApiError): string {
  const message = error.message?.trim();
  const nextAction = error.nextAction?.trim();
  if (!message) {
    return nextAction || "Theme install failed. Try again.";
  }
  if (!nextAction || nextAction === message) {
    return message;
  }
  return `${message} ${nextAction}`;
}

function customerUpdateLogs(
  logs: string[] | undefined,
  fallback: string[] = ["Preparing VibeTV update."],
): string[] {
  const cleaned = (logs || [])
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line, index, all) => all.indexOf(line) === index);
  return cleaned.length > 0 ? cleaned : fallback;
}

function clampProgress(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 5;
  }
  return Math.max(5, Math.min(100, Math.round(value)));
}

function normalizeCaughtError(
  error: unknown,
  fallbackMessage: string,
): ApiError {
  if (error && typeof error === "object" && "code" in error) {
    return error as ApiError;
  }
  if (error instanceof Error) {
    if (isCompanionConnectionError(error)) {
      return companionUnavailableError();
    }
    return {
      code: "CLIENT_ERROR",
      message: fallbackMessage,
      nextAction: error.message,
    };
  }
  return {
    code: "CLIENT_ERROR",
    message: fallbackMessage,
    nextAction: "Run setup again, then connect VibeTV.",
  };
}

function connectionErrorForCustomer(error: ApiError): ApiError {
  if (error.code === "legacy_pairing_recovery_required") {
    return error;
  }
  if (
    error.code === "pairing_token_rejected" ||
    error.code === "pairing_window_closed"
  ) {
    return {
      code: "connect_failed",
      message: "VibeTV could not connect.",
      nextAction: "Press Connect again. If it still fails, create a report.",
    };
  }
  if (error.code === "pairing_rate_limited") {
    return {
      code: "connect_temporarily_unavailable",
      message: "VibeTV is temporarily unavailable.",
      nextAction: "Wait one minute, then press Connect again.",
    };
  }
  return error;
}

function pairingRejectionForDevice(
  device: DeviceInfo | null | undefined,
): ApiError | null {
  if (
    device?.active !== true ||
    device.stream?.errorCode !== "pairing_token_rejected"
  ) {
    return null;
  }
  if (device.firmware === "1.0.38") {
    return {
      code: "legacy_pairing_recovery_required",
      message: "This VibeTV uses an older recovery method.",
      nextAction:
        "Follow the recovery steps in Control Center, then press Connect.",
    };
  }
  return connectionErrorForCustomer({
    code: "pairing_token_rejected",
    message: "VibeTV could not connect.",
    nextAction: "Press Connect again.",
  });
}

function isConnectionRecoveryError(error?: ApiError | null): boolean {
  return (
    error?.code === "legacy_pairing_recovery_required" ||
    error?.code === "connect_failed" ||
    error?.code === "connect_temporarily_unavailable" ||
    error?.code === "pairing_window_closed" ||
    error?.code === "pairing_token_rejected" ||
    error?.code === "pairing_rate_limited"
  );
}

function normalizeUsageError(error: ApiError): ApiError {
  if (error.code === "HTTP_404") {
    return {
      code: "MAC_APP_UPDATE_REQUIRED",
      message: "Mac App update needed.",
      nextAction: "Run setup again, then refresh usage.",
    };
  }
  return error;
}

function localControlCenterUnavailableError(): ApiError {
  return {
    code: "LOCAL_CONTROL_CENTER_UNAVAILABLE",
    message: "Mac App update needed.",
    nextAction:
      "Update the Mac App or run setup again, then open Control Center.",
  };
}

async function normalizeLocalControlCenterError(
  error: unknown,
): Promise<ApiError> {
  if (error && typeof error === "object" && "code" in error) {
    return error as ApiError;
  }
  if (error instanceof Error && isCompanionConnectionError(error)) {
    const accessState = await readLocalNetworkAccessState();
    if (localNetworkAccessNeedsUserAction(accessState)) {
      return localNetworkAccessError(accessState);
    }
    return companionUnavailableError();
  }
  return localControlCenterUnavailableError();
}

function companionUnavailableError(): ApiError {
  return {
    code: "COMPANION_UNREACHABLE",
    message: "Mac App did not answer.",
    nextAction:
      "Quit VibeTV Control Center, then open it again from Applications. If it still does not answer, replace it with the latest Mac App from app.vibetv.shop.",
  };
}

function isCompanionConnectionError(error: Error): boolean {
  return /failed to fetch|fetch failed|load failed|networkerror|connection refused|err_connection_refused|couldn'?t connect/i.test(
    error.message,
  );
}

function isLocalCompanionFetchFailureReason(reason: unknown): boolean {
  if (reason instanceof Error) {
    return isCompanionConnectionError(reason);
  }
  return /failed to fetch|fetch failed|load failed|networkerror|connection refused|err_connection_refused|couldn'?t connect/i.test(
    String(reason),
  );
}

function isCompanionMissingError(error: ApiError): boolean {
  return error.code === "COMPANION_UNREACHABLE";
}

function isLocalNetworkAccessError(error?: ApiError | null): boolean {
  return error?.code === "LOCAL_NETWORK_ACCESS_REQUIRED";
}

function localNetworkAccessNeedsUserAction(
  state: PermissionState | "unsupported",
): boolean {
  return state === "prompt" || state === "denied";
}

function localNetworkAccessError(
  state: PermissionState | "unsupported",
): ApiError {
  if (state === "denied") {
    return {
      code: "LOCAL_NETWORK_ACCESS_REQUIRED",
      message: "Local Control Center is blocked.",
      nextAction: "Open the local Control Center again, then retry.",
    };
  }
  return {
    code: "LOCAL_NETWORK_ACCESS_REQUIRED",
    message: "Local Control Center could not be reached.",
    nextAction: "Open the local Control Center again, then retry.",
  };
}

async function readLocalNetworkAccessState(): Promise<
  PermissionState | "unsupported"
> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) {
    return "unsupported";
  }
  const permissionNames = ["loopback-network", "local-network-access"];
  for (const name of permissionNames) {
    try {
      const status = await navigator.permissions.query({
        name: name as unknown as PermissionName,
      });
      return status.state;
    } catch {
      // Chrome versions disagree on the permission name. Try the next one.
    }
  }
  return "unsupported";
}

export function mergeDeviceInfo(
  current: DeviceInfo | null,
  next: DeviceInfo,
): DeviceInfo {
  if (!current) {
    return next;
  }

  const currentTarget = normalizeDeviceTarget(current.target || "");
  const nextTarget = normalizeDeviceTarget(next.target || "");
  if (currentTarget && nextTarget && currentTarget !== nextTarget) {
    return next;
  }

  return {
    ...current,
    ...next,
    active: next.active ?? current.active,
    board: next.board ?? current.board,
    firmware: next.firmware ?? current.firmware,
    activeTheme: next.activeTheme ?? current.activeTheme,
    capabilities: mergeDeviceCapabilities(
      current.capabilities,
      next.capabilities,
    ),
    display: mergeDeviceDisplay(current.display, next.display),
    health: next.health ?? current.health,
    stream: mergeDeviceStream(current.stream, next.stream),
  };
}

// A stream that is restarting reports no error for a moment. Reading that quiet
// sample as "the incident is over" ended recovery mid-repair, dropped the
// customer into Overview, and opened a fresh incident three seconds later when
// the error came back. An incident ends on evidence that the device draws
// again — a healthy stream or a different error — never on one sample that
// simply says nothing.
function mergeDeviceStream(
  current: DeviceInfo["stream"],
  next: DeviceInfo["stream"],
): DeviceInfo["stream"] {
  if (!next) {
    return current;
  }
  if (
    current?.errorCode === "provider_setup_required" &&
    !next.errorCode &&
    !next.healthy
  ) {
    return { ...next, errorCode: current.errorCode };
  }
  return next;
}

function deviceIsConfigured(device: DeviceInfo | null | undefined): boolean {
  return Boolean(device?.deviceId || (device?.target && device.paired));
}

function readThemeSetupIdentity(
  device: DeviceInfo | null | undefined,
): ThemeSetupDeviceIdentity {
  return {
    deviceId: device?.deviceId?.trim() || "",
    target: normalizeDeviceTarget(device?.target || ""),
  };
}

function deviceMatchesThemeSetupIdentity(
  identity: ThemeSetupDeviceIdentity | null,
  device: DeviceInfo | null | undefined,
): boolean {
  if (!identity || !device) {
    return false;
  }
  const candidate = readThemeSetupIdentity(device);
  if (identity.deviceId && candidate.deviceId) {
    return identity.deviceId === candidate.deviceId;
  }
  return Boolean(
    identity.target && candidate.target && identity.target === candidate.target,
  );
}

function reconcileThemeSetupIdentity(
  current: ThemeSetupDeviceIdentity | null,
  device: DeviceInfo,
): ThemeSetupDeviceIdentity | null {
  const candidate = readThemeSetupIdentity(device);
  const hasIdentity = Boolean(candidate.deviceId || candidate.target);
  if (current && deviceMatchesThemeSetupIdentity(current, device)) {
    if (deviceCompletedThemeSetup(device)) {
      return null;
    }
    return {
      deviceId: candidate.deviceId || current.deviceId,
      target: candidate.target || current.target,
    };
  }
  if (hasIdentity && deviceNeedsThemeSetup(device)) {
    return candidate;
  }
  return null;
}

function markDeviceDisconnected(
  current: DeviceInfo | null,
  target = "",
): DeviceInfo | null {
  if (!current) {
    return target ? { target, connected: false, ready: false } : null;
  }
  return {
    ...current,
    ...(target ? { target } : {}),
    connected: false,
    ready: false,
    connectionState: deviceIsConfigured(current)
      ? "reconnecting"
      : current.connectionState,
  };
}

function mergeDeviceDisplay(
  current: DeviceInfo["display"],
  next: DeviceInfo["display"],
): DeviceInfo["display"] {
  if (!current) {
    return next;
  }
  if (!next) {
    return current;
  }
  return {
    ...current,
    ...next,
    themeSpec: next.themeSpec
      ? { ...current.themeSpec, ...next.themeSpec }
      : current.themeSpec,
  };
}

function mergeDeviceCapabilities(
  current: DeviceInfo["capabilities"],
  next: DeviceInfo["capabilities"],
): DeviceInfo["capabilities"] {
  if (!current) {
    return next;
  }
  if (!next) {
    return current;
  }
  return {
    ...current,
    ...next,
    auth: next.auth ? { ...current.auth, ...next.auth } : current.auth,
    display: next.display
      ? {
          ...current.display,
          ...next.display,
          brightness: next.display.brightness
            ? { ...current.display?.brightness, ...next.display.brightness }
            : current.display?.brightness,
        }
      : current.display,
    theme: next.theme ? { ...current.theme, ...next.theme } : current.theme,
    transport: next.transport
      ? { ...current.transport, ...next.transport }
      : current.transport,
  };
}

function readInitialDeviceTarget(): string {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    const params = new URLSearchParams(window.location.search);
    return normalizeDeviceTarget(
      params.get("target") ||
        window.localStorage.getItem(DEVICE_TARGET_STORAGE_KEY) ||
        "",
    );
  } catch {
    return "";
  }
}

function readLocalSetupPreviewStep(): "mac-app" | null {
  if (typeof window === "undefined") {
    return null;
  }
  const localHostnames = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!localHostnames.has(window.location.hostname)) {
    return null;
  }
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("setupStep") === "mac-app" ? "mac-app" : null;
  } catch {
    return null;
  }
}

function rememberDeviceTarget(target: string) {
  if (typeof window === "undefined") {
    return;
  }
  const normalized = normalizeDeviceTarget(target);
  if (!normalized) {
    return;
  }
  try {
    window.localStorage.setItem(DEVICE_TARGET_STORAGE_KEY, normalized);
  } catch {
    // localStorage may be unavailable in private or restricted browser contexts.
  }
}

function forgetDeviceTarget() {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(DEVICE_TARGET_STORAGE_KEY);
  } catch {
    // localStorage may be unavailable in private or restricted browser contexts.
  }
}

function normalizeDeviceTarget(target: string): string {
  const trimmed = target.trim();
  if (!trimmed) {
    return "";
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `http://${trimmed}`;
}

export function deviceMatchesExpectedConnection(
  device: DeviceInfo | null | undefined,
  expectedTarget?: string,
  expectedDeviceId?: string,
): device is DeviceInfo {
  if (!device?.connected || !device.paired) {
    return false;
  }
  const targetMatches =
    !expectedTarget ||
    (Boolean(device.target) &&
      normalizeDeviceTarget(device.target || "") ===
        normalizeDeviceTarget(expectedTarget));
  const identityMatches =
    !expectedDeviceId || device.deviceId === expectedDeviceId;
  return targetMatches && identityMatches;
}

function formatTime(): string {
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}
