"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hasFirmwareUpdate, type FirmwareUpdateInfo } from "@/lib/firmware";
import type { ThemeCatalogResponse } from "@/lib/themes";
import { ControlCenterShell } from "./control-center-shell";
import {
  deviceImageIsStuck,
  deviceSetupIsUsable,
  type ActiveTab,
  type ApiError,
  type CompanionInfo,
  type CompanionStatus,
  type ControlCenterEvent,
  type DeviceInfo,
  type DeviceState,
  type SupportDiagnostics,
} from "./control-center-types";
import { LogsScreen } from "./logs-screen";
import { OverviewScreen } from "./overview-screen";
import { SetupScreen } from "./setup-screen";
import { SettingsScreen } from "./settings-screen";
import { ThemeLibraryScreen } from "./theme-library-screen";
import { UpdatesScreen } from "./updates-screen";

const COMPANION_URL = "http://127.0.0.1:47832";
const DEVICE_TARGET_STORAGE_KEY = "vibetv.controlCenter.deviceTarget";
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
};

type FirmwareUpdateJob = {
  id: string;
  phase: "installing" | "complete" | "error";
  message?: string;
  progress?: number;
  startedAt?: string;
  finishedAt?: string;
  logs?: string[];
  result?: FirmwareUpdateResult;
  error?: ApiError;
};

