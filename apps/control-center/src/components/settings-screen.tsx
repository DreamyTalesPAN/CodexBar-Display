"use client";

import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import type { ProviderPickerProps } from "./provider-picker";
import { ProviderPicker } from "./provider-picker";
import { Switch } from "@/components/ui/switch";
import {
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
  device: DeviceInfo | null;
  brightness: number | null;
  busyAction: string | null;
  standby: StandbySettings | null;
  onBrightnessChange: (value: number) => void;
  onChooseScreensaver: () => void;
  onResetSetup: () => void;
  onSaveBrightness: (value: number) => void;
  providerPicker: ProviderPickerProps;
  onSaveStandby: (value: StandbySettings) => void;
  onStandbyBrightnessChange: (value: number) => void;
};

export function SettingsScreen({
  device,
  brightness,
  busyAction,
  standby,
  onBrightnessChange,
  onChooseScreensaver,
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

  return (
    <div className="mx-auto max-w-[1040px] py-4">
      <ItemGroup className="gap-0">
        <Item className="grid grid-cols-1 items-start gap-5 rounded-none border-0 px-0 py-8 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-12">
          <ItemContent className="min-w-0">
            <ItemTitle className="text-lg font-semibold">
              <h3>Display</h3>
            </ItemTitle>
          </ItemContent>
          <FieldGroup className="min-w-0">
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
              valueLabel={brightness == null ? "Loading" : `${brightness}%`}
            />
          </FieldGroup>
        </Item>

        <ItemSeparator className="my-0" />
        <div className="py-8">
          <ProviderPicker {...providerPicker} />
        </div>

        {standbySupport ? (
          <>
            <ItemSeparator className="my-0" />
            <Item className="grid grid-cols-1 items-start gap-5 rounded-none border-0 px-0 py-8 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-12">
              <ItemContent className="min-w-0">
                <ItemTitle className="text-lg font-semibold">
                  <h3>Screensaver</h3>
                </ItemTitle>
              </ItemContent>
              <FieldGroup className="min-w-0">
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
                  <FieldLabel htmlFor="vibetv-standby">
                    Show screensaver
                  </FieldLabel>
                </Field>
                <Field data-disabled={standbyDetailsDisabled} orientation="horizontal">
                  <FieldLabel htmlFor="vibetv-standby-timeout">
                    Show after
                  </FieldLabel>
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
                      id="vibetv-standby-timeout"
                    >
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
              </FieldGroup>
            </Item>
          </>
        ) : null}

        <ItemSeparator className="my-0" />
        <Item className="grid grid-cols-1 items-start gap-5 rounded-none border-0 px-0 py-8 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-12">
          <ItemContent className="min-w-0">
            <ItemTitle className="text-lg font-semibold">
              <h3>Setup</h3>
            </ItemTitle>
            <ItemDescription>
              Connect this Mac to another VibeTV.
            </ItemDescription>
          </ItemContent>
          <ItemActions className="w-full justify-start">
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
          </ItemActions>
        </Item>
      </ItemGroup>
    </div>
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
  const valuePosition =
    max === min
      ? 0
      : Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));

  return (
    <Field data-disabled={disabled}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className={disabled ? "relative pb-6 opacity-50" : "relative pb-6"}>
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
        <output
          className="absolute top-4 text-xs tabular-nums text-muted-foreground"
          style={{
            left: `${valuePosition}%`,
            transform: `translateX(-${valuePosition}%)`,
          }}
        >
          {valueLabel}
        </output>
      </div>
    </Field>
  );
}
