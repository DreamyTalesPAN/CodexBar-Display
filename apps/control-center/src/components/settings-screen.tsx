"use client";

import { Check } from "lucide-react";
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
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
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
import {
  deviceIsReady,
  type DeviceInfo,
  type StandbySettings,
} from "./control-center-types";

const standbyTimeoutOptions = [5, 10, 15, 30, 60];

export type SettingsScreenProps = {
  device: DeviceInfo | null;
  brightness: number | null;
  busyAction: string | null;
  standby: StandbySettings | null;
  onBrightnessChange: (value: number) => void;
  onResetSetup: () => void;
  onSaveBrightness: (value: number) => void;
  onSaveStandby: (value: StandbySettings) => void;
  onStandbyBrightnessChange: (value: number) => void;
};

export function SettingsScreen({
  device,
  brightness,
  busyAction,
  standby,
  onBrightnessChange,
  onResetSetup,
  onSaveBrightness,
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
    busyAction === "reset-setup";
  // Firmware that does not advertise standby has no screensaver at all, so the
  // whole block stays hidden instead of showing controls that cannot work.
  const standbySupport = device?.capabilities?.standby?.supported === true;
  const standbyValues: StandbySettings = standby ?? {
    enabled: false,
    timeoutMinutes: 10,
    brightnessPercent: 20,
  };
  const standbyDisabled =
    !deviceIsReady(device) || standby == null || localActionBusy;

  return (
    <div className="mx-auto flex max-w-[1040px] flex-col gap-4 py-4">
      <Card className="border-0">
        <CardHeader>
          <CardTitle>Display</CardTitle>
          <CardDescription>
            Adjust the screen of the connected VibeTV.
          </CardDescription>
          <CardAction>
            <Badge variant="outline">
              {brightness == null ? "Loading" : `${brightness}%`}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="vibetv-brightness">Brightness</FieldLabel>
              <Slider
                aria-label="Brightness"
                className="w-full"
                disabled={!brightnessSupport || brightness == null || localActionBusy}
                id="vibetv-brightness"
                max={maxBrightness}
                min={minBrightness}
                onValueChange={(values) => onBrightnessChange(values[0] ?? currentBrightness)}
                value={[currentBrightness]}
              />
              <FieldDescription>
                {minBrightness}% minimum · {maxBrightness}% maximum
              </FieldDescription>
              <Button
                className="h-12"
                disabled={
                  !deviceIsReady(device) ||
                  brightness == null ||
                  localActionBusy
                }
                onClick={() => onSaveBrightness(currentBrightness)}
                type="button"
              >
                {busyAction === "brightness" ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <Check data-icon="inline-start" aria-hidden />
                )}
                <span>
                  {busyAction === "brightness" ? "Working..." : "Save brightness"}
                </span>
              </Button>
            </Field>

            {standbySupport ? (
              <>
                <Field orientation="horizontal">
                  <FieldLabel htmlFor="vibetv-standby">
                    Show screensaver
                  </FieldLabel>
                  <Switch
                    aria-label="Show screensaver"
                    checked={standbyValues.enabled}
                    disabled={standbyDisabled}
                    id="vibetv-standby"
                    onCheckedChange={(enabled) =>
                      onSaveStandby({ ...standbyValues, enabled })
                    }
                  />
                </Field>
                {standbyValues.enabled ? (
                  <>
                    <Field>
                      <FieldLabel htmlFor="vibetv-standby-timeout">
                        Show after
                      </FieldLabel>
                      <Select
                        disabled={standbyDisabled}
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
                              {minutes} minutes
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="vibetv-standby-brightness">
                        Brightness in screensaver
                      </FieldLabel>
                      <Slider
                        aria-label="Brightness in screensaver"
                        className="w-full"
                        disabled={standbyDisabled}
                        id="vibetv-standby-brightness"
                        max={maxBrightness}
                        min={minBrightness}
                        onValueChange={(values) =>
                          onStandbyBrightnessChange(
                            values[0] ?? standbyValues.brightnessPercent,
                          )
                        }
                        value={[standbyValues.brightnessPercent]}
                      />
                      <Button
                        className="h-12"
                        disabled={standbyDisabled}
                        onClick={() => onSaveStandby(standbyValues)}
                        type="button"
                      >
                        {busyAction === "standby" ? (
                          <Spinner data-icon="inline-start" />
                        ) : (
                          <Check data-icon="inline-start" aria-hidden />
                        )}
                        <span>
                          {busyAction === "standby"
                            ? "Working..."
                            : "Save screensaver brightness"}
                        </span>
                      </Button>
                    </Field>
                  </>
                ) : null}
              </>
            ) : null}
          </FieldGroup>
        </CardContent>
      </Card>

      <Card className="border-0">
        <CardHeader>
          <CardTitle>Setup</CardTitle>
          <CardDescription>Connect this Mac to another VibeTV.</CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
    </div>
  );
}
