"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import type {
  ProviderDisplaySelection,
  UsageSnapshot,
  UsageWindowInfo,
} from "./control-center-types";
import type { ActiveThemeLimits } from "./live-vibetv-preview";
import { visibleUsageWindows } from "./setup/setup-display-previews";

/** Turns the hidden limits the customer has into the next ones. */
export type DisplayLimitsChange = (
  hidden: Record<string, string[]>,
) => Record<string, string[]>;

type DisplayLimitsSettingsProps = {
  display: ProviderDisplaySelection | null;
  /** The providers VibeTV can show, in CodexBar's order. */
  providers: { id: string; label: string }[];
  usage: UsageSnapshot | null;
  /** What the active theme has room for; null until it has been read. */
  theme: ActiveThemeLimits | null;
  onChange: (change: DisplayLimitsChange) => void;
};

/**
 * Which usage limits VibeTV shows per provider. The limits are CodexBar's own
 * windows; the list only takes some of them off the screen, it never adds one.
 */
export function DisplayLimitsSettings({
  display,
  onChange,
  providers,
  theme,
  usage,
}: DisplayLimitsSettingsProps) {
  const hidden = display?.hiddenWindows ?? {};
  const disabled = !display;
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
          {theme.limits === 1 ? "limit" : "limits"}.
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
                      onChange((current) =>
                        withWindowShown(
                          current,
                          provider.id,
                          provider.windows,
                          window,
                          checked === true,
                        ),
                      )
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
