"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ItemSeparator } from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SetupStepFailedDialog } from "./setup/setup-provider-dialogs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { installedScreensaver } from "@/lib/active-theme-upgrade";
import { errorForHost } from "@/lib/customer-platform";
import { cn } from "@/lib/utils";
import { loadUserThemes } from "@/lib/theme-studio-storage";
import type { ThemeProduct } from "@/lib/themes";
import { PreferenceControl } from "./preference-control";
import { ThemeStudioKeyRow } from "./theme-studio/openai-key-form";
import { isProviderItem, type ProviderPickerProps } from "./provider-picker";
import {
  ProviderList,
  setupProviderCanDisplay,
} from "./setup/setup-providers-screen";
import {
  deviceCanSwitchToCable,
  deviceIsCustomerConnected,
  deviceIsReady,
  deviceOffersCable,
  type ApiError,
  type DeviceInfo,
  type PreferenceDescriptor,
  type PreferenceValue,
  type StandbySettings,
} from "./control-center-types";

const standbyTimeoutOptions = [1, 5, 10, 15, 30, 60];

export function standbyTimeoutLabel(minutes: number): string {
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

export type SettingsScreenProps = {
  device: DeviceInfo | null;
  /** Display preferences listed by the companion; unsupported choices are absent. */
  displayPreferences?: PreferenceDescriptor[];
  brightness: number | null;
  busyAction: string | null;
  actionError?: ApiError | null;
  onDismissError: () => void;
  connectionMode: "cable" | "wifi";
  standby: StandbySettings | null;
  onBrightnessChange: (value: number) => void;
  onChooseScreensaver: () => void;
  onConnectionModeChange: (mode: "cable" | "wifi") => void;
  onDisplayPreferenceChange?: (
    item: PreferenceDescriptor,
    value: PreferenceValue,
  ) => void | Promise<void>;
  onResetSetup: () => void;
  /** Erases the VibeTV over the USB cable, then starts setup again. */
  onEraseDevice?: () => void;
  /** Opens Support and runs diagnostics there. */
  onSaveBrightness: (value: number) => void;
  providerPicker: ProviderPickerProps;
  /**
   * The app's global shortcut for the next provider, or that the system
   * refused its keys. Null in a browser, which has no such shortcut.
   */
  providerShortcut?: "available" | "unavailable" | null;
  onSaveStandby: (value: StandbySettings) => void;
  onStandbyBrightnessChange: (value: number) => void;
  /** The catalog, to name the screensaver VibeTV has installed. */
  themes?: ThemeProduct[];
  /** The app runs on Windows; the Mac wording stays exactly as it is. */
  windowsHost?: boolean;
};

/** The keys the Windows App and the Mac App register (issue #424). */
export function providerShortcutKeys(windowsHost: boolean): string {
  return windowsHost ? "Ctrl+Alt+Shift+P" : "⌃⌥⌘P";
}

export function SettingsScreen({
  device,
  displayPreferences = [],
  brightness,
  busyAction,
  actionError,
  onDismissError,
  connectionMode,
  standby,
  onBrightnessChange,
  onChooseScreensaver,
  onConnectionModeChange,
  onDisplayPreferenceChange,
  onResetSetup,
  onEraseDevice,
  onSaveBrightness,
  providerPicker,
  providerShortcut = null,
  onSaveStandby,
  onStandbyBrightnessChange,
  themes = [],
  windowsHost = false,
}: SettingsScreenProps) {
  const thisHost = windowsHost ? "this computer" : "this Mac";
  const shortcutKeys = providerShortcutKeys(windowsHost);
  const [requestedMode, setRequestedMode] = useState<"cable" | "wifi" | null>(null);
  const [eraseRequested, setEraseRequested] = useState(false);
  const brightnessSupport =
    device?.capabilities?.display?.brightness?.supported ?? true;
  const minBrightness =
    device?.capabilities?.display?.brightness?.minPercent ?? 10;
  const maxBrightness =
    device?.capabilities?.display?.brightness?.maxPercent ?? 100;
  const currentBrightness = brightness ?? minBrightness;
  // Saving brightness, the screensaver or the display mode closes nothing
  // here: a control that closes during its own save drops keyboard focus to
  // the page, and the next arrow key goes nowhere (issue #558). The app sends
  // these writes one after the other, so the next change can follow at once.
  const localActionBusy =
    busyAction === "connection-mode" ||
    busyAction === "reset-setup" ||
    busyAction === "erase-device" ||
    busyAction === "firmware-update";
  // Firmware that does not advertise standby has no screensaver at all, so the
  // whole block stays hidden instead of showing controls that cannot work.
  const standbySupport = device?.capabilities?.standby?.supported === true;
  const standbyValues: StandbySettings = standby ?? {
    enabled: false,
    timeoutMinutes: 10,
    brightnessPercent: 20,
  };
  // Not open before VibeTV's own value is read: until then the placeholder
  // values above stand here, and a save would write them over the customer's
  // own time and brightness (issue #643).
  const standbyToggleDisabled =
    !standby || !deviceIsCustomerConnected(device) || localActionBusy;
  const standbyDetailsDisabled =
    standbyToggleDisabled || !standbyValues.enabled;
  // The customer's own screensavers are saved in this browser, by Theme Studio.
  const [ownThemes] = useState(() => {
    const saved = loadUserThemes();
    return saved.ok ? saved.value.themes : saved.data?.themes || [];
  });
  const screensaverPath = device?.standby?.screensaverPath?.trim();
  const screensaver = useMemo(
    () => installedScreensaver(themes, ownThemes, screensaverPath),
    [ownThemes, screensaverPath, themes],
  );
  // Which screensaver the switch shows, said only while it is on and VibeTV
  // reports its slot. A path that no listed or saved screensaver has is still
  // a screensaver, in the word the Themes list uses for the customer's own.
  const screensaverLine =
    !standbyValues.enabled || !device?.standby
      ? null
      : !screensaverPath
        ? "No screensaver is installed yet."
        : `${screensaver?.title ?? "A custom screensaver"} is installed.`;
  const supportedTransports = device?.capabilities?.transport?.supported;
  const cableSupported =
    connectionMode === "cable" || deviceOffersCable(device);
  const wifiSupported =
    !supportedTransports || supportedTransports.includes("wifi");
  const connectionModeDisabled =
    (!deviceIsCustomerConnected(device) && !deviceCanSwitchToCable(device)) ||
    localActionBusy;

  // Every provider CodexBar reports is listed, on Windows as on the Mac.
  const providers = (providerPicker.items || []).filter(isProviderItem);
  // Manual pins the device to exactly one provider, so it may only offer ones
  // that can actually produce a reading. Offering every switched-on provider,
  // as the design board's wording does, lets a customer pin VibeTV to a
  // provider that shows nothing.
  const displayable = providers.filter((provider) =>
    setupProviderCanDisplay(provider, providerPicker.usage),
  );
  const enabledProviderIds = providers
    .filter((item) => item.value)
    .map((item) => item.providerId);
  const currentProviderId = providerPicker.display?.providerIds[0];
  const manualProviderId = displayable.some(
    (item) => item.providerId === currentProviderId,
  )
    ? currentProviderId
    : displayable[0]?.providerId;
  const displayMode = providerPicker.display?.mode ?? "automatic";
  const providerError =
    providerPicker.preferencesError || providerPicker.displayError;
  const usageMode = displayPreferences.find(
    (item) => item.id === "codexbar.usageBarsShowUsed",
  );
  const rotation = displayPreferences.find(
    (item) => item.id === "vibetv.display.rotateSeconds",
  );
  const selectMode = (mode: "automatic" | "fixed") =>
    void providerPicker.onDisplayChange(
      {
        mode,
        providerIds:
          mode === "automatic"
            ? enabledProviderIds
            : manualProviderId
              ? [manualProviderId]
              : [],
      },
      manualProviderId ?? enabledProviderIds[0] ?? "",
    );

  return (
    <div className="mx-auto w-full max-w-[1040px] pt-6 pb-10">
      <SetupStepFailedDialog
        error={actionError ?? errorForHost(providerError, windowsHost)}
        onOpenChange={(open) => !open && onDismissError()}
      />
      <SettingsSection id="settings-display-mode" title="Display mode" topAligned>
        {providerPicker.displayNotice ? (
          <p className="text-[13px] text-muted-foreground" role="status">
            {providerPicker.displayNotice}
          </p>
        ) : null}
        <div
          aria-label="Display mode"
          className="flex flex-col gap-4"
          role="group"
        >
          <RadioRow
            description={
              rotation && rotation.value !== "0"
                ? "VibeTV switches between your providers on a timer."
                : "VibeTV switches between your providers based on recent activity and usage."
            }
            label="Automatic"
            onSelect={() => selectMode("automatic")}
            selected={displayMode === "automatic"}
          />
          {displayMode === "automatic" && rotation ? (
            <div className="mt-2">
              <PreferenceRow
                descriptor={rotation}
                disabled={localActionBusy}
                onChange={onDisplayPreferenceChange}
              />
            </div>
          ) : null}
          <RadioRow
            description="VibeTV always shows the one provider you pick — nothing else."
            label="Manual"
            onSelect={() => selectMode("fixed")}
            selected={displayMode === "fixed"}
          />
          {displayMode === "fixed" ? (
            <div className="mt-2">
            <SettingRow htmlFor="vibetv-manual-provider" label="Show this provider">
              <Select
                onValueChange={(providerId) =>
                  void providerPicker.onDisplayChange(
                    { mode: "fixed", providerIds: [providerId] },
                    providerId,
                  )
                }
                value={currentProviderId ?? ""}
              >
                <SelectTrigger
                  aria-label="Show this provider"
                  className="w-full data-[size=default]:h-9"
                  id="vibetv-manual-provider"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {displayable.map((item) => (
                    <SelectItem key={item.providerId} value={item.providerId}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>
            </div>
          ) : null}
        </div>
        {providerShortcut ? (
          <p className="-mt-1 text-[13px] text-muted-foreground">
            {providerShortcut === "available"
              ? // What a press does now (issue #558): it moves between the
                // providers Manual offers, so one of them leaves nothing to
                // show next, and Manual cannot be switched to twice. Until
                // usage has been read, neither is known and neither is said.
                `Press ${shortcutKeys} in any app to show the next provider.${
                  !providerPicker.usage
                    ? ""
                    : displayable.length < 2
                      ? " This needs two providers with usage."
                      : displayMode === "fixed"
                        ? ""
                        : " This switches to Manual."
                }`
              : `The shortcut ${shortcutKeys} for the next provider is not available: another app may already be using these keys.`}
          </p>
        ) : null}
      </SettingsSection>

      {usageMode ? (
        <>
          <ItemSeparator className="my-0" />
          <SettingsSection id="settings-usage-mode" title="Usage mode">
            <PreferenceRow
              descriptor={usageMode}
              disabled={localActionBusy}
              onChange={onDisplayPreferenceChange}
            />
          </SettingsSection>
        </>
      ) : null}
      <ItemSeparator className="my-0" />

      <SettingsSection id="settings-display" title="Brightness">
        <BrightnessControl
          disabled={
            !brightnessSupport ||
            !deviceIsReady(device) ||
            brightness == null ||
            localActionBusy
          }
          id="vibetv-brightness"
          label="Brightness"
          labelled={false}
          max={maxBrightness}
          min={minBrightness}
          onSave={onSaveBrightness}
          onValueChange={onBrightnessChange}
          value={currentBrightness}
          valueLabel={
            !brightnessSupport
              ? "Not supported"
              : brightness == null
                ? "Loading"
                : `${brightness}%`
          }
        />
      </SettingsSection>

      {standbySupport ? (
        <>
          <ItemSeparator className="my-0" />
          <SettingsSection id="settings-screensaver" title="Screensaver">
            <SettingRow
              disabled={standbyToggleDisabled}
              htmlFor="vibetv-standby"
              label="Show screensaver"
            >
              <Switch
                aria-label="Show screensaver"
                checked={standbyValues.enabled}
                disabled={standbyToggleDisabled}
                id="vibetv-standby"
                onCheckedChange={(enabled) =>
                  onSaveStandby({ ...standbyValues, enabled })
                }
              />
            </SettingRow>
            <SettingRow
              disabled={standbyDetailsDisabled}
              htmlFor="vibetv-standby-timeout"
              label="Show after"
            >
              <Select
                disabled={standbyDetailsDisabled}
                onValueChange={(value) =>
                  onSaveStandby({
                    ...standbyValues,
                    timeoutMinutes: Number(value),
                  })
                }
                value={String(standbyValues.timeoutMinutes)}
              >
                <SelectTrigger
                  aria-label="Show after"
                  className="w-full data-[size=default]:h-9"
                  id="vibetv-standby-timeout"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {standbyTimeoutOptions.map((minutes) => (
                    <SelectItem key={minutes} value={String(minutes)}>
                      {/* Says what the minutes count (issue #558). */}
                      {standbyTimeoutLabel(minutes)} without AI usage
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>
            <BrightnessControl
              disabled={standbyDetailsDisabled}
              id="vibetv-standby-brightness"
              label="Brightness in screensaver"
              labelled
              max={maxBrightness}
              min={minBrightness}
              onSave={(brightnessPercent) =>
                onSaveStandby({ ...standbyValues, brightnessPercent })
              }
              onValueChange={onStandbyBrightnessChange}
              value={standbyValues.brightnessPercent}
              valueLabel={`${standbyValues.brightnessPercent}%`}
            />
            <div className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-2">
              <span aria-hidden className="w-[190px] shrink-0" />
              <div className="flex min-w-[160px] flex-1 flex-wrap items-center gap-x-2">
                <a
                  aria-disabled={standbyDetailsDisabled}
                  className={
                    standbyDetailsDisabled
                      ? "pointer-events-none inline-block text-[13px] font-normal text-foreground underline underline-offset-4 opacity-50"
                      : "inline-block text-[13px] font-normal text-foreground underline underline-offset-4 hover:text-[var(--vibetv-support)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  }
                  href="#screensavers"
                  onClick={(event) => {
                    event.preventDefault();
                    if (!standbyDetailsDisabled) {
                      onChooseScreensaver();
                    }
                  }}
                  tabIndex={standbyDetailsDisabled ? -1 : undefined}
                >
                  Choose screensaver
                </a>
                {screensaverLine ? (
                  <span className="text-[13px] text-muted-foreground">
                    {screensaverLine}
                  </span>
                ) : null}
              </div>
            </div>
          </SettingsSection>
        </>
      ) : null}

      <ItemSeparator className="my-0" />

      <SettingsSection title="Connection" topAligned>
        <div
          aria-label="Connection mode"
          aria-busy={busyAction === "connection-mode"}
          className="flex flex-col gap-4"
          role="group"
        >
          {([
            { mode: "cable", label: "USB-C", description: `Requires a data cable connected to ${thisHost}.`, supported: cableSupported },
            { mode: "wifi", label: "WiFi", description: "No cable needed — VibeTV can sit anywhere on your desk.", supported: wifiSupported },
          ] as const).map(({ mode, label, description, supported }) => (
            <RadioRow
              description={description}
              disabled={connectionModeDisabled || !supported}
              key={mode}
              label={label}
              onSelect={() => {
                if (mode !== connectionMode) setRequestedMode(mode);
              }}
              selected={connectionMode === mode}
            />
          ))}
        </div>
        {requestedMode !== null ? <Dialog
          open
          onOpenChange={(open) => { if (!open) setRequestedMode(null); }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{requestedMode === "cable" ? "Switch to USB-C?" : "Switch to WiFi?"}</DialogTitle>
              <DialogDescription>
                {requestedMode === "cable"
                  ? `Connect VibeTV to ${thisHost} with a data cable. WiFi stays on until the app confirms the cable connection. Your saved network, themes, providers and brightness stay saved.`
                  : "VibeTV connects to your saved WiFi network. If network details are needed, WiFi setup opens. Themes, providers and brightness stay saved."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => setRequestedMode(null)} type="button" variant="ghost">
                {requestedMode === "cable" ? "Keep WiFi" : "Keep USB-C"}
              </Button>
              <Button
                disabled={connectionModeDisabled}
                onClick={() => {
                  if (requestedMode && requestedMode !== connectionMode) onConnectionModeChange(requestedMode);
                  setRequestedMode(null);
                }}
                type="button"
              >
                {requestedMode === "cable" ? "Switch to USB-C" : "Switch to WiFi"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog> : null}
      </SettingsSection>

      <ItemSeparator className="my-0" />

      <SettingsSection title="Setup">
        {/* Each action sits beside its own line: one line beside both
            explained only the first (issue #579). */}
        <div className="flex items-center justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-[13px] font-semibold">Run setup again</p>
            <p className="text-[13px] text-muted-foreground" id="vibetv-run-setup-help">
              Connect {thisHost} to another VibeTV.
            </p>
          </div>
          <Button
            aria-describedby="vibetv-run-setup-help"
            className="shrink-0 px-3.5"
            disabled={localActionBusy}
            onClick={onResetSetup}
            size="sm"
            type="button"
            variant="outline"
          >
            {busyAction === "reset-setup" ? (
              <Spinner data-icon="inline-start" />
            ) : null}
            <span>
              {busyAction === "reset-setup" ? "Resetting" : "Run setup"}
            </span>
          </Button>
        </div>
        {onEraseDevice && connectionMode === "cable" ? (
          <div className="-mt-1 flex items-center justify-between gap-6 border-t border-foreground/10 pt-4">
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-[13px] font-semibold">Factory reset</p>
              <p className="text-[13px] text-muted-foreground" id="vibetv-factory-reset-help">
                VibeTV forgets its WiFi details, pairing, settings and themes.
              </p>
            </div>
            <Button
              aria-describedby="vibetv-factory-reset-help"
              className="shrink-0 px-3.5 text-[oklch(0.55_0.19_27)]"
              disabled={localActionBusy || !deviceIsCustomerConnected(device)}
              onClick={() => setEraseRequested(true)}
              size="sm"
              type="button"
              variant="outline"
            >
              {busyAction === "erase-device" ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              <span>
                {busyAction === "erase-device" ? "Resetting" : "Reset…"}
              </span>
            </Button>
          </div>
        ) : null}
        {eraseRequested ? (
          <Dialog
            open
            onOpenChange={(open) => {
              if (!open) setEraseRequested(false);
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Reset VibeTV to factory settings?</DialogTitle>
                <DialogDescription>
                  VibeTV forgets its WiFi details, pairing, settings and themes, then setup starts again. Use this before you give VibeTV away.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button onClick={() => setEraseRequested(false)} type="button" variant="ghost">
                  Cancel
                </Button>
                <Button
                  disabled={localActionBusy}
                  onClick={() => {
                    setEraseRequested(false);
                    onEraseDevice?.();
                  }}
                  type="button"
                >
                  Reset
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      </SettingsSection>

      <ItemSeparator className="my-0" />

      <SettingsSection title="Theme Studio AI">
        <ThemeStudioKeyRow />
      </SettingsSection>

      <ItemSeparator className="my-0" />

      <SettingsSection title="AI providers">
        <ProviderList
          // The design's Settings list: 40 px search, 48 px rows, "Show more" at the left edge.
          className="[&_[data-slot=item-group]]:mt-4 [&_[data-slot=item]]:h-12 [&_[data-slot=item]]:py-0 [&_input]:h-10 [&>button:last-child]:mt-4 [&>button:last-child]:self-start [&>button:last-child]:px-0"
          onCheckAgain={(provider) => void providerPicker.onCheck(provider)}
          onOpenSignIn={
            providerPicker.onOpenSignIn
              ? (provider) => void providerPicker.onOpenSignIn?.(provider)
              : undefined
          }
          onOpenSetupGuide={
            providerPicker.onOpenSetupGuide
              ? () => void providerPicker.onOpenSetupGuide?.()
              : undefined
          }
          onToggle={(provider, enabled) =>
            void providerPicker.onPreferenceChange(provider, enabled)
          }
          usage={providerPicker.usage}
          pendingCheckIds={providerPicker.pendingCheckIds}
          pendingPreferenceIds={providerPicker.pendingPreferenceIds}
          providers={providers}
          showIntro={false}
        />
      </SettingsSection>
    </div>
  );
}

/**
 * One settings group: its name in a fixed left column, its controls in the
 * right one. The label column is capped rather than fixed so the control
 * column keeps its width at the tablet breakpoint, where a hard 240px track
 * leaves too little for the display-mode cards.
 */
function SettingsSection({
  children,
  id,
  title,
  topAligned = false,
}: {
  children: ReactNode;
  /** For a link that opens Settings at this group ("What's new", Screensavers). */
  id?: string;
  title: string;
  /** The first control is a radio list, not a 36 px row: the name sits level with its top. */
  topAligned?: boolean;
}) {
  return (
    <section id={id} className="grid grid-cols-1 items-start gap-5 py-8 md:grid-cols-[minmax(0,240px)_minmax(0,560px)] md:gap-10">
      <div className="min-w-0">
        {/* Padded to the centre of the first control row. */}
        <h2 className={cn("text-[13px] leading-5 font-semibold", !topAligned && "pt-2")}>
          {title}
        </h2>
      </div>
      <div className="flex min-w-0 flex-col gap-5">{children}</div>
    </section>
  );
}

/**
 * One setting inside a section: its name in a fixed muted column, its control
 * beside it. The control is passed in, so the name keeps its label association.
 */
function SettingRow({
  children,
  disabled = false,
  htmlFor,
  label,
}: {
  children: ReactNode;
  disabled?: boolean;
  htmlFor: string;
  label: string;
}) {
  return (
    <div
      className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-2"
      data-disabled={disabled}
    >
      <Label
        className={cn(
          "w-[190px] shrink-0 font-normal text-muted-foreground",
          disabled && "opacity-50",
        )}
        htmlFor={htmlFor}
      >
        {label}
      </Label>
      <div className="flex min-w-[160px] flex-1 items-center">{children}</div>
    </div>
  );
}

/**
 * One Settings radio: a round mark, its name in 600 and a muted line under it.
 * Pressing it chooses it; the rows that belong to a choice sit under it.
 */
function RadioRow({
  description,
  disabled = false,
  label,
  onSelect,
  selected,
}: {
  description: string;
  disabled?: boolean;
  label: string;
  onSelect: () => void;
  selected: boolean;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={selected}
      className="grid w-full grid-cols-[16px_minmax(0,1fr)] items-start gap-3 rounded-md text-left text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled}
      onClick={onSelect}
      type="button"
    >
      <span
        aria-hidden
        className={cn(
          "relative mt-0.5 block size-4 rounded-full border-[1.5px]",
          selected ? "border-foreground" : "border-foreground/40",
        )}
      >
        {selected ? (
          <span className="absolute inset-[3px] rounded-full bg-foreground" />
        ) : null}
      </span>
      <span className="flex flex-col">
        <span className="font-semibold">{label}</span>
        <span className="text-[13px] text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

/** One registry preference: its label beside the control its type calls for. */
function PreferenceRow({
  descriptor,
  disabled,
  onChange,
}: {
  descriptor: PreferenceDescriptor;
  disabled: boolean;
  onChange: SettingsScreenProps["onDisplayPreferenceChange"];
}) {
  return (
    <SettingRow
      disabled={disabled}
      htmlFor={descriptor.id}
      label={descriptor.label}
    >
      <div className="w-full [&>button]:w-full">
        <PreferenceControl
          descriptor={descriptor}
          disabled={disabled}
          onChange={(value) => onChange?.(descriptor, value)}
        />
      </div>
    </SettingRow>
  );
}

function BrightnessControl({
  disabled,
  id,
  label,
  labelled = true,
  max,
  min,
  onSave,
  onValueChange,
  value,
  valueLabel,
}: {
  disabled: boolean;
  id: string;
  label: string;
  /** False when the section heading already names the control. */
  labelled?: boolean;
  max: number;
  min: number;
  onSave: (value: number) => void;
  onValueChange: (value: number) => void;
  value: number;
  valueLabel: string;
}) {
  return (
    <div
      className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-2"
      data-disabled={disabled}
    >
      {labelled ? (
        <Label
          className={cn(
            "w-[190px] shrink-0 font-normal text-muted-foreground",
            disabled && "opacity-50",
          )}
          htmlFor={id}
        >
          {label}
        </Label>
      ) : (
        <Label className="sr-only" htmlFor={id}>
          {label}
        </Label>
      )}
      {/*
        The reading sits at the end of the row, as an <output>, so it is still
        announced as it changes.
      */}
      <div className="flex min-w-[200px] flex-1 items-center gap-4">
      <div className={cn("min-w-[120px] flex-1", disabled && "opacity-50")}>
        <Slider
          aria-label={label}
          disabled={disabled}
          id={id}
          max={max}
          min={min}
          onValueCommit={(values) => onSave(values[0] ?? value)}
          onValueChange={(values) => onValueChange(values[0] ?? value)}
          value={[value]}
        />
      </div>
      <output
        className="min-w-10 shrink-0 text-right text-[13px] tabular-nums text-muted-foreground"
        htmlFor={id}
      >
        {valueLabel}
      </output>
      </div>
    </div>
  );
}
