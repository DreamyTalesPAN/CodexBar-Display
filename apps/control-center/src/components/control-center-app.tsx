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
import { hasFirmwareUpdate, type FirmwareUpdateInfo } from "@/lib/firmware";
import type { ThemeCatalogResponse } from "@/lib/themes";
import { ControlCenterShell } from "./control-center-shell";
import {
  companionRequestUrl,
  isLocalCompanionOrigin,
  localizeCompanionAssetUrl,
  localControlCenterUrl,
  needsLoopbackTargetAddressSpace,
  shouldRedirectToLocalControlCenter,
  shouldUseHostedSetupShell,
} from "./control-center-runtime";
import {
  deviceImageIsStuck,
  deviceSetupIsUsable,
  deviceStartupConnectionIsReady,
  type ActiveTab,
  type ApiError,
  type CompanionInfo,
  type CompanionStatus,
  type ControlCenterEvent,
  type DeviceCandidate,
  type DeviceInfo,
  type DeviceSearchState,
  type DeviceState,
  type ProviderSetupInfo,
  type SupportDiagnostics,
  type UsageSnapshot,
} from "./control-center-types";
import { DeviceStartupScreen } from "./device-startup-screen";
import { useCompanionRelease } from "./companion-installer-actions";
import { HostedSetupShell } from "./hosted-setup-shell";
import { LogsScreen } from "./logs-screen";
import { OverviewScreen } from "./overview-screen";
import {
  providerSetupIsReady,
  providerSetupNeedsAction,
} from "./provider-setup-card";
import { SetupScreen } from "./setup-screen";
import { SettingsScreen } from "./settings-screen";
import { ThemeLibraryScreen } from "./theme-library-screen";
import { UpdatesScreen } from "./updates-screen";
import { UsageScreen } from "./usage-screen";

const DEVICE_TARGET_STORAGE_KEY = "vibetv.controlCenter.deviceTarget";
const COMPANION_REQUEST_TIMEOUT_MS = 45_000;
const COMPANION_REPAIR_REQUEST_TIMEOUT_MS = 90_000;
const DEVICE_SEARCH_REQUEST_TIMEOUT_MS = 40_000;
const RECENT_COMPANION_REQUEST_MS = 5_000;

type LocalNetworkRequestInit = RequestInit & {
  targetAddressSpace?: "loopback";
};

