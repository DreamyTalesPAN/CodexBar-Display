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
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import type { DeviceInfo } from "./control-center-types";

export type SettingsScreenProps = {
  device: DeviceInfo | null;
  brightness: number | null;
  busyAction: string | null;
  onBrightnessChange: (value: number) => void;
  onResetSetup: () => void;
  onSaveBrightness: (value: number) => void;
};

export function SettingsScreen({
  device,
  brightness,
  busyAction,
  onBrightnessChange,
  onResetSetup,
  onSaveBrightness,
}: SettingsScreenProps) {
  const brightnessSupport =
    device?.capabilities?.display?.brightness?.supported ?? true;
  const minBrightness =
    device?.capabilities?.display?.brightness?.minPercent ?? 10;
  const maxBrightness =
    device?.capabilities?.display?.brightness?.maxPercent ?? 100;
  const currentBrightness = brightness ?? minBrightness;
  const localActionBusy = Boolean(busyAction);

  return (
    <div className="mx-auto flex max-w-[1040px] flex-col gap-4 py-4">
      <Card className="border-0">
        <CardHeader>
          <CardTitle>Display</CardTitle>
          <CardDescription>
            Adjust the screen brightness of the connected VibeTV.
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
                  !device?.connected ||
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
