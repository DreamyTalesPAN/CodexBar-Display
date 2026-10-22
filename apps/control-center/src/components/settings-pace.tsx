"use client";

import { Field, FieldLabel } from "@/components/ui/field";
import type { ThemeProduct } from "@/lib/themes";
import { PreferenceControl } from "./preference-control";
import type {
  PreferenceDescriptor,
  PreferenceValue,
  UsageSnapshot,
} from "./control-center-types";

export const SHOW_PACE_PREFERENCE_ID = "vibetv.display.showPace";

/**
 * What the Settings section "Pace" shows, or null for no section. The section
 * is there only when the engine sends CodexBar's pace at all (the retained
 * provider pace carries its stage), which today's Windows engine does not.
 * The muted line appears only while the switch is on and the active catalog
 * theme has no place for pace; a theme the catalog does not know gets no claim.
 */
export function paceSetting(
  displayPreferences: PreferenceDescriptor[],
  usage: UsageSnapshot | null | undefined,
  activeThemeId: string | undefined,
  themes: ThemeProduct[],
): { descriptor: PreferenceDescriptor; note: string | null } | null {
  const descriptor = displayPreferences.find(
    (item) => item.id === SHOW_PACE_PREFERENCE_ID,
  );
  const engineSendsPace = usage?.providers.some((provider) =>
    provider.pace?.some((pace) => Boolean(pace.stage)),
  );
  if (!descriptor || !engineSendsPace) {
    return null;
  }
  const active = themes.find(
    (theme) => (theme.themeId || theme.id) === activeThemeId,
  );
  const hasNoPlace =
    active !== undefined &&
    !(active.requiredCapabilities || []).includes("usage-pace-v1");
  return {
    descriptor,
    note:
      descriptor.value === true && hasNoPlace
        ? `${active.title} has no place for it. Pace Meter shows it.`
        : null,
  };
}

export function PaceSetting({
  descriptor,
  disabled,
  note,
  onChange,
}: {
  descriptor: PreferenceDescriptor;
  disabled: boolean;
  note: string | null;
  onChange?: (
    item: PreferenceDescriptor,
    value: PreferenceValue,
  ) => void | Promise<void>;
}) {
  return (
    <>
      <Field data-disabled={disabled} orientation="horizontal">
        <FieldLabel htmlFor={descriptor.id}>{descriptor.label}</FieldLabel>
        <PreferenceControl
          descriptor={descriptor}
          disabled={disabled}
          onChange={(value) => onChange?.(descriptor, value)}
        />
      </Field>
      {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
    </>
  );
}