type SettingsResponse = {
  settings?: {
    display?: {
      brightnessPercent?: number;
    };
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

type ThemeInstallJob = {
  id: string;
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
  const initialTheme = useMemo(
    () =>
      initialThemeId
        ? catalog.themes.find((theme) => theme.themeId === initialThemeId)
        : undefined,
    [catalog.themes, initialThemeId],
  );
  const [selectedThemeId, setSelectedThemeId] = useState(
    initialTheme?.themeId || initialThemeId || "",
  );
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");
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
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [deviceTarget, setDeviceTarget] = useState(readInitialDeviceTarget);
  const [brightness, setBrightness] = useState<number | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [lastError, setLastError] = useState<ApiError | null>(null);
  const [lastInstall, setLastInstall] = useState<InstallResponse["result"]>();
  const [themeInstallStatus, setThemeInstallStatus] =
    useState<ThemeInstallStatus | null>(null);
  const [firmwareUpdate, setFirmwareUpdate] =
    useState<FirmwareUpdateInfo | null>(null);
  const [firmwareUpdateStatus, setFirmwareUpdateStatus] =
    useState<FirmwareUpdateStatus | null>(null);
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [usageError, setUsageError] = useState<ApiError | null>(null);
  const [providerSetup, setProviderSetup] =
    useState<ProviderSetupInfo | null>(null);
  const [setupPreviewStep, setSetupPreviewStep] = useState<"mac-app" | null>(
    readLocalSetupPreviewStep,
  );
  const [setupResetVersion, setSetupResetVersion] = useState(0);
  const [themeInstallEnabled, setThemeInstallEnabled] = useState(false);
  const [supportDiagnostics, setSupportDiagnostics] =
    useState<SupportDiagnostics | null>(null);
  const didRunInitialConnectionCheck = useRef(false);
  const didRunAutomaticDeviceSearch = useRef(false);
  const didRunAutoDisplayReload = useRef(false);
  const didRouteAfterSetupComplete = useRef(false);
  const didRunSetupVerification = useRef(false);
  const automaticPairingRepairKey = useRef("");
  const lastCompanionRequestAt = useRef(0);
  const statusPollInFlight = useRef(false);
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
  const localControlCenterPath = useMemo(
    () => localControlCenterPathForTheme(initialThemeId),
    [initialThemeId],
  );

  const handleDeviceTargetChange = useCallback((target: string) => {
    setDeviceTarget(target);
    if (target.trim() === "") {
      forgetDeviceTarget();
    }
  }, []);

  const mergeDevice = useCallback((next: DeviceInfo) => {
    if (deviceStartupConnectionIsReady(next)) {
      didRunAutomaticDeviceSearch.current = false;
    }
    setDevice((current) => mergeDeviceInfo(current, next));
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
        ].slice(0, 10),
      );
    },
    [],
  );

  const markCompanionUnavailable = useCallback(() => {
    setCompanionStatus("missing");
    setCompanionInfo(null);
    setThemeInstallEnabled(false);
    setDevice(null);
    setDeviceState("unknown");
    setUsage(null);
    setUsageError(null);
    setProviderSetup(null);
  }, []);

  const markCompanionAccessBlocked = useCallback(() => {
    setCompanionStatus("unknown");
    setCompanionInfo(null);
    setThemeInstallEnabled(false);
    setDevice(null);
    setDeviceState("unknown");
    setUsage(null);
    setUsageError(null);
    setProviderSetup(null);
  }, []);

  const handleCompanionUnavailableForRepair = useCallback(
    (quiet: boolean) => {
      const normalized = companionUnavailableError();
      markCompanionUnavailable();
      setActiveTab("overview");
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

  const refreshCompanionFeatures = useCallback(async () => {
    try {
      const payload = await runCompanion<{
        companion?: CompanionInfo;
        providerSetup?: ProviderSetupInfo;
      }>("/v1/status", undefined, { preserveLastError: true });
      setCompanionStatus("online");
      setCompanionInfo(payload.companion || null);
      setProviderSetup(payload.providerSetup || null);
      setThemeInstallEnabled(
        Boolean(payload.companion?.features?.themeInstallEnabled),
      );
    } catch (error) {
      const normalized = normalizeCaughtError(
        error,
        "Mac App needs attention.",
      );
      if (isLocalNetworkAccessError(normalized)) {
        markCompanionAccessBlocked();
      } else {
        markCompanionUnavailable();
      }
    }
  }, [markCompanionAccessBlocked, markCompanionUnavailable, runCompanion]);

  const refreshDevice = useCallback(
    async ({ quiet = false }: { quiet?: boolean } = {}) => {
      try {
        const payload = await runCompanion<{ device: DeviceInfo }>(
          "/v1/device",
        );
        mergeDevice(payload.device);
        if (payload.device.target) {
          setDeviceTarget(payload.device.target);
          rememberDeviceTarget(payload.device.target);
        }
        setDeviceState(payload.device.paired ? "paired" : "online");
        if (!quiet) {
          const ready = deviceSetupIsUsable(payload.device);
          const waitingForProvider = deviceConnectionIsReadyForProviderSetup(
            payload.device,
            providerSetup,
          );
          addEvent({
            label: "VibeTV checked",
            detail: ready
              ? "VibeTV is ready."
              : waitingForProvider
                ? "VibeTV is connected. Connect an AI provider to start the display."
              : payload.device.connected
                ? "VibeTV was found, but its screen is not ready yet."
                : "VibeTV is waiting for signal.",
            tone: ready || waitingForProvider ? "ready" : "attention",
          });
        }
        return payload.device;
      } catch (error) {
        const normalized = normalizeCaughtError(
          error,
          "VibeTV needs attention.",
        );
        if (isLocalNetworkAccessError(normalized)) {
          markCompanionAccessBlocked();
        } else if (isCompanionMissingError(normalized)) {
          markCompanionUnavailable();
        } else {
          setDevice((current) =>
            current ? { ...current, connected: false } : current,
          );
          setDeviceState("offline");
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
      mergeDevice,
      providerSetup,
      runCompanion,
    ],
  );

  const loadSettings = useCallback(async () => {
    setBusyAction("settings");
    try {
      const payload = await runCompanion<SettingsResponse>("/v1/settings");
      const loadedBrightness =
        payload.settings?.display?.brightnessPercent ?? null;
      setBrightness(loadedBrightness);
      if (payload.device) {
        mergeDevice(payload.device);
        setDeviceState(payload.device.paired ? "paired" : "online");
        if (
          !initialThemeId &&
          payload.device.activeTheme &&
          catalog.themes.some(
            (theme) => theme.themeId === payload.device?.activeTheme,
          )
        ) {
          setSelectedThemeId(payload.device.activeTheme);
        }
        if (payload.device.target) {
          setDeviceTarget(payload.device.target);
          rememberDeviceTarget(payload.device.target);
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
      setBusyAction(null);
    }
  }, [
    addEvent,
    catalog.themes,
    initialThemeId,
    markCompanionAccessBlocked,
    markCompanionUnavailable,
    mergeDevice,
    runCompanion,
  ]);

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
      const quiet = Boolean(options?.quiet);
      if (!quiet) {
        setBusyAction("status");
      }
      try {
        const payload = await runCompanion<{
          companion?: CompanionInfo;
          device?: DeviceInfo;
          providerSetup?: ProviderSetupInfo;
        }>("/v1/status", undefined, { preserveLastError: quiet });
        const checkedAt = formatTime();
        const wasMissing = companionStatus === "missing";
        setCompanionStatus("online");
        setCompanionInfo(payload.companion || null);
        setProviderSetup(payload.providerSetup || null);
        setLastError(null);
        setThemeInstallEnabled(
          Boolean(payload.companion?.features?.themeInstallEnabled),
        );
        if (
          shouldRedirectToLocalControlCenter() &&
          payload.companion?.installationMode !== "dmg"
        ) {
          try {
            await verifyLocalControlCenterAvailable();
          } catch (error) {
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
          } catch (error) {
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
        if (payload.device?.target) {
          mergeDevice(payload.device);
          setDeviceTarget(payload.device.target);
          rememberDeviceTarget(payload.device.target);
          setDeviceState(
            payload.device.paired
              ? "paired"
              : payload.device.connected
                ? "online"
                : "unknown",
          );
          if (deviceSetupIsUsable(payload.device)) {
            void loadSettings();
          }
        } else {
          forgetDeviceTarget();
          setDeviceTarget("");
          setDevice(null);
          setDeviceState("unknown");
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
        if (!quiet) {
          setBusyAction(null);
        }
      }
    },
    [
      addEvent,
      companionStatus,
      loadSettings,
      markCompanionAccessBlocked,
      markCompanionUnavailable,
      mergeDevice,
      runCompanion,
      verifyLocalControlCenterAvailable,
    ],
  );

  const syncLocalStatus = useCallback(async () => {
    if (statusPollInFlight.current) {
      return;
    }
    statusPollInFlight.current = true;
    try {
      const payload = await runCompanion<{
        companion?: CompanionInfo;
        device?: DeviceInfo;
        providerSetup?: ProviderSetupInfo;
      }>("/v1/status", undefined, { preserveLastError: true });
      setCompanionStatus("online");
      setCompanionInfo(payload.companion || null);
      setProviderSetup(payload.providerSetup || null);
      setThemeInstallEnabled(
        Boolean(payload.companion?.features?.themeInstallEnabled),
      );
      if (payload.device?.target) {
        mergeDevice(payload.device);
        setDeviceTarget(payload.device.target);
        rememberDeviceTarget(payload.device.target);
        setDeviceState(
          payload.device.paired
            ? "paired"
            : payload.device.connected
              ? "online"
          : "unknown",
        );
      } else {
        forgetDeviceTarget();
        setDeviceTarget("");
        setDevice(null);
        setDeviceState("unknown");
      }
    } catch (error) {
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
    markCompanionAccessBlocked,
    markCompanionUnavailable,
    mergeDevice,
    runCompanion,
  ]);

  const repairConnection = useCallback(
    async (options?: {
      targetOverride?: string;
      expectedDeviceId?: string;
      forcePair?: boolean;
      quiet?: boolean;
    }) => {
      const quiet = Boolean(options?.quiet);
      const target =
        typeof options?.targetOverride === "string"
          ? normalizeDeviceTarget(options.targetOverride)
          : "";
      setBusyAction("repair");
      try {
        if (companionStatus === "missing") {
          handleCompanionUnavailableForRepair(quiet);
          return false;
        }
        if (companionStatus !== "online") {
          try {
            const statusPayload = await runCompanion<{
              companion?: CompanionInfo;
              device?: DeviceInfo;
              providerSetup?: ProviderSetupInfo;
            }>("/v1/status", undefined, { preserveLastError: quiet });
            setCompanionStatus("online");
            setCompanionInfo(statusPayload.companion || null);
            setProviderSetup(statusPayload.providerSetup || null);
            setThemeInstallEnabled(
              Boolean(statusPayload.companion?.features?.themeInstallEnabled),
            );
            if (statusPayload.device?.target) {
              mergeDevice(statusPayload.device);
              setDeviceTarget(statusPayload.device.target);
              rememberDeviceTarget(statusPayload.device.target);
              setDeviceState(
                statusPayload.device.paired
                  ? "paired"
                  : statusPayload.device.connected
                    ? "online"
                    : "unknown",
              );
            } else {
              forgetDeviceTarget();
              setDeviceTarget("");
              setDevice(null);
              setDeviceState("unknown");
            }
            if (
              !target &&
              statusPayload.device &&
              deviceSetupIsUsable(statusPayload.device)
            ) {
              setLastError(null);
              if (deviceSetupIsUsable(statusPayload.device)) {
                void loadSettings();
              }
              return true;
            }
          } catch (statusError) {
            const normalized = normalizeCaughtError(
              statusError,
              "Mac App needs attention.",
            );
            if (isLocalNetworkAccessError(normalized)) {
              markCompanionAccessBlocked();
              if (!quiet) {
                setLastError(normalized);
                addEvent({
                  label: "Browser access needs attention",
                  detail: normalized.nextAction,
                  tone: "attention",
                });
              }
            } else {
              handleCompanionUnavailableForRepair(quiet);
            }
            return false;
          }
        }
        const payload = await runCompanion<{ device: DeviceInfo }>(
          "/v1/device/repair",
          {
            method: "POST",
            body: JSON.stringify({
              ...(target ? { target } : {}),
              ...(options?.expectedDeviceId
                ? { expectedDeviceId: options.expectedDeviceId }
                : {}),
              ...(options?.forcePair ? { forcePair: true } : {}),
            }),
          },
          {
            preserveLastError: quiet,
            timeoutMs: COMPANION_REPAIR_REQUEST_TIMEOUT_MS,
          },
        );
        setCompanionStatus("online");
        void refreshCompanionFeatures();
        setLastError(null);
        mergeDevice(payload.device);
        setDeviceState(
          payload.device.paired
            ? "paired"
            : payload.device.connected
              ? "online"
              : "offline",
        );
        if (payload.device.target) {
          setDeviceTarget(payload.device.target);
          rememberDeviceTarget(payload.device.target);
        }
        const ready = deviceStartupConnectionIsReady(payload.device);
        const waitingForProvider = deviceConnectionIsReadyForProviderSetup(
          payload.device,
          providerSetup,
        );
        const connectionAccepted = ready || waitingForProvider;
        if (payload.device.connected && !connectionAccepted) {
          setLastError(displayNotReadyError());
        }
        addEvent({
          label: quiet ? "Connection repaired" : "VibeTV connection fixed",
          detail: ready
            ? "VibeTV is ready."
            : waitingForProvider
              ? "VibeTV is connected. Connect an AI provider to start the display."
            : payload.device.connected
              ? "VibeTV was found, but its screen is not ready yet."
              : "VibeTV is waiting for signal.",
          tone: connectionAccepted ? "ready" : "attention",
        });
        if (connectionAccepted) {
          void loadSettings();
        }
        return connectionAccepted;
      } catch (error) {
        const normalized = normalizeCaughtError(
          error,
          "VibeTV connection needs attention.",
        );
        if (isLocalNetworkAccessError(normalized)) {
          markCompanionAccessBlocked();
        } else if (isCompanionMissingError(normalized)) {
          markCompanionUnavailable();
        } else {
          setCompanionStatus("online");
          void refreshCompanionFeatures();
          setDevice(target ? { target, connected: false } : null);
          setDeviceState("offline");
        }
        if (!quiet) {
          setLastError(normalized);
          addEvent({
            label: "Fix connection needs attention",
            detail: normalized.nextAction,
            tone: "attention",
          });
        }
        return false;
      } finally {
        setBusyAction(null);
      }
    },
    [
      addEvent,
      companionStatus,
      handleCompanionUnavailableForRepair,
      loadSettings,
      markCompanionAccessBlocked,
      markCompanionUnavailable,
      mergeDevice,
      providerSetup,
      refreshCompanionFeatures,
      runCompanion,
    ],
  );

  const searchAndConnect = useCallback(async () => {
    setBusyAction("search");
    setDeviceCandidates([]);
    setDeviceSearchState("searching");
    setLastError(null);
    try {
      const payload = await runCompanion<{ devices?: DeviceCandidate[] }>(
        "/v1/device/search",
        { method: "POST" },
        { timeoutMs: DEVICE_SEARCH_REQUEST_TIMEOUT_MS },
      );
      const candidates = (payload.devices || []).filter(
        (candidate) => candidate.target && candidate.networkMode !== "setup",
      );
      const selected = candidates.length === 1 ? candidates[0] : null;

      if (selected) {
        setDeviceCandidates([selected]);
        setDeviceSearchState("alternate");
        return;
      }
      if (candidates.length > 0) {
        setDeviceCandidates(candidates);
        setDeviceSearchState("multiple");
        return;
      }
      setDeviceSearchState("not-found");
      setDeviceState("offline");
    } catch (error) {
      const normalized = normalizeCaughtError(
        error,
        "Automatic VibeTV search could not finish.",
      );
      if (isCompanionMissingError(normalized)) {
        handleCompanionUnavailableForRepair(false);
      } else if (normalized.code === "device_not_found") {
        setDeviceSearchState("not-found");
        setDeviceState("offline");
        setLastError(null);
      } else {
        setDeviceSearchState("failed");
        setLastError(normalized);
      }
    } finally {
      setBusyAction(null);
    }
  }, [
    handleCompanionUnavailableForRepair,
    runCompanion,
  ]);

  const selectAndConnectDevice = useCallback(
    async (candidate: DeviceCandidate) => {
      if (!candidate.deviceId) {
        setLastError({
          code: "device_identity_missing",
          message: "This VibeTV did not provide a stable device identity.",
          nextAction: "Search again, then choose a VibeTV with a device ID.",
        });
        setDeviceSearchState("repair-failed");
        return;
      }
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
        mergeDevice(payload.device);
        setDeviceCandidates([]);
        setDeviceSearchState("idle");
        setDeviceState(payload.device.paired ? "paired" : "online");
        if (payload.device.target) {
          setDeviceTarget(payload.device.target);
          rememberDeviceTarget(payload.device.target);
        }
        setLastError(null);
        addEvent({
          label: "VibeTV selected",
          detail: deviceConnectionIsReadyForProviderSetup(
            payload.device,
            providerSetup,
          )
            ? "The selected VibeTV is connected. Connect an AI provider to start the display."
            : "The selected VibeTV is connected and showing a fresh image.",
          tone: "ready",
        });
        void loadSettings();
      } catch (error) {
        const normalized = normalizeCaughtError(
          error,
          "The selected VibeTV could not be connected.",
        );
        setLastError(normalized);
        setDeviceSearchState("repair-failed");
        addEvent({
          label: "VibeTV selection failed",
          detail: normalized.nextAction,
          tone: "attention",
        });
      } finally {
        setBusyAction(null);
      }
    },
    [addEvent, loadSettings, mergeDevice, providerSetup, runCompanion],
  );

  useEffect(() => {
    if (
      deviceSearchState !== "alternate" ||
      deviceCandidates.length !== 1 ||
      busyAction
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void selectAndConnectDevice(deviceCandidates[0]);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    busyAction,
    deviceCandidates,
    deviceSearchState,
    selectAndConnectDevice,
  ]);

  useEffect(() => {
    const pairingRequired =
      device?.stream?.errorCode === "device_pairing_required";
    if (!pairingRequired) {
      if (device?.ready === true) {
        automaticPairingRepairKey.current = "";
      }
      return;
    }
    if (
      !device?.deviceId ||
      !device.target ||
      busyAction ||
      companionStatus !== "online"
    ) {
      return;
    }
    const repairKey = `${device.deviceId}:${device.target}`;
    if (automaticPairingRepairKey.current === repairKey) {
      return;
    }
    automaticPairingRepairKey.current = repairKey;
    void repairConnection({
      expectedDeviceId: device.deviceId,
      quiet: true,
    }).then((repaired) => {
      if (repaired) {
        return;
      }
      setActiveTab("overview");
      setDeviceSearchState("repair-failed");
      setLastError({
        code: "device_pairing_repair_failed",
        message: "VibeTV could not reconnect automatically.",
        nextAction: "Make sure VibeTV is on the same WiFi, then try again.",
      });
    });
  }, [
    busyAction,
    companionStatus,
    device?.deviceId,
    device?.ready,
    device?.stream?.errorCode,
    device?.target,
    repairConnection,
  ]);

  const reloadDisplay = useCallback(
    async (options?: { quiet?: boolean }) => {
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
        setCompanionStatus("online");
        setLastError(null);
        mergeDevice(payload.device);
        setDeviceState(
          payload.device.paired
            ? "paired"
            : payload.device.connected
              ? "online"
              : "offline",
        );
        if (payload.device.target) {
          setDeviceTarget(payload.device.target);
          rememberDeviceTarget(payload.device.target);
        }
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
        setBusyAction(null);
      }
    },
    [
      addEvent,
      markCompanionAccessBlocked,
      markCompanionUnavailable,
      mergeDevice,
      runCompanion,
    ],
  );

  const resetSetup = useCallback(async () => {
    setBusyAction("reset-setup");
    setLastError(null);
    forgetDeviceTarget();
    setDeviceTarget("");
    setDevice(null);
    setDeviceState("unknown");
    setDeviceCandidates([]);
    setDeviceSearchState("idle");
    setBrightness(null);
    setLastInstall(undefined);
    setThemeInstallStatus(null);
    setSupportDiagnostics(null);
    setFirmwareUpdate(null);
    setUsage(null);
    setUsageError(null);
    setProviderSetup(null);
    didRunAutoDisplayReload.current = false;
    didRunAutomaticDeviceSearch.current = false;
    didRouteAfterSetupComplete.current = false;
    didRunSetupVerification.current = false;
    setSetupPreviewStep(null);
    setActiveTab("overview");
    try {
      const payload = await runCompanion<{
        companion?: CompanionInfo;
        device?: DeviceInfo;
        providerSetup?: ProviderSetupInfo;
      }>("/v1/setup/reset", { method: "POST" });
      setCompanionStatus("online");
      setCompanionInfo(payload.companion || null);
      setProviderSetup(payload.providerSetup || null);
      setThemeInstallEnabled(
        Boolean(payload.companion?.features?.themeInstallEnabled),
      );
      if (payload.device) {
        setDevice(payload.device.connected ? payload.device : null);
      }
      addEvent({
        label: "Setup restarted",
        detail: "Local VibeTV connection was cleared.",
        tone: "unknown",
      });
    } catch (error) {
      const normalized = normalizeCaughtError(error, "Setup reset locally.");
      if (isLocalNetworkAccessError(normalized)) {
        markCompanionAccessBlocked();
      } else {
        markCompanionUnavailable();
      }
      addEvent({
        label: "Setup restarted locally",
        detail: "Mac App connection will be checked again.",
        tone: "unknown",
      });
    } finally {
      setSetupResetVersion((current) => current + 1);
      setBusyAction(null);
    }
  }, [
    addEvent,
    markCompanionAccessBlocked,
    markCompanionUnavailable,
    runCompanion,
  ]);

  const saveBrightness = useCallback(
    async (value: number) => {
      setBrightness(value);
      setBusyAction("brightness");
      try {
        const payload = await runCompanion<SettingsResponse>("/v1/settings", {
          method: "POST",
          body: JSON.stringify({ brightnessPercent: value }),
        });
        const savedValue =
          payload.settings?.display?.brightnessPercent ?? value;
        setBrightness(savedValue);
        if (payload.device) {
          mergeDevice(payload.device);
          setDeviceState(payload.device.paired ? "paired" : "online");
          if (payload.device.target) {
            setDeviceTarget(payload.device.target);
            rememberDeviceTarget(payload.device.target);
          }
        }
        addEvent({
          label: "Brightness saved",
          detail: `Display brightness is set to ${savedValue}%.`,
          tone: "ready",
        });
      } catch (error) {
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
        setBusyAction(null);
      }
    },
    [
      addEvent,
      markCompanionAccessBlocked,
      markCompanionUnavailable,
      mergeDevice,
      runCompanion,
    ],
  );

  const installTheme = useCallback(
    async (theme = selectedTheme) => {
      if (!theme) {
        return;
      }
      setBusyAction("install");
      setLastInstall(undefined);
      setSelectedThemeId(theme.themeId);
      const startedAt = formatTime();
      const initialLogs = ["Preparing theme install."];
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
        const payload = await runCompanion<InstallResponse>(
          "/v1/themes/install",
          {
            method: "POST",
            body: JSON.stringify({
              themeId: theme.themeId,
              packUrl: localizeCompanionAssetUrl(theme.packUrl),
              skipFirmwareUpdate: true,
              async: true,
            }),
          },
        );
        let result = payload.result;
        let logs = customerInstallLogs(payload.logs, initialLogs);
        if (payload.job) {
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
          message: "Theme is active on VibeTV.",
          progress: 100,
          logs: customerInstallLogs([...logs, "Theme is active on VibeTV."]),
          result,
        });
        if (result.themeId) {
          setDevice((current) =>
            current ? { ...current, activeTheme: result.themeId } : current,
          );
        }
        addEvent({
          label: "Theme installed",
          detail: result.name || theme.title,
          at: finishedAt,
          tone: "ready",
        });
        await loadSettings();
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
      } finally {
        setBusyAction(null);
      }
    },
    [
      addEvent,
      loadSettings,
      markCompanionAccessBlocked,
      markCompanionUnavailable,
      runCompanion,
      selectedTheme,
    ],
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

  useEffect(() => {
    if (
      hostedSetup ||
      setupPreviewStep ||
      !initialCompanionCheckComplete ||
      companionStatus !== "online" ||
      deviceConnectionIsOperational(device) ||
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
    device,
    deviceSearchState,
    hostedSetup,
    initialCompanionCheckComplete,
    searchAndConnect,
    setupPreviewStep,
  ]);

  useEffect(() => {
    if (hostedSetup) {
      return;
    }
    if (!deviceImageIsStuck(device)) {
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
    companionStatus,
    device,
    hostedSetup,
    reloadDisplay,
    setupPreviewStep,
  ]);

  useEffect(() => {
    const shouldPollIncompleteSetup =
      companionStatus === "missing" ||
      (companionStatus === "online" &&
        (!deviceSetupIsUsable(device) ||
          device?.connectionState === "reconnecting"));
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
        return;
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
          );
          setFirmwareUpdate(payload);
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
          setFirmwareUpdate((await response.json()) as FirmwareUpdateInfo);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setFirmwareUpdate({
          checkedAt: new Date().toISOString(),
          installedFirmware: firmware,
          updateAvailable: false,
          status: "check_failed",
          message: "Firmware check failed.",
        });
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
  }, [
    checkCompanion,
    refreshFirmwareUpdate,
    refreshHostedCompanionRelease,
  ]);

  const installFirmwareUpdate = useCallback(async () => {
    const startedAt = formatTime();
    const initialLogs = ["Preparing VibeTV update."];
    const applyUpdateJob = (job: FirmwareUpdateJob) => {
      const phase =
        job.phase === "complete"
          ? "complete"
          : job.phase === "attention"
            ? "attention"
          : job.phase === "error"
            ? "error"
            : "installing";
      const logs = customerUpdateLogs(job.logs, initialLogs);
      setFirmwareUpdateStatus({
        phase,
        stage: job.stage,
        outcome: job.outcome,
        retryAllowed: job.retryPolicy !== "power_cycle",
        startedAt,
        finishedAt:
          phase === "complete" || phase === "attention" || phase === "error"
            ? formatTime()
            : undefined,
        message:
          job.error?.nextAction ||
          job.message ||
          logs[logs.length - 1] ||
          initialLogs[0],
        progress: clampProgress(job.progress),
        logs,
        result: job.result,
        error: job.error?.nextAction,
      });
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
      setFirmwareUpdateStatus({
        phase: "complete",
        startedAt,
        finishedAt,
        message: "Update complete.",
        progress: 100,
        logs: customerUpdateLogs([...logs, "Update complete."]),
        result: finishedJob.result,
      });
      if (installedFirmware) {
        setDevice((current) =>
          current ? { ...current, firmware: installedFirmware } : current,
        );
        setFirmwareUpdate(currentFirmwareUpdate(installedFirmware));
      }
      addEvent({
        label: "VibeTV updated",
        detail: installedFirmware
          ? `Firmware ${installedFirmware} is installed.`
          : "Update complete.",
        at: finishedAt,
        tone: "ready",
      });
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
      return true;
    } catch (error) {
      const normalized = normalizeCaughtError(error, "VibeTV update failed.");
      if (isLocalNetworkAccessError(normalized)) {
        markCompanionAccessBlocked();
      } else if (isCompanionMissingError(normalized)) {
        markCompanionUnavailable();
      }
      setLastError(normalized);
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
    deviceBoard,
    markCompanionAccessBlocked,
    markCompanionUnavailable,
    refreshDevice,
    refreshFirmwareUpdate,
    runCompanion,
  ]);

  const refreshUsage = useCallback(
    async (options?: { quiet?: boolean }) => {
      const quiet = Boolean(options?.quiet);
      if (!quiet) {
        setBusyAction("usage");
      }
      try {
        const payload = await runCompanion<UsageSnapshot>(
          "/v1/usage",
          undefined,
          { preserveLastError: quiet },
        );
        setUsage(payload);
        setUsageError(null);
        setCompanionStatus("online");
        if (!quiet) {
          addEvent({
            label: "Usage refreshed",
            detail: `${payload.providers?.length || 0} provider tiles loaded.`,
            tone: payload.providers?.length ? "ready" : "attention",
          });
        }
      } catch (error) {
        const normalized = normalizeUsageError(
          normalizeCaughtError(error, "Usage needs attention."),
        );
        if (isLocalNetworkAccessError(normalized)) {
          markCompanionAccessBlocked();
        } else if (isCompanionMissingError(normalized)) {
          markCompanionUnavailable();
        } else if (normalized.code === "MAC_APP_UPDATE_REQUIRED") {
          setSetupPreviewStep("mac-app");
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

  const runProviderAction = useCallback(
    async (action: "retry" | "open-codexbar") => {
      const opening = action === "open-codexbar";
      setBusyAction(opening ? "providers-open" : "providers-retry");
      setLastError(null);
      try {
        const payload = await runCompanion<{
          providerSetup?: ProviderSetupInfo;
        }>(`/v1/providers/${action}`, { method: "POST" });
        if (payload.providerSetup) {
          setProviderSetup(payload.providerSetup);
        }
        addEvent({
          label: opening ? "CodexBar opened" : "AI providers checked",
          detail: providerSetupIsReady(payload.providerSetup)
            ? "Provider usage is ready."
            : opening
              ? "Finish provider setup in CodexBar, then check again."
              : "A provider still needs attention.",
          tone: providerSetupIsReady(payload.providerSetup)
            ? "ready"
            : "attention",
        });
        if (providerSetupIsReady(payload.providerSetup)) {
          await refreshUsage({ quiet: true });
        }
      } catch (error) {
        const normalized = normalizeCaughtError(
          error,
          opening ? "CodexBar could not be opened." : "Provider check failed.",
        );
        if (isLocalNetworkAccessError(normalized)) {
          markCompanionAccessBlocked();
        } else if (isCompanionMissingError(normalized)) {
          markCompanionUnavailable();
        }
        setLastError(normalized);
        addEvent({
          label: opening
            ? "CodexBar needs attention"
            : "Provider check needs attention",
          detail: normalized.nextAction,
          tone: "attention",
        });
      } finally {
        setBusyAction(null);
      }
    },
    [
      addEvent,
      markCompanionAccessBlocked,
      markCompanionUnavailable,
      refreshUsage,
      runCompanion,
    ],
  );

  const loadSupportDiagnostics = useCallback(async () => {
    setBusyAction("diagnostics");
    try {
      const payload = await runCompanion<SupportDiagnostics>("/v1/diagnostics");
      setSupportDiagnostics(payload);
      setCompanionStatus("online");
      setCompanionInfo(payload.companion || null);
      setProviderSetup(payload.providerSetup || null);
      setThemeInstallEnabled(
        Boolean(payload.companion?.features?.themeInstallEnabled),
      );
      if (payload.device) {
        mergeDevice(payload.device);
        if (payload.device.target) {
          setDeviceTarget(payload.device.target);
          rememberDeviceTarget(payload.device.target);
        }
        setDeviceState(
          payload.device.paired
            ? "paired"
            : payload.device.connected
              ? "online"
              : "unknown",
        );
      }
      addEvent({
        label: "Support report ready",
        detail: `${payload.checks?.length || 0} items ready for support.`,
        tone: payload.checks?.some((check) => check.status === "fail")
          ? "attention"
          : "ready",
      });
    } catch (error) {
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
    } finally {
      setBusyAction(null);
    }
  }, [
    addEvent,
    markCompanionAccessBlocked,
    markCompanionUnavailable,
    mergeDevice,
    runCompanion,
  ]);

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
  const companionRelease =
    hostedCompanionRelease?.status === "check_failed" && companionInfo?.update
      ? {
          ...companionInfo.update,
          ...hostedCompanionRelease,
        }
      : hostedCompanionRelease || companionInfo?.update || null;
  const companionInstallationMode =
    companionInfo?.installationMode ||
    (companionInfo?.features?.macAppSelfUpdateEnabled === true
      ? "legacy"
      : undefined);
  const requiresMacAppMigration = Boolean(
    companionStatus === "online" && companionInstallationMode === "legacy",
  );
  const macAppMigrationAvailable = Boolean(
    requiresMacAppMigration &&
      availableMacAppDmgDownloadUrl(companionRelease),
  );
  const macAppUpdateAvailable = Boolean(companionRelease?.updateAvailable);
  const anyUpdateAvailable =
    firmwareUpdateAvailable ||
    macAppUpdateAvailable ||
    macAppMigrationAvailable;
  const imageNeedsReload = deviceImageIsStuck(device);
  const providerReady = !providerSetup || providerSetupIsReady(providerSetup);
  const deviceOperational = deviceConnectionIsOperational(device);
  const setupComplete = Boolean(
    !setupPreviewStep &&
      companionStatus === "online" &&
      providerReady &&
      deviceOperational,
  );
  useEffect(() => {
    if (!deviceOperational) {
      didRouteAfterSetupComplete.current = false;
      return;
    }
    if (didRouteAfterSetupComplete.current) {
      return;
    }
    didRouteAfterSetupComplete.current = true;
    setActiveTab(
      initialThemeId && !didRunSetupVerification.current
        ? "theme-library"
        : "overview",
    );
  }, [deviceOperational, initialThemeId]);

  const disabledTabs: ActiveTab[] = imageNeedsReload
    ? ["settings", "theme-library", "updates"]
    : [];
  const activeShellTab = activeTab;

  useEffect(() => {
    if (
      hostedSetup ||
      setupPreviewStep ||
      companionStatus !== "online" ||
      (activeShellTab !== "usage" && activeShellTab !== "overview")
    ) {
      return;
    }

    const refreshStatus = () => {
      if (document.visibilityState === "hidden" || busyAction) {
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
    hostedSetup,
    setupPreviewStep,
    syncLocalStatus,
  ]);

  useEffect(() => {
    if (
      (activeShellTab !== "usage" && activeShellTab !== "overview") ||
      companionStatus !== "online"
    ) {
      return;
    }

    const initialTimer = window.setTimeout(() => {
      void refreshUsage({ quiet: true });
    }, 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") {
        return;
      }
      void refreshUsage({ quiet: true });
    }, 30000);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [activeShellTab, companionStatus, refreshUsage]);

  const renderSetupScreen = (showIntro: boolean) => (
    <SetupScreen
      key={setupResetVersion}
      companionStatus={companionStatus}
      deviceCandidates={deviceCandidates}
      deviceSearchState={deviceSearchState}
      deviceState={deviceState}
      deviceTarget={deviceTarget}
      lastError={lastError}
      busyAction={busyAction}
      hostedMode={hostedSetup}
      macAppRelease={companionRelease}
      previewStep={setupPreviewStep}
      requiresMacAppMigration={requiresMacAppMigration}
      showIntro={showIntro}
      setupComplete={setupComplete}
      device={device}
      providerSetup={providerSetup}
      diagnostics={supportDiagnostics}
      onCheckCompanion={checkCompanion}
      onCheckUpdates={checkUpdates}
      onDeviceTargetChange={handleDeviceTargetChange}
      onSearchDevices={() => {
        didRunSetupVerification.current = true;
        void searchAndConnect();
      }}
      onSelectDevice={(candidate) => {
        didRunSetupVerification.current = true;
        void selectAndConnectDevice(candidate);
      }}
      onDeclineDevice={() => {
        setDeviceCandidates([]);
        setDeviceSearchState("declined");
        setLastError(null);
        setActiveTab("overview");
      }}
      onRepairConnection={(targetOverride) => {
        didRunSetupVerification.current = true;
        repairConnection({ targetOverride });
      }}
      onResetSetup={resetSetup}
      onOpenCodexBar={() => runProviderAction("open-codexbar")}
      onRetryProviders={() => runProviderAction("retry")}
      onCreateSupportReport={loadSupportDiagnostics}
    />
  );

  if (runtimeSurface === "unknown") {
    return <ControlCenterBootScreen />;
  }

  if (runtimeSurface === "hosted-setup") {
    return (
      <HostedSetupShell
        companionStatus={companionStatus}
        setupComplete={setupComplete}
      >
        {renderSetupScreen(true)}
      </HostedSetupShell>
    );
  }

  if (!initialCompanionCheckComplete) {
    return <ControlCenterBootScreen />;
  }

  if (!deviceOperational) {
    return (
      <DeviceStartupScreen
        busyAction={busyAction}
        diagnostics={supportDiagnostics}
        deviceCandidates={deviceCandidates}
        deviceSearchState={deviceSearchState}
        lastError={lastError}
        onCreateSupportReport={loadSupportDiagnostics}
        onSearch={() => {
          void searchAndConnect();
        }}
        onSelect={(candidate) => {
          void selectAndConnectDevice(candidate);
        }}
      />
    );
  }

  return (
    <ControlCenterShell
      activeTab={activeShellTab}
      disabledTabs={disabledTabs}
      device={device}
      updateAvailable={anyUpdateAvailable}
      onTabChange={(tab) => {
        if (disabledTabs.includes(tab)) {
          return;
        }
        setActiveTab(tab);
      }}
    >
      {activeShellTab === "overview" ? (
        <OverviewScreen
          companionRelease={companionRelease}
          companionVersion={companionInfo?.version}
          companionStatus={companionStatus}
          device={device}
          firmwareUpdate={effectiveFirmwareUpdate}
          requiresMacAppMigration={requiresMacAppMigration}
          usage={usage}
        />
      ) : null}

      {activeShellTab === "usage" ? (
        <UsageScreen
          busyAction={busyAction}
          companionStatus={companionStatus}
          onRefresh={() => refreshUsage()}
          onOpenCodexBar={() => runProviderAction("open-codexbar")}
          onRetryProviders={() => runProviderAction("retry")}
          providerSetup={providerSetup}
          usage={usage}
          usageError={usageError}
        />
      ) : null}

      {activeShellTab === "settings" ? (
        <SettingsScreen
          brightness={brightness}
          busyAction={busyAction}
          device={device}
          onBrightnessChange={setBrightness}
          onSaveBrightness={saveBrightness}
        />
      ) : null}

      {activeShellTab === "theme-library" ? (
        <ThemeLibraryScreen
          busyAction={busyAction}
          companionStatus={companionStatus}
          device={device}
          installStatus={themeInstallStatus}
          catalogIssue={catalog.issue}
          lastInstall={lastInstall}
          onInstallTheme={installTheme}
          onSelectTheme={setSelectedThemeId}
          installEntry={Boolean(initialThemeId)}
          requestedThemeId={initialThemeId}
          selectedTheme={selectedTheme}
          selectedThemeId={selectedThemeId}
          storefrontConfigured={catalog.storefrontConfigured}
          themeInstallEnabled={themeInstallEnabled}
          themes={catalog.themes}
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
          requiresMacAppMigration={requiresMacAppMigration}
          updateStatus={firmwareUpdateStatus}
        />
      ) : null}

      {activeShellTab === "logs" ? (
        <LogsScreen
          busyAction={busyAction}
          diagnostics={supportDiagnostics}
          events={logs}
          lastError={lastError}
          onLoadDiagnostics={loadSupportDiagnostics}
          onRefresh={checkCompanion}
        />
      ) : null}
    </ControlCenterShell>
  );
}

function ControlCenterBootScreen() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#F9F9F9] px-6 text-[#1B1B1B]">
      <div className="text-center">
        <div className="text-[clamp(3rem,7vw,5rem)] font-black uppercase leading-none tracking-normal">
          VIBETV
        </div>
        <h1 className="mt-8 text-[clamp(2rem,4vw,3.25rem)] font-black leading-tight">
          Starting Control Center
        </h1>
        <p className="mt-3 text-base text-[#444933] sm:text-lg">
          Checking the Mac App and your last connected VibeTV.
        </p>
      </div>
    </main>
  );
}

function getRuntimeSurfaceSnapshot(): RuntimeSurface {
  return shouldUseHostedSetupShell() ? "hosted-setup" : "local-control-center";
}

function getRuntimeSurfaceServerSnapshot(): RuntimeSurface {
  return "unknown";
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

function displayNotReadyError(): ApiError {
  return {
    code: "DISPLAY_NOT_READY",
    message: "VibeTV screen is not ready yet.",
    nextAction:
      "Keep VibeTV powered on and connected to the same WiFi, then run Fix connection again.",
  };
}

function deviceConnectionIsReadyForProviderSetup(
  device: DeviceInfo | null | undefined,
  providerSetup: ProviderSetupInfo | null | undefined,
): boolean {
  return Boolean(
    providerSetupNeedsAction(providerSetup) &&
      device?.connected &&
      device?.paired &&
      device.connectionState !== "reconnecting",
  );
}

function deviceConnectionIsOperational(
  device: DeviceInfo | null | undefined,
): boolean {
  return Boolean(device?.connected && (device.deviceId || device.target));
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

function mergeDeviceInfo(
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
    board: next.board ?? current.board,
    firmware: next.firmware ?? current.firmware,
    activeTheme: next.activeTheme ?? current.activeTheme,
    capabilities: mergeDeviceCapabilities(
      current.capabilities,
      next.capabilities,
    ),
    display: mergeDeviceDisplay(current.display, next.display),
    health: next.health ?? current.health,
    stream: next.stream ?? current.stream,
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

function formatTime(): string {
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}
