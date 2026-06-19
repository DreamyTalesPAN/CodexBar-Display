"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hasFirmwareUpdate, type FirmwareUpdateInfo } from "@/lib/firmware";
import type { ThemeCatalogResponse } from "@/lib/themes";
import { ControlCenterShell } from "./control-center-shell";
import type {
  ActiveTab,
  ApiError,
  CompanionInfo,
  CompanionStatus,
  ControlCenterEvent,
  DeviceInfo,
  DeviceState,
  SupportDiagnostics,
} from "./control-center-types";
import { LogsScreen } from "./logs-screen";
import { OverviewScreen } from "./overview-screen";
import { SettingsScreen } from "./settings-screen";
import { ThemeLibraryScreen } from "./theme-library-screen";
import { UpdatesScreen } from "./updates-screen";

const COMPANION_URL = "http://127.0.0.1:47832";
const DEVICE_TARGET_STORAGE_KEY = "vibetv.controlCenter.deviceTarget";

type SettingsResponse = {
  settings?: {
    display?: {
      brightnessPercent?: number;
    };
  };
  device?: DeviceInfo;
};

type InstallResponse = {
  result?: {
    themeId: string;
    packId: string;
    name: string;
    activePath: string;
    themeRev: number;
  };
  logs?: string[];
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
  logs: string[];
  result?: InstallResponse["result"];
  error?: string;
};

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
  const [activeTab, setActiveTab] = useState<ActiveTab>(
    initialThemeId ? "theme-library" : "overview",
  );
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
  const [themeInstallEnabled, setThemeInstallEnabled] = useState(false);
  const [supportDiagnostics, setSupportDiagnostics] =
    useState<SupportDiagnostics | null>(null);
  const didRunInitialConnectionCheck = useRef(false);
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
      const response = await fetch(`${COMPANION_URL}${path}`, {
        ...init,
        headers,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw normalizeError(payload?.error, response.status);
      }
      return payload as T;
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
    } catch {
      markCompanionUnavailable();
    }
  }, [markCompanionUnavailable, runCompanion]);

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
        if (isCompanionMissingError(normalized)) {
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
    [addEvent, markCompanionUnavailable, runCompanion],
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
      if (isCompanionMissingError(normalized)) {
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
      markCompanionUnavailable();
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
    markCompanionUnavailable,
    refreshDevice,
    runCompanion,
  ]);

  const discoverDevice = useCallback(async (targetOverride?: string) => {
    setBusyAction("discover");
    const target = normalizeDeviceTarget(targetOverride || deviceTarget);
    try {
      const payload = await runCompanion<{ device: DeviceInfo }>(
        "/v1/device/discover",
        {
          method: "POST",
          body: target ? JSON.stringify({ target }) : "{}",
        },
      );
      setCompanionStatus("online");
      void refreshCompanionFeatures();
      setDeviceState(payload.device.paired ? "paired" : "online");
      setDevice(payload.device);
      if (payload.device.target) {
        setDeviceTarget(payload.device.target);
        rememberDeviceTarget(payload.device.target);
      }
      addEvent({
        label: "VibeTV found",
        detail: payload.device.connected
          ? "VibeTV is connected."
          : "VibeTV is waiting for signal.",
        tone: payload.device.connected ? "ready" : "unknown",
      });
      if (payload.device.connected) {
        void loadSettings();
      }
    } catch (error) {
      const normalized = normalizeCaughtError(
        error,
        "VibeTV needs attention.",
      );
      if (isCompanionMissingError(normalized)) {
        markCompanionUnavailable();
      } else {
        setCompanionStatus("online");
        void refreshCompanionFeatures();
        setDevice(target ? { target, connected: false } : null);
        setDeviceState("offline");
      }
      setLastError(normalized);
      addEvent({
        label: "VibeTV needs attention",
        detail: normalized.nextAction,
        tone: "attention",
      });
    } finally {
      setBusyAction(null);
    }
  }, [
    addEvent,
    deviceTarget,
    loadSettings,
    markCompanionUnavailable,
    refreshCompanionFeatures,
    runCompanion,
  ]);

  const connectDevice = useCallback(async (targetOverride?: string) => {
    setBusyAction("connect");
    const target = normalizeDeviceTarget(targetOverride || deviceTarget);
    try {
      const discovered = await runCompanion<{ device: DeviceInfo }>(
        "/v1/device/discover",
        {
          method: "POST",
          body: target ? JSON.stringify({ target }) : "{}",
        },
      );
      setCompanionStatus("online");
      void refreshCompanionFeatures();

      let nextDevice = discovered.device;
      const nextTarget = normalizeDeviceTarget(nextDevice.target || target);
      if (nextDevice.connected && !nextDevice.paired) {
        const paired = await runCompanion<{ device: DeviceInfo }>(
          "/v1/device/pair",
          {
            method: "POST",
            body: nextTarget ? JSON.stringify({ target: nextTarget }) : "{}",
          },
        );
        nextDevice = paired.device;
      }

      setDeviceState(
        nextDevice.paired
          ? "paired"
          : nextDevice.connected
            ? "online"
            : "offline",
      );
      setDevice(nextDevice);
      if (nextDevice.target) {
        setDeviceTarget(nextDevice.target);
        rememberDeviceTarget(nextDevice.target);
      }
      addEvent({
        label: nextDevice.paired ? "VibeTV connected" : "VibeTV found",
        detail: nextDevice.connected
          ? "VibeTV is connected."
          : "VibeTV is waiting for signal.",
        tone: nextDevice.connected ? "ready" : "unknown",
      });
      if (nextDevice.connected) {
        void loadSettings();
      }
    } catch (error) {
      const normalized = normalizeCaughtError(
        error,
        "VibeTV connection needs attention.",
      );
      if (isCompanionMissingError(normalized)) {
        markCompanionUnavailable();
      } else {
        setCompanionStatus("online");
        void refreshCompanionFeatures();
        setDevice(target ? { target, connected: false } : null);
        setDeviceState("offline");
      }
      setLastError(normalized);
      addEvent({
        label: "VibeTV connection needs attention",
        detail: normalized.nextAction,
        tone: "attention",
      });
    } finally {
      setBusyAction(null);
    }
  }, [
    addEvent,
    deviceTarget,
    loadSettings,
    markCompanionUnavailable,
    refreshCompanionFeatures,
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
        if (isCompanionMissingError(normalized)) {
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
    [addEvent, markCompanionUnavailable, runCompanion],
  );

  const installTheme = useCallback(async (theme = selectedTheme) => {
    if (!theme) {
      return;
    }
    setBusyAction("install");
    setLastInstall(undefined);
    setSelectedThemeId(theme.themeId);
    const startedAt = formatTime();
    const initialLogs = [
      "Install started.",
      `Theme: ${theme.title}`,
    ];
    setThemeInstallStatus({
      phase: "installing",
      themeId: theme.themeId,
      title: theme.title,
      startedAt,
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
          }),
        },
      );
      setLastInstall(payload.result);
      const finishedAt = formatTime();
      setThemeInstallStatus({
        phase: "complete",
        themeId: theme.themeId,
        title: theme.title,
        startedAt,
        finishedAt,
        logs: [...initialLogs, "Install finished."],
        result: payload.result,
      });
      if (payload.result?.themeId) {
        setDevice((current) =>
          current
            ? { ...current, activeTheme: payload.result?.themeId }
            : current,
        );
      }
      addEvent({
        label: "Theme installed",
        detail: payload.result?.name || theme.title,
        at: finishedAt,
        tone: "ready",
      });
      await loadSettings();
    } catch (error) {
      const normalized = normalizeCaughtError(
        error,
        "Theme install needs attention.",
      );
      if (isCompanionMissingError(normalized)) {
        markCompanionUnavailable();
      }
      setLastError(normalized);
      setThemeInstallStatus({
        phase: "error",
        themeId: theme.themeId,
        title: theme.title,
        startedAt,
        finishedAt: formatTime(),
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
    markCompanionUnavailable,
    runCompanion,
    selectedTheme,
  ]);

  useEffect(() => {
    if (didRunInitialConnectionCheck.current) {
      return;
    }
    didRunInitialConnectionCheck.current = true;

    const timer = window.setTimeout(() => {
      if (deviceTarget) {
        void discoverDevice(deviceTarget);
        return;
      }
      void checkCompanion();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [checkCompanion, deviceTarget, discoverDevice]);

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
          message: "Firmware release check failed.",
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
      markCompanionUnavailable();
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
  }, [addEvent, markCompanionUnavailable, runCompanion]);

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
  const setupComplete = Boolean(
    companionStatus === "online" && device?.connected && device.paired,
  );
  const themeLibraryEnabled = Boolean(
    setupComplete && themeInstallEnabled,
  );
  const disabledTabs: ActiveTab[] = setupComplete
    ? themeLibraryEnabled
      ? []
      : ["theme-library"]
    : ["settings", "theme-library", "updates"];
  const activeShellTab =
    disabledTabs.includes(activeTab)
      ? "overview"
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
      {activeShellTab === "overview" ? (
        <OverviewScreen
          companionStatus={companionStatus}
          device={device}
          deviceState={deviceState}
          lastError={lastError}
          deviceTarget={deviceTarget}
          firmwareUpdate={effectiveFirmwareUpdate}
          busyAction={busyAction}
          onCheckCompanion={checkCompanion}
          onConnectDevice={connectDevice}
          onDeviceTargetChange={handleDeviceTargetChange}
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

function normalizeCaughtError(error: unknown, fallbackMessage: string): ApiError {
  if (error && typeof error === "object" && "code" in error) {
    return error as ApiError;
  }
  if (error instanceof Error) {
    if (isCompanionConnectionError(error)) {
      return {
        code: "COMPANION_UNREACHABLE",
        message: "Mac App is not open.",
        nextAction: "Install or repair the Mac App, open it, then try again.",
      };
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

function isCompanionConnectionError(error: Error): boolean {
  return /failed to fetch|fetch failed|load failed|networkerror/i.test(
    error.message,
  );
}

function isCompanionMissingError(error: ApiError): boolean {
  return error.code === "COMPANION_UNREACHABLE";
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
