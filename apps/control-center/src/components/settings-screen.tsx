"use client";

import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { ItemSeparator } from "@/components/ui/item";
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
  type DeviceInfo,
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
  brightness: number | null;
  busyAction: string | null;
  connectionMode: "cable" | "wifi";
  standby: StandbySettings | null;
  onBrightnessChange: (value: number) => void;
  onChooseScreensaver: () => void;
  onConnectionModeChange: (mode: "cable" | "wifi") => void;
  onResetSetup: () => void;
  onSaveBrightness: (value: number) => void;
  providerPicker: ProviderPickerProps;
  onSaveStandby: (value: StandbySettings) => void;
  onStandbyBrightnessChange: (value: number) => void;
};

export function SettingsScreen({
  automaticPreviews,
  device,
  brightness,
  busyAction,
  connectionMode,
  standby,
  onBrightnessChange,
  onChooseScreensaver,
  onConnectionModeChange,
  onResetSetup,
  onSaveBrightness,
  providerPicker,
  onSaveStandby,
  onStandbyBrightnessChange,
}: SettingsScreenProps) {
  const brightnessSupport =
    device?.capabilities?.display?.brightness?.supported ?? true;
  const minBrightness =
    device?.capabilities?.display?.brightness?.minPercent ?? 10;
  const maxBrightness =
    device?.capabilities?.display?.brightness?.maxPercent ?? 100;
  const currentBrightness = brightness ?? minBrightness;
  const localActionBusy =
    busyAction === "brightness" ||
    busyAction === "standby" ||
    busyAction === "connection-mode" ||
    busyAction === "reset-setup" ||
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
  const supportedTransports = device?.capabilities?.transport?.supported;
  const cableSupported =
    !supportedTransports || supportedTransports.includes("usb");
  const wifiSupported =
    !supportedTransports || supportedTransports.includes("wifi");
  const connectionModeDisabled =
    (!deviceIsCustomerConnected(device) && !deviceCanSwitchToCable(device)) ||
    localActionBusy;

  const providers = (providerPicker.items || []).filter(isProviderItem);
  // Manual pins the device to exactly one provider, so it may only offer ones
  // that can actually produce a reading. Offering every switched-on provider,
  // as the design board's wording does, lets a customer pin VibeTV to a
  // provider that shows nothing.
  const displayable = providers.filter(setupProviderCanDisplay);
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
  // Optional prop: `undefined` means "nothing pending", the same as null.
  // Comparing against null alone left both mode cards disabled forever.
  const displaySavePending = Boolean(providerPicker.displayPendingProviderId);
  const providerError =
    providerPicker.preferencesError || providerPicker.displayError;

  return (
    <div className="mx-auto w-full max-w-[1040px] py-10">
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
      </SettingsSection>

      <ItemSeparator className="my-0" />

      <SettingsSection title="Display mode">
        <DisplayModeChoice
          automaticPreview={automaticPreviews[0] ?? null}
          automaticPreviews={automaticPreviews}
          manualPreview={
            automaticPreviews.find(
              (preview) =>
                preview.providerLabel ===
                displayable.find(
                  (item) =>
                    item.providerId === providerPicker.display?.providerIds[0],
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
          saving={displaySavePending}
          selectedProviderId={providerPicker.display?.providerIds[0] ?? null}
        />
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
                      {standbyTimeoutLabel(minutes)}
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
        description="Choose how this Mac connects to VibeTV."
        title="Connection"
      >
        <Field data-disabled={connectionModeDisabled} orientation="horizontal">
          <FieldLabel htmlFor="vibetv-connection-mode">
            Connection mode
          </FieldLabel>
          <Select
            disabled={connectionModeDisabled}
            onValueChange={(value) => {
              if (value === "cable" || value === "wifi") {
                onConnectionModeChange(value);
              }
            }}
            value={connectionMode}
          >
            <SelectTrigger
              aria-label="Connection mode"
              id="vibetv-connection-mode"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem disabled={!cableSupported} value="cable">
                Cable
              </SelectItem>
              <SelectItem disabled={!wifiSupported} value="wifi">
                WiFi
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </SettingsSection>

      <ItemSeparator className="my-0" />

      <SettingsSection
        description="Connect this Mac to another VibeTV."
        title="Setup"
      >
        <div>
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
        </div>
      </SettingsSection>

      <ItemSeparator className="my-0" />

      <SettingsSection title="AI providers">
        {/*
          The only place a failed provider or display write is reported once the
          customer is past the wizard.
        */}
        {providerError ? (
          <Alert className="mb-4" variant="destructive">
            <AlertTriangle />
            <AlertTitle>{providerError.message}</AlertTitle>
            <AlertDescription>{providerError.nextAction}</AlertDescription>
          </Alert>
        ) : null}
        <ProviderList
          onCheckAgain={(provider) => void providerPicker.onCheck(provider)}
          onToggle={(provider, enabled) =>
            void providerPicker.onPreferenceChange(provider, enabled)
          }
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