type FirmwareUpdateStatus = {
  phase: "installing" | "complete" | "error";
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
  options?: { preserveLastError?: boolean },
) => Promise<T>;

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
  const [activeTab, setActiveTab] = useState<ActiveTab>("setup");
  const [companionStatus, setCompanionStatus] =
    useState<CompanionStatus>("unknown");
  const [companionInfo, setCompanionInfo] = useState<CompanionInfo | null>(
    null,
  );
  const [deviceState, setDeviceState] = useState<DeviceState>("unknown");
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
  const setupPreviewStep = useMemo(() => readLocalSetupPreviewStep(), []);
  const [setupResetVersion, setSetupResetVersion] = useState(0);
  const [themeInstallEnabled, setThemeInstallEnabled] = useState(false);
  const [supportDiagnostics, setSupportDiagnostics] =
    useState<SupportDiagnostics | null>(null);
  const didRunInitialConnectionCheck = useRef(false);
  const didRunAutoRepair = useRef(false);
  const didRunAutoDisplayReload = useRef(false);
  const didRouteAfterSetupComplete = useRef(false);
  const lastCompanionRequestAt = useRef(0);
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

  const handleDeviceTargetChange = useCallback((target: string) => {
    setDeviceTarget(target);
    if (target.trim() === "") {
      forgetDeviceTarget();
    }
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
  }, []);

  const markCompanionAccessBlocked = useCallback(() => {
    setCompanionStatus("unknown");
    setCompanionInfo(null);
    setThemeInstallEnabled(false);
    setDevice(null);
    setDeviceState("unknown");
  }, []);

  const handleCompanionUnavailableForRepair = useCallback(
    (quiet: boolean) => {
      const normalized = companionUnavailableError();
      markCompanionUnavailable();
      setActiveTab("setup");
      if (!quiet) {
        setLastError(normalized);
        addEvent({
          label: "Mac App is not running",
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
      if (accessState === "denied") {
        markCompanionAccessBlocked();
        setBusyAction(null);
        setLastError({
          code: "LOCAL_NETWORK_ACCESS_REQUIRED",
          message: "Browser access is blocked.",
          nextAction:
            "Allow local network access for this site, then try again.",
        });
        return;
      }
      markCompanionUnavailable();
      setBusyAction(null);
      setLastError({
        code: "COMPANION_UNREACHABLE",
        message: "Mac App is not open.",
        nextAction: "Install or repair the Mac App, open it, then try again.",
      });
    }

    function isRecentCompanionRequest() {
      return Date.now() - lastCompanionRequestAt.current <
        RECENT_COMPANION_REQUEST_MS;
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
      options?: { preserveLastError?: boolean },
    ): Promise<T> => {
      if (!options?.preserveLastError) {
        setLastError(null);
      }
      const headers = new Headers(init?.headers);
      if (init?.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
      const useLocalProxy = shouldUseLocalCompanionProxy();
      const requestInit: LocalNetworkRequestInit = {
        ...init,
        headers,
      };
      if (!useLocalProxy) {
        requestInit.targetAddressSpace = "loopback";
      }
      lastCompanionRequestAt.current = Date.now();
      try {
        const response = await fetch(
          companionRequestUrl(path, useLocalProxy),
          requestInit,
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.ok === false) {
          throw normalizeError(payload?.error, response.status);
        }
        return payload as T;
      } catch (error) {
        if (error instanceof Error && isCompanionConnectionError(error)) {
          const accessState = await readLocalNetworkAccessState();
          if (accessState === "denied") {
            throw {
              code: "LOCAL_NETWORK_ACCESS_REQUIRED",
              message: "Browser access is blocked.",
              nextAction:
                "Allow local network access for this site, then try again.",
            } satisfies ApiError;
          }
        }
        throw error;
      }
    },
    [],
  );

  const refreshCompanionFeatures = useCallback(async () => {
    try {
      const payload = await runCompanion<{
        companion?: CompanionInfo;
      }>("/v1/status", undefined, { preserveLastError: true });
      setCompanionStatus("online");
      setCompanionInfo(payload.companion || null);
      setThemeInstallEnabled(
        Boolean(payload.companion?.features?.themeInstallEnabled),
      );
    } catch (error) {
      const normalized = normalizeCaughtError(error, "Mac App needs attention.");
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
        setDevice(payload.device);
        if (payload.device.target) {
          setDeviceTarget(payload.device.target);
          rememberDeviceTarget(payload.device.target);
        }
        setDeviceState(payload.device.paired ? "paired" : "online");
        if (!quiet) {
          addEvent({
            label: "VibeTV checked",
            detail: payload.device.connected
              ? "VibeTV is connected."
              : "VibeTV is waiting for signal.",
            tone: payload.device.connected ? "ready" : "attention",
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
        setDevice(payload.device);
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
    runCompanion,
  ]);

  const checkCompanion = useCallback(async (options?: { quiet?: boolean }) => {
    const quiet = Boolean(options?.quiet);
    if (!quiet) {
      setBusyAction("status");
    }
    try {
      const payload = await runCompanion<{
        companion?: CompanionInfo;
        device?: DeviceInfo;
      }>("/v1/status", undefined, { preserveLastError: quiet });
      const checkedAt = formatTime();
      const wasMissing = companionStatus === "missing";
      setCompanionStatus("online");
      setCompanionInfo(payload.companion || null);
      setLastError(null);
      setThemeInstallEnabled(
        Boolean(payload.companion?.features?.themeInstallEnabled),
      );
      if (payload.device?.target) {
        setDevice(payload.device);
        setDeviceTarget(payload.device.target);
        rememberDeviceTarget(payload.device.target);
        setDeviceState(
          payload.device.paired
            ? "paired"
            : payload.device.connected
              ? "online"
              : "unknown",
        );
        const refreshed = await refreshDevice({ quiet: true });
        if (refreshed?.connected) {
          void loadSettings();
        }
      } else {
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
      const normalized = normalizeCaughtError(error, "Mac App needs attention.");
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
      if (!quiet) {
        setBusyAction(null);
      }
    }
  }, [
    addEvent,
    companionStatus,
    loadSettings,
    markCompanionAccessBlocked,
    markCompanionUnavailable,
    refreshDevice,
    runCompanion,
  ]);

  const repairConnection = useCallback(
    async (options?: {
      targetOverride?: string;
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
          return;
        }
        if (companionStatus !== "online") {
          try {
            const statusPayload = await runCompanion<{
              companion?: CompanionInfo;
              device?: DeviceInfo;
            }>("/v1/status", undefined, { preserveLastError: quiet });
            setCompanionStatus("online");
            setCompanionInfo(statusPayload.companion || null);
            setThemeInstallEnabled(
              Boolean(statusPayload.companion?.features?.themeInstallEnabled),
            );
            if (statusPayload.device?.target) {
              setDevice(statusPayload.device);
              setDeviceTarget(statusPayload.device.target);
              rememberDeviceTarget(statusPayload.device.target);
              setDeviceState(
                statusPayload.device.paired
                  ? "paired"
                  : statusPayload.device.connected
                    ? "online"
                    : "unknown",
              );
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
            return;
          }
        }
        const payload = await runCompanion<{ device: DeviceInfo }>(
          "/v1/device/repair",
          {
            method: "POST",
            body: JSON.stringify({
              ...(target ? { target } : {}),
              ...(options?.forcePair ? { forcePair: true } : {}),
            }),
          },
          { preserveLastError: quiet },
        );
        setCompanionStatus("online");
        void refreshCompanionFeatures();
        setLastError(null);
        setDevice(payload.device);
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
        addEvent({
          label: quiet ? "Connection repaired" : "VibeTV connection fixed",
          detail: payload.device.connected
            ? "VibeTV is connected."
            : "VibeTV is waiting for signal.",
          tone: payload.device.connected ? "ready" : "attention",
        });
        if (payload.device.connected) {
          void loadSettings();
        }
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
      refreshCompanionFeatures,
      runCompanion,
    ],
  );

  const reloadDisplay = useCallback(
    async (options?: { quiet?: boolean }) => {
      const quiet = Boolean(options?.quiet);
      setBusyAction("reload-display");
      try {
        const payload = await runCompanion<{ device: DeviceInfo }>(
          "/v1/device/reload-display",
          { method: "POST" },
          { preserveLastError: quiet },
        );
        setCompanionStatus("online");
        setLastError(null);
        setDevice(payload.device);
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
        const normalized = normalizeCaughtError(
          error,
          "Image reload failed.",
        );
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
    setBrightness(null);
    setLastInstall(undefined);
    setThemeInstallStatus(null);
    setSupportDiagnostics(null);
    setFirmwareUpdate(null);
    didRunAutoRepair.current = false;
    didRunAutoDisplayReload.current = false;
    didRouteAfterSetupComplete.current = false;
    setActiveTab("setup");
    try {
      const payload = await runCompanion<{
        companion?: CompanionInfo;
        device?: DeviceInfo;
      }>("/v1/setup/reset", { method: "POST" });
      setCompanionStatus("online");
      setCompanionInfo(payload.companion || null);
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
          setDevice(payload.device);
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
      runCompanion,
    ],
  );

  const installTheme = useCallback(async (theme = selectedTheme) => {
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
          phase === "complete" || phase === "error" ? formatTime() : undefined,
        message:
          job.message ||
          logs[logs.length - 1] ||
          "Preparing theme install.",
        progress: clampProgress(job.progress),
        logs,
        result: job.result,
        error: job.error?.nextAction,
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
            packUrl: theme.packUrl,
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
          current
            ? { ...current, activeTheme: result.themeId }
            : current,
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
        error: normalized.nextAction,
      });
      addEvent({
        label: "Theme install needs attention",
        detail: normalized.nextAction,
        tone: "attention",
      });
    } finally {
      setBusyAction(null);
    }
  }, [
    addEvent,
    loadSettings,
    markCompanionAccessBlocked,
    markCompanionUnavailable,
    runCompanion,
    selectedTheme,
  ]);

  useEffect(() => {
    if (setupPreviewStep) {
      return;
    }
    if (didRunInitialConnectionCheck.current) {
      return;
    }
    didRunInitialConnectionCheck.current = true;

    const timer = window.setTimeout(() => {
      void checkCompanion();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [checkCompanion, setupPreviewStep]);

  useEffect(() => {
    if (
      setupPreviewStep ||
      didRunAutoRepair.current ||
      busyAction ||
      companionStatus !== "online" ||
      !device?.target ||
      deviceSetupIsUsable(device) ||
      isLocalNetworkAccessError(lastError)
    ) {
      return;
	}
	didRunAutoRepair.current = true;
	void repairConnection({ forcePair: true, quiet: true });
  }, [
    busyAction,
    companionStatus,
    device,
    lastError,
    repairConnection,
    setupPreviewStep,
  ]);

  useEffect(() => {
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
    reloadDisplay,
    setupPreviewStep,
  ]);

  useEffect(() => {
    if (companionStatus !== "missing") {
      return;
    }

    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden" || busyAction) {
        return;
      }
      void checkCompanion({ quiet: true });
    }, 5000);

    return () => window.clearInterval(timer);
  }, [busyAction, checkCompanion, companionStatus]);

  const deviceBoard = device?.board;
  const deviceFirmware = device?.firmware;

  const refreshFirmwareUpdate = useCallback(
    async (signal?: AbortSignal) => {
      if (!deviceBoard || !deviceFirmware) {
        setFirmwareUpdate(null);
        return;
      }

      const params = new URLSearchParams({
        board: deviceBoard,
        firmware: deviceFirmware,
      });

      try {
        const response = await fetch(`/api/firmware/latest?${params.toString()}`, {
          signal,
        });
        if (!response.ok) {
          throw new Error(`firmware check failed: ${response.status}`);
        }
        setFirmwareUpdate((await response.json()) as FirmwareUpdateInfo);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setFirmwareUpdate({
          checkedAt: new Date().toISOString(),
          installedFirmware: deviceFirmware,
          updateAvailable: false,
          status: "check_failed",
          message: "Firmware check failed.",
        });
      }
    },
    [deviceBoard, deviceFirmware],
  );

  const checkFirmwareUpdates = useCallback(async () => {
    setBusyAction("firmware-check");
    try {
      await refreshFirmwareUpdate();
    } finally {
      setBusyAction(null);
    }
  }, [refreshFirmwareUpdate]);

  const installFirmwareUpdate = useCallback(async () => {
    const startedAt = formatTime();
    const initialLogs = ["Preparing VibeTV update."];
    const applyUpdateJob = (job: FirmwareUpdateJob) => {
      const phase =
        job.phase === "complete"
          ? "complete"
          : job.phase === "error"
            ? "error"
            : "installing";
      const logs = customerUpdateLogs(job.logs, initialLogs);
      setFirmwareUpdateStatus({
        phase,
        startedAt,
        finishedAt:
          phase === "complete" || phase === "error" ? formatTime() : undefined,
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
      const logs = customerUpdateLogs(finishedJob.logs, initialLogs);
      const finishedAt = formatTime();
      setFirmwareUpdateStatus({
        phase: "complete",
        startedAt,
        finishedAt,
        message: "Update complete.",
        progress: 100,
        logs: customerUpdateLogs([...logs, "Update complete."]),
        result: finishedJob.result,
      });
      addEvent({
        label: "VibeTV updated",
        detail: finishedJob.result?.firmware
          ? `Firmware ${finishedJob.result.firmware} is installed.`
          : "Update complete.",
        at: finishedAt,
        tone: "ready",
      });
      await refreshDevice({ quiet: true });
      await refreshFirmwareUpdate();
    } catch (error) {
      const normalized = normalizeCaughtError(
        error,
        "VibeTV update failed.",
      );
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
      });
      addEvent({
        label: "VibeTV update failed",
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
    refreshDevice,
    refreshFirmwareUpdate,
    runCompanion,
  ]);

  const loadSupportDiagnostics = useCallback(async () => {
    setBusyAction("diagnostics");
    try {
      const payload =
        await runCompanion<SupportDiagnostics>("/v1/diagnostics");
      setSupportDiagnostics(payload);
      setCompanionStatus("online");
      setCompanionInfo(payload.companion || null);
      setThemeInstallEnabled(
        Boolean(payload.companion?.features?.themeInstallEnabled),
      );
      if (payload.device) {
        setDevice(payload.device);
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
      const normalized = normalizeCaughtError(
        error,
        "Support report failed.",
      );
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
    runCompanion,
  ]);

  useEffect(() => {
    if (!deviceBoard || !deviceFirmware) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void refreshFirmwareUpdate(controller.signal);
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
  const imageNeedsReload = deviceImageIsStuck(device);
  const setupComplete = Boolean(
    !setupPreviewStep &&
      companionStatus === "online" &&
      deviceSetupIsUsable(device),
  );
  useEffect(() => {
    if (!setupComplete || didRouteAfterSetupComplete.current) {
      return;
    }
    didRouteAfterSetupComplete.current = true;
    setActiveTab(initialThemeId ? "theme-library" : "overview");
  }, [initialThemeId, setupComplete]);

  const disabledTabs: ActiveTab[] = setupComplete
    ? imageNeedsReload
      ? ["settings", "theme-library", "updates"]
      : []
    : ["overview", "settings", "theme-library", "updates", "logs"];
  const activeShellTab = disabledTabs.includes(activeTab)
    ? setupComplete
      ? "overview"
      : "setup"
    : activeTab;

  return (
    <ControlCenterShell
      activeTab={activeShellTab}
      disabledTabs={disabledTabs}
      device={device}
      firmwareUpdateAvailable={firmwareUpdateAvailable}
      onTabChange={(tab) => {
        if (disabledTabs.includes(tab)) {
          return;
        }
        setActiveTab(tab);
      }}
    >
      {activeShellTab === "setup" ? (
        <SetupScreen
          key={setupResetVersion}
          companionStatus={companionStatus}
          device={device}
          deviceState={deviceState}
          deviceTarget={deviceTarget}
          lastError={lastError}
          busyAction={busyAction}
          previewStep={setupPreviewStep}
          setupComplete={setupComplete}
          onCheckCompanion={checkCompanion}
          onDeviceTargetChange={handleDeviceTargetChange}
          onRepairConnection={(targetOverride) =>
            repairConnection({ targetOverride, forcePair: true })
          }
          onResetSetup={resetSetup}
        />
      ) : null}

      {activeShellTab === "overview" ? (
        <OverviewScreen
          busyAction={busyAction}
          companionStatus={companionStatus}
          device={device}
          deviceState={deviceState}
          firmwareUpdate={effectiveFirmwareUpdate}
          onReloadImage={() => reloadDisplay()}
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
          companionStatus={companionStatus}
          companionVersion={companionInfo?.version}
          device={device}
          firmwareUpdate={effectiveFirmwareUpdate}
          onCheckUpdates={checkFirmwareUpdates}
          onCreateReport={() => {
            setActiveTab("logs");
            void loadSupportDiagnostics();
          }}
          onInstallUpdate={installFirmwareUpdate}
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

function normalizeCaughtError(error: unknown, fallbackMessage: string): ApiError {
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
    nextAction: "Open the Mac App, then connect VibeTV.",
  };
}

function companionUnavailableError(): ApiError {
  return {
    code: "COMPANION_UNREACHABLE",
    message: "Mac App is not running.",
    nextAction:
      "Run Agentic setup again, then click Mac App is installed.",
  };
}

function isCompanionConnectionError(error: Error): boolean {
  return /failed to fetch|fetch failed|load failed|networkerror|connection refused|err_connection_refused|couldn'?t connect/i.test(
    error.message,
  );
}

function companionRequestUrl(path: string, useLocalProxy: boolean): string {
  if (!useLocalProxy) {
    return `${COMPANION_URL}${path}`;
  }
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  return `/api/local-companion/${normalizedPath}`;
}

function shouldUseLocalCompanionProxy(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return ["127.0.0.1", "localhost", "::1"].includes(window.location.hostname);
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
