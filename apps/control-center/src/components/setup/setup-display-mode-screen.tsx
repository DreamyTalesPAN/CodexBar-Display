"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  ProviderDisplaySelection,
  SupportDiagnostics,
} from "../control-center-types";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { ThemeRenderPreview } from "../theme-render-preview";
import { buildFrameData, type FrameData } from "../live-vibetv-preview";
import { previewUsageMode, type UsageDisplayMode } from "./setup-display-previews";
import type { SetupThemeOption } from "./setup-theme-screen";
import { SETUP_REVEAL } from "./setup-reveal";
import { SelectionCheck, selectedItemClass } from "./setup-selectable-card";
import {
  SetupWizardScreen,
  SetupWizardSubtitle,
  SetupWizardTitle,
} from "./setup-wizard-screen";

/** How long the Automatic tile rests on one provider before moving on. */
// Short enough that the rotation reads as a rotation without waiting on it.
const ROTATION_HOLD_MS = 1000;

/** One AI provider that is switched on for this Mac. */
export type SetupDisplayModeProvider = {
  id: string;
  label: string;
};

/**
 * What VibeTV shows for one provider right now. The screen never reads usage
 * itself: the caller passes the live values, and anything it has not read yet
 * arrives as `null` and stays visibly unavailable instead of being invented.
 */
export type SetupDisplayModePreview = {
  frame?: FrameData;
  providerLabel: string;
  resetLabel: string | null;
  windows: { label: string; percent: number | null }[];
};

type SetupDisplayModeScreenProps = {
  previewTheme?: SetupThemeOption;
  usageMode?: UsageDisplayMode;
  /** Live usage of the provider Automatic would show right now. */
  automaticPreview: SetupDisplayModePreview | null;
  /**
   * Every provider Automatic moves through, in the order it moves through
   * them. Optional: a caller that has only read one provider can leave it out,
   * and the tile falls back to `providers` so the rotation still names all of
   * them — the ones it holds no reading for stay visibly unavailable rather
   * than borrowing another provider's numbers.
   */
  automaticPreviews?: SetupDisplayModePreview[];
  /** Live usage of the provider Manual is pinned to right now. */
  manualPreview: SetupDisplayModePreview | null;
  mode: ProviderDisplaySelection["mode"];
  aiFixPrompt?: () => string;
  onBack?: () => void;
  onContinue: () => void;
  onCreateSupportReport?: () => Promise<SupportDiagnostics | null>;
  onSelectMode: (mode: ProviderDisplaySelection["mode"]) => void;
  onSelectProvider: (providerId: string) => void;
  providers: SetupDisplayModeProvider[];
  /** The choice is being written; the step has not finished yet. */
  saving?: boolean;
  selectedProviderId: string | null;
};

export function SetupDisplayModeScreen({
  previewTheme,
  usageMode,
  automaticPreview,
  automaticPreviews,
  manualPreview,
  mode,
  aiFixPrompt,
  onBack,
  onContinue,
  onCreateSupportReport,
  onSelectMode,
  onSelectProvider,
  providers,
  saving = false,
  selectedProviderId,
}: SetupDisplayModeScreenProps) {
  return (
    <SetupWizardScreen
      contentWidth="wide"
      label="Display Mode"
      aiFixPrompt={aiFixPrompt}
      onBack={onBack}
      onCreateSupportReport={onCreateSupportReport}
    >
      <SetupWizardTitle>Display Mode</SetupWizardTitle>
      <SetupWizardSubtitle>
        Show one or multiple AI Providers. You can change this any time.
      </SetupWizardSubtitle>

      <DisplayModeChoice
        previewTheme={previewTheme}
        usageMode={usageMode}
        automaticPreview={automaticPreview}
        automaticPreviews={automaticPreviews}
        className="mt-4"
        manualPreview={manualPreview}
        mode={mode}
        onSelectMode={onSelectMode}
        onSelectProvider={onSelectProvider}
        providers={providers}
        saving={saving}
        selectedProviderId={selectedProviderId}
      />

      <Button
        // Closed while the choice is being written. The screen used to take a
        // second Continue, and a changed selection with it, while the first
        // write was still on its way: two writes raced, the first one to answer
        // released the step, and what VibeTV kept was whichever landed last
        // rather than what the customer had chosen.
        //
        // And the provider has to be one of the ones on offer. A saved choice
        // whose provider has since been switched off is what sends the customer
        // back to this step, and it arrives naming a provider the list no
        // longer has: no card drawn as chosen, and a Continue that resubmitted
        // the same refused provider.
        disabled={
          saving ||
          (mode === "fixed" &&
            !providers.some((provider) => provider.id === selectedProviderId))
        }
        className="mt-4 w-full"
        onClick={onContinue}
        type="button"
      >
        Continue
      </Button>
    </SetupWizardScreen>
  );
}

type DisplayModeChoiceProps = Pick<
  SetupDisplayModeScreenProps,
  | "previewTheme"
  | "usageMode"
  | "automaticPreview"
  | "automaticPreviews"
  | "manualPreview"
  | "mode"
  | "onSelectMode"
  | "onSelectProvider"
  | "providers"
  | "saving"
  | "selectedProviderId"
> & { className?: string };

/**
 * The display-mode choice itself: two cards showing what each mode would put
 * on the device, and — for Manual — the provider it would be pinned to.
 *
 * Lives outside the wizard screen because Settings offers the same choice. One
 * component rather than two keeps the two places from drifting, which is how
 * Settings ended up offering "Always show one" against the wizard's "Manual".
 */
