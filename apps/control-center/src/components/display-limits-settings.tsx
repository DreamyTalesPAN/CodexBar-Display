"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import type {
  ProviderDisplaySelection,
  UsageSnapshot,
  UsageWindowInfo,
} from "./control-center-types";
import type { ActiveThemeLimits } from "./live-vibetv-preview";
import { visibleUsageWindows } from "./setup/setup-display-previews";

export type DisplayLimitsChange = Pick<
  ProviderDisplaySelection,
  "hiddenWindows" | "showPace"
>;

type DisplayLimitsSettingsProps = {
  display: ProviderDisplaySelection | null;
  /** The providers VibeTV can show, in CodexBar's order. */
  providers: { id: string; label: string }[];
  usage: UsageSnapshot | null;
  /** What the active theme has room for; null until it has been read. */
  theme: ActiveThemeLimits | null;
  saving: boolean;
  onChange: (change: DisplayLimitsChange) => void;
};

/**
 * Which usage limits VibeTV shows per provider, and whether themes that can
 * show the reserve or deficit do. The limits are CodexBar's own windows; the
 * list only takes some of them off the screen, it never adds one.
 */
export function DisplayLimitsSettings({
  display,
  onChange,
  providers,
  saving,
  theme,
  usage,
}: DisplayLimitsSettingsProps) {
  const hidden = display?.hiddenWindows ?? {};
  const showPace = display?.showPace !== false;
  const disabled = saving || !display;
  const listed = providers.flatMap((provider) => {
    const windows =
      usage?.providers.find((reading) => reading.id === provider.id)?.windows ??
      [];
    return windows.length ? [{ ...provider, windows }] : [];
  });

  return (
    <>
      {theme && theme.limits > 0 ? (
        <p className="text-sm">
          {theme.name} has room for {theme.limits}{" "}
          {theme.limits === 1 ? "limit" : "limits"}
          {theme.showsPace ? " and shows reserve or deficit." : "."}
        </p>
      ) : null}
      {listed.map((provider) => {
        const visible = visibleUsageWindows(provider.windows, hidden[provider.id]);
        return (
          <div
            aria-label={`${provider.label} limits`}
            className="flex flex-col gap-2"
            key={provider.id}
            role="group"
          >
            <p className="text-sm font-semibold">{provider.label}</p>
            {provider.windows.map((window) => {
              const ticked = visible.includes(window);
              const id = `vibetv-limit-${provider.id}-${window.id}`;
              const mark = ticked
                ? limitMark(display, theme, provider.id, visible.indexOf(window))
                : null;
              return (
                <Field className="gap-2" key={window.id} orientation="horizontal">
                  <Checkbox
                    checked={ticked}
                    // The last ticked limit stays: a provider with none would
                    // leave VibeTV blank.
                    disabled={disabled || (ticked && visible.length === 1)}
                    id={id}
                    onCheckedChange={(checked) =>
                      onChange({
                        hiddenWindows: withWindowShown(
                          hidden,
                          provider.id,
                          provider.windows,
                          window,
                          checked === true,
                        ),
                      })
                    }
                  />
                  <FieldLabel className="font-normal" htmlFor={id}>
                    {window.label}
                    <span className="text-muted-foreground">
                      {window.usedPercent}%
                    </span>
                  </FieldLabel>
                  {mark ? (
                    <span className="ml-auto text-xs text-muted-foreground">
                      {mark}
                    </span>
                  ) : null}
                </Field>
              );
            })}
          </div>
        );
      })}
      <Field className="justify-start gap-3" orientation="horizontal">
        <Switch
          aria-label="Show reserve or deficit"
          checked={showPace}
          disabled={disabled}
          id="vibetv-show-pace"
          onCheckedChange={(checked) => onChange({ showPace: checked })}
        />
        <FieldLabel htmlFor="vibetv-show-pace">Show reserve or deficit</FieldLabel>
      </Field>
      {showPace && theme && !theme.showsPace ? (
        <p className="text-sm text-muted-foreground">
          {theme.name} has no place for it. Two Limits shows it.
        </p>
      ) : null}
    </>
  );
}

/**
 * Whether a ticked limit makes it onto the screen. Said only for a provider
 * VibeTV can show right now and a theme that was read.
 */
function limitMark(
  display: ProviderDisplaySelection | null,
  theme: ActiveThemeLimits | null,
  providerId: string,
  position: number,
): string | null {
  if (!display || !theme || theme.limits === 0) {
    return null;
  }
  const providerIds = display.providerIds ?? [];
  if (display.mode === "pair") {
    const lane = providerIds.indexOf(providerId);
    if (lane < 0) {
      return null;
    }
    if (position > 0) {
      return "not in Two at once";
    }
    return lane < theme.limits ? "on screen" : "no room in this theme";
  }
  if (display.mode === "fixed" && providerIds[0] !== providerId) {
    return null;
  }
  return position < theme.limits ? "on screen" : "no room in this theme";
}

/**
 * The hidden limits with one limit ticked or unticked. A hidden limit CodexBar
 * does not report right now stays hidden.
 */
function withWindowShown(
  hidden: Record<string, string[]>,
  providerId: string,
  windows: UsageWindowInfo[],
  window: UsageWindowInfo,
  shown: boolean,
): Record<string, string[]> {
  const visible = visibleUsageWindows(windows, hidden[providerId]);
  const known = windows.map((candidate) => candidate.id);
  const ids = [
    ...(hidden[providerId] ?? []).filter((id) => !known.includes(id)),
    ...windows
      .filter((candidate) =>
        candidate === window ? !shown : !visible.includes(candidate),
      )
      .map((candidate) => candidate.id),
  ];
  const next = { ...hidden };
  if (ids.length) {
    next[providerId] = ids;
  } else {
    delete next[providerId];
  }
  return next;
}
