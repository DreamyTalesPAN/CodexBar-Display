"use client";

import { CircleArrowRight, Wifi } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Item, ItemSeparator } from "@/components/ui/item";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SetupStepFailedDialog } from "./setup/setup-provider-dialogs";
import { selectedItemClass } from "./setup/setup-selectable-card";
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
import { loadUserThemes } from "@/lib/theme-studio-storage";
import type { ThemeProduct } from "@/lib/themes";
import { PreferenceControl } from "./preference-control";
import { isProviderItem, type ProviderPickerProps } from "./provider-picker";
import {
  DisplayModeChoice,
  type SetupDisplayModePreview,
} from "./setup/setup-display-mode-screen";
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
  /** Live usage per provider, in the order Automatic moves through them. */
  automaticPreviews: SetupDisplayModePreview[];
  device: DeviceInfo | null;
  /** The app's own display preferences; a Mac App without them sends none. */
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
  automaticPreviews,
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
  const standbyToggleDisabled =
    !deviceIsCustomerConnected(device) || localActionBusy;
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
  const usageDisplay = displayPreferences.find(
    (item) => item.id === "vibetv.usage.displayMode",
  );
  // What Default stands for right now, in the row's own words (issue #558).
  const usageDisplayDefault =
    usageDisplay?.value === null
      ? usageDisplay.options?.find(
          (option) => option.value === usageDisplay.effectiveValue,
        )?.label
      : undefined;
  const rotation = displayPreferences.find(
    (item) => item.id === "vibetv.display.rotateSeconds",
  );

  return (
    <div className="mx-auto w-full max-w-[1040px] py-10">
      <SetupStepFailedDialog
        error={actionError ?? errorForHost(providerError, windowsHost)}
        onOpenChange={(open) => !open && onDismissError()}
      />
      <SettingsSection title="Connection">
        <div
          aria-label="Connection mode"
          aria-busy={busyAction === "connection-mode"}
          className="grid grid-cols-2 gap-4"
          role="group"
        >
          {([
            { mode: "cable", label: "USB-C", description: `Requires a data cable connected to ${thisHost}.`, Icon: CircleArrowRight, supported: cableSupported },
            { mode: "wifi", label: "WiFi", description: "No cable needed — VibeTV can sit anywhere on your desk.", Icon: Wifi, supported: wifiSupported },
          ] as const).map(({ mode, label, description, Icon, supported }) => (
            <Item
              asChild
              className={`${selectedItemClass(connectionMode === mode)} max-w-[224px] flex-col items-start gap-2 bg-card p-4 last:justify-self-end disabled:cursor-not-allowed disabled:opacity-50`}
              key={mode}
              variant="outline"
            >
              <button
                aria-label={label}
                aria-pressed={connectionMode === mode}
                disabled={connectionModeDisabled || !supported}
                onClick={() => {
                  if (mode !== connectionMode) setRequestedMode(mode);
                }}
                type="button"
              >
                <Icon aria-hidden className="size-[18px]" />
                <span className="text-sm font-semibold">{label}</span>
                <span className="text-xs leading-normal text-muted-foreground">{description}</span>
              </button>
            </Item>
          ))}
        </div>
        {requestedMode !== null ? <Dialog
          open
          onOpenChange={(open) => { if (!open) setRequestedMode(null); }}
        >
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>{requestedMode === "cable" ? "Switch to USB-C?" : "Switch to WiFi?"}</DialogTitle>
              <DialogDescription>
                {requestedMode === "cable"
                  ? `Connect VibeTV to ${thisHost} with a data cable. WiFi stays on until the app confirms the cable connection. Your saved network, themes, providers and brightness stay saved.`
                  : "VibeTV connects to your saved WiFi network. If network details are needed, WiFi setup opens. Themes, providers and brightness stay saved."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => setRequestedMode(null)} type="button" variant="outline">
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

      <SettingsSection title="Display">
        <BrightnessControl
          disabled={
            !brightnessSupport ||
            !deviceIsReady(device) ||
            brightness == null ||
            localActionBusy
          }
          id="vibetv-brightness"
          label="Brightness"
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
        {usageDisplay ? (
          <PreferenceRow
            descriptor={usageDisplay}
            disabled={localActionBusy}
            onChange={onDisplayPreferenceChange}
          />
        ) : null}
        {usageDisplayDefault ? (
          <p className="-mt-2 text-sm text-muted-foreground">
            Default is the same as {usageDisplayDefault}.
          </p>
        ) : null}
      </SettingsSection>

      <ItemSeparator className="my-0" />

      <SettingsSection title="Display mode">
        {providerPicker.displayNotice ? (
          <p className="text-sm text-muted-foreground" role="status">
            {providerPicker.displayNotice}
          </p>
        ) : null}
        <DisplayModeChoice
          automaticDescription={
            rotation && rotation.value !== "0"
              ? "VibeTV switches between your providers on a timer."
              : undefined
          }
          automaticPreview={automaticPreviews[0] ?? null}
          automaticPreviews={automaticPreviews}
          manualPreview={
            automaticPreviews.find(
              (preview) =>
                preview.providerLabel ===
                displayable.find(
                  (item) =>
                    // While Manual is chosen, the provider VibeTV is pinned
                    // to; otherwise the one a click on Manual would pin.
                    item.providerId ===
                    (displayMode === "fixed"
                      ? currentProviderId
                      : manualProviderId),
                )?.label,
            ) ?? null
          }
          mode={displayMode}
          onSelectMode={(mode) =>
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
            )
          }
          onSelectProvider={(providerId) =>
            void providerPicker.onDisplayChange(
              { mode: "fixed", providerIds: [providerId] },
              providerId,
            )
          }
          providers={displayable.map((item) => ({
            id: item.providerId,
            label: item.label,
          }))}
          selectedProviderId={providerPicker.display?.providerIds[0] ?? null}
        />
        {displayMode === "automatic" && rotation ? (
          <PreferenceRow
            descriptor={rotation}
            disabled={localActionBusy}
            onChange={onDisplayPreferenceChange}
          />
        ) : null}
        {providerShortcut ? (
          <p className="text-sm text-muted-foreground">
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

      {standbySupport ? (
        <>
          <ItemSeparator className="my-0" />
          <SettingsSection title="Screensaver">
            <Field className="justify-start gap-3" orientation="horizontal">
              <Switch
                aria-label="Show screensaver"
                checked={standbyValues.enabled}
                disabled={standbyToggleDisabled}
                id="vibetv-standby"
                onCheckedChange={(enabled) =>
                  onSaveStandby({ ...standbyValues, enabled })
                }
              />
              <FieldLabel htmlFor="vibetv-standby">Show screensaver</FieldLabel>
            </Field>
            <Field data-disabled={standbyDetailsDisabled} orientation="horizontal">
              <FieldLabel htmlFor="vibetv-standby-timeout">Show after</FieldLabel>
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
                <SelectTrigger aria-label="Show after" id="vibetv-standby-timeout">
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
            </Field>
            <BrightnessControl
              disabled={standbyDetailsDisabled}
              id="vibetv-standby-brightness"
              label="Brightness in screensaver"
              max={maxBrightness}
              min={minBrightness}
              onSave={(brightnessPercent) =>
                onSaveStandby({ ...standbyValues, brightnessPercent })
              }
              onValueChange={onStandbyBrightnessChange}
              value={standbyValues.brightnessPercent}
              valueLabel={`${standbyValues.brightnessPercent}%`}
            />
            <div className="pt-1">
              {screensaverLine ? (
                <span className="mr-2 text-sm text-muted-foreground">
                  {screensaverLine}
                </span>
              ) : null}
              <a
                aria-disabled={standbyDetailsDisabled}
                className={
                  standbyDetailsDisabled
                    ? "pointer-events-none inline-block py-1 text-sm font-normal text-foreground underline underline-offset-4 opacity-50"
                    : "inline-block py-1 text-sm font-normal text-foreground underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
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
            </div>
          </SettingsSection>
        </>
      ) : null}

      <ItemSeparator className="my-0" />

      <SettingsSection
        description={`Connect ${thisHost} to another VibeTV.`}
        title="Setup"
      >
        <div className="flex flex-wrap gap-3">
          <Button
            disabled={localActionBusy}
            onClick={onResetSetup}
            type="button"
            variant="outline"
          >
            {busyAction === "reset-setup" ? (
              <Spinner data-icon="inline-start" />
            ) : null}
            <span>
              {busyAction === "reset-setup" ? "Resetting" : "Run setup again"}
            </span>
          </Button>
          {onEraseDevice && connectionMode === "cable" ? (
            <Button
              disabled={localActionBusy || !deviceIsCustomerConnected(device)}
              onClick={() => setEraseRequested(true)}
              type="button"
              variant="outline"
            >
              {busyAction === "erase-device" ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              <span>
                {busyAction === "erase-device"
                  ? "Resetting"
                  : "Reset to factory settings"}
              </span>
            </Button>
          ) : null}
        </div>
        {eraseRequested ? (
          <Dialog
            open
            onOpenChange={(open) => {
              if (!open) setEraseRequested(false);
            }}
          >
            <DialogContent showCloseButton={false}>
              <DialogHeader>
                <DialogTitle>Reset VibeTV to factory settings?</DialogTitle>
                <DialogDescription>
                  VibeTV forgets its WiFi details, pairing, settings and themes, then setup starts again. Use this before you give VibeTV away.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button onClick={() => setEraseRequested(false)} type="button" variant="outline">
                  Cancel
                </Button>
                <Button
                  disabled={localActionBusy}
                  onClick={() => {
                    setEraseRequested(false);
                    onEraseDevice?.();
                  }}
                  type="button"
                  variant="destructive"
                >
                  Reset
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      </SettingsSection>

      <ItemSeparator className="my-0" />

      <SettingsSection title="AI providers">
        <ProviderList
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
  description,
  title,
}: {
  children: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <section className="grid grid-cols-1 items-start gap-5 py-8 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)] md:gap-10">
      <div className="min-w-0">
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="flex min-w-0 max-w-[520px] flex-col gap-4">{children}</div>
    </section>
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
    <Field data-disabled={disabled} orientation="horizontal">
      <FieldLabel htmlFor={descriptor.id}>{descriptor.label}</FieldLabel>
      <PreferenceControl
        descriptor={descriptor}
        disabled={disabled}
        onChange={(value) => onChange?.(descriptor, value)}
      />
    </Field>
  );
}

function BrightnessControl({
  disabled,
  id,
  label,
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
  max: number;
  min: number;
  onSave: (value: number) => void;
  onValueChange: (value: number) => void;
  value: number;
  valueLabel: string;
}) {
  return (
    <Field data-disabled={disabled}>
      {/*
        The reading belongs beside its label, not on the thumb: following the
        thumb cost a position calculation and put the number where the cursor
        already is. Still an <output>, so it is still announced as it changes.
      */}
      <div className="flex items-baseline justify-between gap-3">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <output
          className="font-mono text-sm tabular-nums text-muted-foreground"
          htmlFor={id}
        >
          {valueLabel}
        </output>
      </div>
      <div className={disabled ? "opacity-50" : undefined}>
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
    </Field>
  );
}