export function DisplayModeChoice({
  previewTheme,
  usageMode,
  automaticPreview,
  automaticPreviews,
  className,
  manualPreview,
  mode,
  onSelectMode,
  onSelectProvider,
  providers,
  saving = false,
  selectedProviderId,
}: DisplayModeChoiceProps) {
  const rotation = rotationFrames(
    automaticPreview,
    automaticPreviews,
    providers,
  );
  const { index } = useProviderRotation(rotation.length);

  return (
    <div className={cn("flex w-full flex-col gap-4", className)}>
      <div className="grid w-full grid-cols-2 items-stretch gap-4">
        <ModeCard
          description="VibeTV switches between your providers based on recent activity and usage."
          disabled={saving}
          onSelect={() => onSelectMode("automatic")}
          selected={mode === "automatic"}
          title="Automatic"
        >
          <PreviewTile preview={rotation[index]} theme={previewTheme} usageMode={usageMode} />
        </ModeCard>
        <ModeCard
          description="VibeTV always shows the one provider you pick — nothing else."
          disabled={saving}
          onSelect={() => onSelectMode("fixed")}
          selected={mode === "fixed"}
          title="Manual"
        >
          <PreviewTile preview={manualPreview} theme={previewTheme} usageMode={usageMode} />
        </ModeCard>
      </div>

      {mode === "fixed" ? (
        <div className={cn("flex w-full flex-col gap-2 text-left", SETUP_REVEAL)}>
          <p className="text-sm font-semibold">Show this provider</p>
          {providers.map((provider) => (
            <Item
              asChild
              className={selectedItemClass(provider.id === selectedProviderId)}
              key={provider.id}
              variant="outline"
            >
              <button
                aria-pressed={provider.id === selectedProviderId}
                disabled={saving}
                onClick={() => onSelectProvider(provider.id)}
                type="button"
              >
                <ItemContent>
                  <ItemTitle>{provider.label}</ItemTitle>
                </ItemContent>
                <ItemActions>
                  <SelectionCheck selected={provider.id === selectedProviderId} />
                </ItemActions>
              </button>
            </Item>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The providers the Automatic tile moves through. A caller that hands over the
 * whole set decides the order; otherwise the enabled providers are the set,
 * and only the one reading the caller did take carries numbers.
 */
function rotationFrames(
  automaticPreview: SetupDisplayModePreview | null,
  automaticPreviews: SetupDisplayModePreview[] | undefined,
  providers: SetupDisplayModeProvider[],
): SetupDisplayModePreview[] {
  if (automaticPreviews?.length) return automaticPreviews;
  if (!providers.length) return automaticPreview ? [automaticPreview] : [];
  return providers.map((provider) =>
    provider.label === automaticPreview?.providerLabel
      ? automaticPreview
      : {
          providerLabel: provider.label,
          resetLabel: null,
          windows: [],
        },
  );
}

/**
 * Which provider the Automatic tile is on. It starts held on the first one, so
 * server output and a reduced-motion Mac render the same still tile; on such a
 * Mac the card's own description is what says the mode rotates.
 */
function useProviderRotation(count: number): { index: number } {
  const [animated, setAnimated] = useState(false);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setAnimated(!query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const moving = animated && count > 1;

  useEffect(() => {
    if (!moving) return;
    const timer = window.setInterval(
      () => setIndex((current) => (current + 1) % count),
      ROTATION_HOLD_MS,
    );
    return () => window.clearInterval(timer);
  }, [count, moving]);

  return { index: count ? index % count : 0 };
}

export function ModeCard({
  children,
  description,
  disabled = false,
  onSelect,
  selected,
  title,
}: {
  children: ReactNode;
  description: string;
  disabled?: boolean;
  onSelect: () => void;
  selected: boolean;
  title: string;
}) {
  return (
    <Item
      asChild
      className={cn(selectedItemClass(selected), "items-start overflow-hidden p-0")}
      variant="outline"
    >
      <button
        aria-pressed={selected}
        disabled={disabled}
        onClick={onSelect}
        type="button"
      >
        <ItemContent className="gap-0">
          {children}
          <span className="flex flex-col gap-1.5 px-4 py-3.5">
            <ItemTitle className="w-full justify-between">
              <span>{title}</span>
              <SelectionCheck selected={selected} />
            </ItemTitle>
            <ItemDescription className="line-clamp-none text-xs leading-[1.5]">
              {description}
            </ItemDescription>
          </span>
        </ItemContent>
      </button>
    </Item>
  );
}

/** The selected theme, rendered by the same renderer as the live device preview. */
export function PreviewTile({ preview, theme, usageMode }: {
  preview: SetupDisplayModePreview | null | undefined;
  theme?: SetupThemeOption;
  usageMode?: UsageDisplayMode;
}) {
  const frame = preview?.frame ?? buildFrameData(undefined, {
    label: preview?.providerLabel,
    sessionUnavailable: true, weeklyUnavailable: true,
  });
  return (
    <span className="block aspect-square w-full overflow-hidden bg-muted/50" data-slot="display-mode-preview">
      {theme ? <ThemeRenderPreview
        animate
        className="h-full w-full border-0"
        themeId={theme.id}
        themeSpecPath={theme.themeSpecPath}
        frame={usageMode ? previewUsageMode(frame, usageMode) : frame}
      /> : <span className="flex h-full items-center justify-center text-xs text-muted-foreground">Theme preview unavailable</span>}
    </span>
  );
}
