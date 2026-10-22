"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type {
  ProviderDisplaySelection,
  SupportDiagnostics,
  UsageSnapshot,
} from "../control-center-types";
import type { DisplayFrame } from "../live-vibetv-preview";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { DisplayLimitSelect } from "../display-limits-settings";
import {
  ThemeTileSkeleton,
  ThemeTileStrip,
  useThemeRenderPack,
  type SetupDisplayModeTheme,
  type ThemePackLoad,
} from "./setup-display-theme-tiles";
import { displayPreviewSize } from "./setup-display-size";
import { SETUP_REVEAL } from "./setup-reveal";
import { pinnedPreview, rotatingPreviews } from "./setup-display-previews";
import {
  SelectionCheck,
  SelectionDot,
  calmCardClass,
  selectedItemClass,
} from "./setup-selectable-card";
import {
  CALM_BUTTON_CLASS,
  CALM_SUBTITLE_CLASS,
  CALM_TITLE_CLASS,
  SetupWizardScreen,
  SetupWizardSubtitle,
  SetupWizardTitle,
} from "./setup-wizard-screen";

/** How long the Automatic tile rests on one provider before moving on (#631). */
export const ROTATION_HOLD_MS = 2000;

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
  providerLabel: string;
  /**
   * The provider's readings in the shape the theme renderer draws, exactly as
   * the companion built the frame for the stream. Absent while it has none to give; the
   * theme tile then shows a placeholder instead of numbers.
   */
  frame?: DisplayFrame;
  /** The same provider's frame when Manual pins it: the host builds its rows from that provider alone. */
  pinnedFrame?: DisplayFrame;
  providerId?: string;
  pairFrames?: Record<string, DisplayFrame>;
  /** When those readings were taken, so reset countdowns keep counting down. */
  frameAt?: string;
  /** When VibeTV received the frame whose activity this preview shows (its TTL counts from there). */
  activityAt?: string;
  resetLabel: string | null;
  windows: { label: string; percent: number | null }[];
};

type SetupDisplayModeScreenProps = {
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
  /** Live usage of the two providers Two at once shows together. */
  pairPreview?: SetupDisplayModePreview | null;
  /** Enabled providers for the pair, including those awaiting fresh usage. */
  pairProviders?: SetupDisplayModeProvider[];
  /** The first and the second provider of Two at once. */
  pairProviderIds?: string[];
  /**
   * Changes one slot; the caller applies it to its latest pair when saving.
   * Without it, or with fewer than two providers, the mode is not offered.
   */
  onSelectPair?: (position: number, providerId: string) => void;
  usage?: UsageSnapshot | null;
  hiddenWindows?: Record<string, string[]>;
  onSelectLimit?: (providerId: string, windowId: string) => void;
  mode: ProviderDisplaySelection["mode"];
  /**
   * The theme VibeTV is showing. With it, the tiles draw that theme with each
   * provider's live values; without it (or if it cannot be read) they fall back
   * to the plain usage tiles.
   */
  theme?: SetupDisplayModeTheme | null;
  aiFixPrompt?: () => string;
  onBack?: () => void;
  onContinue: () => void;
  onCreateSupportReport?: () => Promise<SupportDiagnostics | null>;
  /** The app runs on Windows; the Help menu words its outcomes for it. */
  windowsHost?: boolean;
  onSelectMode: (mode: ProviderDisplaySelection["mode"]) => void;
  onSelectProvider: (providerId: string) => void;
  providers: SetupDisplayModeProvider[];
  /** The choice is being written; the step has not finished yet. */
  saving?: boolean;
  /** No usage snapshot has been read yet; an unavailable reading is complete. */
  usageLoading?: boolean;
  selectedProviderId: string | null;
};

export function SetupDisplayModeScreen({
  automaticPreview,
  automaticPreviews,
  usage,
  hiddenWindows,
  onSelectLimit,
  manualPreview,
  mode,
  theme,
  aiFixPrompt,
  onBack,
  onContinue,
  onCreateSupportReport,
  windowsHost,
  onSelectMode,
  onSelectPair,
  onSelectProvider,
  pairPreview,
  pairProviderIds = [],
  providers,
  pairProviders = providers,
  saving = false,
  usageLoading = false,
  selectedProviderId,
}: SetupDisplayModeScreenProps) {
  const themePack = useThemeRenderPack(theme);
  // Continue waits exactly while a card draws the skeleton, the same rule the
  // tiles use. Unavailable usage is not a skeleton, so it never holds Continue.
  const awaitingUsage = tileIsSkeleton(
    themePack,
    usageLoading,
    rotationFrames(automaticPreview, automaticPreviews, providers),
  );

  return (
    <SetupWizardScreen
      contentWidth="wide"
      label="Display mode"
      aiFixPrompt={aiFixPrompt}
      onBack={onBack}
      onCreateSupportReport={onCreateSupportReport}
      windowsHost={windowsHost}
    >
      <SetupWizardTitle className={CALM_TITLE_CLASS}>Display mode</SetupWizardTitle>
      <SetupWizardSubtitle className={CALM_SUBTITLE_CLASS}>
        Show one or multiple AI providers. You can change this any time.
      </SetupWizardSubtitle>

      <DisplayModeChoice
        usage={usage}
        hiddenWindows={hiddenWindows}
        onSelectLimit={onSelectLimit}
        automaticPreview={automaticPreview}
        automaticPreviews={automaticPreviews}
        calm
        className="mt-8"
        manualPreview={manualPreview}
        mode={mode}
        onSelectMode={onSelectMode}
        onSelectPair={onSelectPair}
        onSelectProvider={onSelectProvider}
        pairPreview={pairPreview}
        pairProviderIds={pairProviderIds}
        pairProviders={pairProviders}
        providers={providers}
        saving={saving}
        selectedProviderId={selectedProviderId}
        themePack={themePack}
        usageLoading={usageLoading}
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
          awaitingUsage ||
          (mode === "fixed" &&
            !providers.some((provider) => provider.id === selectedProviderId)) ||
          (mode === "pair" && !pairIsChosen(pairProviderIds, pairProviders))
        }
        // The wide content column would stretch it across the whole window; the
        // other steps' 460px column is the size every calm step ends in.
        className={cn(CALM_BUTTON_CLASS, "max-w-[460px]", mode === "fixed" ? "mt-6" : "mt-8")}
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
  | "usage"
  | "hiddenWindows"
  | "onSelectLimit"
  | "automaticPreview"
  | "automaticPreviews"
  | "manualPreview"
  | "mode"
  | "onSelectMode"
  | "onSelectPair"
  | "onSelectProvider"
  | "pairPreview"
  | "pairProviderIds"
  | "pairProviders"
  | "providers"
  | "saving"
  | "usageLoading"
  | "selectedProviderId"
> & {
  /** Settings says so when Automatic follows a timer instead of activity. */
  automaticDescription?: string;
  /** The Setup Wizard's calm look (variant B); Settings keeps its own. */
  calm?: boolean;
  className?: string;
  /** Settings frames the chosen card and provider in ink, not lime. */
  ink?: boolean;
  /** The theme's render pack as loaded by the step; absent means no theme. */
  themePack?: ThemePackLoad;
};

const NO_THEME_PACK: ThemePackLoad = { pack: null, status: "error" };

/**
 * The display-mode choice itself: cards showing what each mode would put on
 * the device, the provider One provider is pinned to, and the two providers
 * Two at once shows together.
 *
 * Lives outside the wizard screen because Settings offers the same choice. One
 * component rather than two keeps the two places from drifting, which is how
 * Settings ended up offering "Always show one" against the wizard's "Manual".
 */
export function DisplayModeChoice({
  automaticDescription = "VibeTV switches between your providers based on recent activity and usage.",
  automaticPreview,
  automaticPreviews,
  calm = false,
  className,
  usage,
  hiddenWindows,
  onSelectLimit,
  ink = false,
  manualPreview,
  mode,
  onSelectMode,
  onSelectPair,
  onSelectProvider,
  pairPreview = null,
  pairProviderIds = [],
  providers,
  pairProviders = providers,
  saving = false,
  usageLoading = false,
  selectedProviderId,
  themePack = NO_THEME_PACK,
}: DisplayModeChoiceProps) {
  const choiceRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!calm) return;
    const choice = choiceRef.current;
    const main = choice?.closest("main");
    const content = main?.firstElementChild;
    const row = choice?.firstElementChild;
    if (!choice || !main || !content || !row) return;
    const resize = () => {
      const preview = row.querySelector<HTMLElement>('[data-slot="display-mode-preview"]');
      if (!preview || !row.clientWidth) return;
      const mainStyle = getComputedStyle(main);
      const previewStyle = getComputedStyle(preview);
      const currentSize = preview.getBoundingClientRect().height
        - parseFloat(previewStyle.paddingTop) - parseFloat(previewStyle.paddingBottom);
      // Measure the real text, provider picker and Continue instead of guessing
      // a fixed height budget; subtract the old picture to avoid resize feedback.
      const otherHeight = content.getBoundingClientRect().height - currentSize;
      const availableHeight = window.innerHeight - parseFloat(mainStyle.paddingTop)
        - parseFloat(mainStyle.paddingBottom) - otherHeight;
      const availableWidth = preview.clientWidth - parseFloat(previewStyle.paddingLeft)
        - parseFloat(previewStyle.paddingRight);
      choice.style.setProperty("--display-preview-size", `${displayPreviewSize(availableWidth, availableHeight)}px`);
    };
    resize();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(content);
    observer?.observe(row);
    window.addEventListener("resize", resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [calm, mode, providers.length, themePack.status, usageLoading]);
  const rotation = rotationFrames(
    automaticPreview,
    automaticPreviews,
    providers,
  );
  const { index, reducedMotion } = useProviderRotation(rotation.length);
  const offersPair = Boolean(onSelectPair) && pairProviders.length >= 2;
  const manualFrames = manualPreview ? [pinnedPreview(manualPreview)] : [];
  const tiles = (frames: SetupDisplayModePreview[], at: number) => {
    // The theme's own picture whenever it can be had; the plain tile is what
    // stays if the theme could not be read, so the step never loses its preview.
    if (tileIsSkeleton(themePack, usageLoading, rotation)) {
      return <ThemeTileSkeleton count={frames.length} />;
    }
    if (themePack.pack && frames[at]) {
      return (
        <ThemeTileStrip
          frames={frames}
          index={at}
          pack={themePack.pack}
          reducedMotion={reducedMotion}
        />
      );
    }
    return <PreviewTile calm={calm} frames={frames} index={at} />;
  };

  return (
    <div ref={choiceRef} className={cn("flex w-full flex-col", calm ? "gap-6" : "gap-4", className)}>
      <div className={cn(
        "grid w-full items-stretch gap-4",
        calm ? "grid-flow-col auto-cols-fr" : offersPair ? "grid-cols-3" : "grid-cols-2",
      )}>
        <ModeCard
          calm={calm}
          description={automaticDescription}
          disabled={saving}
          ink={ink}
          onSelect={() => onSelectMode("automatic")}
          selected={mode === "automatic"}
          title="Automatic"
        >
          {tiles(rotation, index)}
        </ModeCard>
        <ModeCard
          calm={calm}
          description="VibeTV always shows the one provider you pick."
          disabled={saving}
          ink={ink}
          onSelect={() => onSelectMode("fixed")}
          selected={mode === "fixed"}
          title="One provider"
        >
          {tiles(manualFrames, 0)}
        </ModeCard>
        {offersPair ? (
          <ModeCard
            calm={calm}
            ink={ink}
            description="VibeTV shows two providers together, one limit each."
            disabled={saving}
            onSelect={() => onSelectMode("pair")}
            selected={mode === "pair"}
            title="Two at once"
          >
            {tiles(pairPreview ? [pairPreview] : [], 0)}
          </ModeCard>
        ) : null}
      </div>

      {mode === "pair" && offersPair && onSelectPair ? (
        <div className={cn("grid w-full grid-cols-2 gap-4 text-left", SETUP_REVEAL)}>
          {(["Provider 1", "Provider 2"] as const).map((name, position) => {
            const providerId = pairProviderIds[position];
            const windows = usage?.providers.find(
              (provider) => provider.id === providerId,
            )?.windows ?? [];
            const limitId = `vibetv-pair-limit-${position}`;
            const limitLabel = `Limit for ${name}`;
            return (
              <div className="flex flex-col gap-3" key={name}>
                <Field>
                  <FieldLabel htmlFor={`vibetv-pair-${position}`}>{name}</FieldLabel>
                  <Select
                    disabled={saving}
                    onValueChange={(providerId) =>
                      onSelectPair(position, providerId)
                    }
                    value={pairProviderIds[position] ?? ""}
                  >
                    <SelectTrigger aria-label={name} id={`vibetv-pair-${position}`}>
                      <SelectValue placeholder="Choose a provider" />
                    </SelectTrigger>
                    <SelectContent>
                      {pairProviders.map((provider) => (
                        <SelectItem key={provider.id} value={provider.id}>
                          {provider.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {windows.length && onSelectLimit ? <Field>
                  <FieldLabel htmlFor={limitId}>{limitLabel}</FieldLabel>
                  <DisplayLimitSelect id={limitId} label={limitLabel} windows={windows}
                    hidden={hiddenWindows?.[providerId]} disabled={saving}
                    onChange={(windowId) => onSelectLimit(providerId, windowId)} />
                </Field> : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {mode === "fixed" ? (
        <div className={cn("flex w-full flex-col gap-2 text-left", SETUP_REVEAL)}>
          <p className={cn("font-semibold", calm ? "text-[13px]" : "text-sm")}>
            Show this provider
          </p>
          <div className={cn("flex flex-col", calm ? "gap-1.5" : "gap-2")}>
          {providers.map((provider) =>
            calm ? (
              <button
                aria-pressed={provider.id === selectedProviderId}
                className={cn(
                  calmCardClass(provider.id === selectedProviderId),
                  "flex h-11 items-center justify-between px-5",
                )}
                disabled={saving}
                key={provider.id}
                onClick={() => onSelectProvider(provider.id)}
                type="button"
              >
                <span className="font-semibold">{provider.label}</span>
                <SelectionDot selected={provider.id === selectedProviderId} />
              </button>
            ) : (
              <Item
                asChild
                className={selectedItemClass(provider.id === selectedProviderId, ink)}
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
            ),
          )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Two different providers, both still on offer. */
export function pairIsChosen(
  providerIds: string[],
  providers: SetupDisplayModeProvider[],
): boolean {
  return (
    providerIds.length === 2 &&
    providerIds[0] !== providerIds[1] &&
    providerIds.every((id) => providers.some((provider) => provider.id === id))
  );
}

/**
 * The pair with one position changed. Picking the provider the other position
 * holds swaps the two, so the pair never names one provider twice.
 */
export function withPairProvider(
  providerIds: string[],
  position: number,
  providerId: string,
): string[] {
  const next = [providerIds[0] ?? "", providerIds[1] ?? ""];
  const other = position === 0 ? 1 : 0;
  if (next[other] === providerId) {
    next[other] = next[position];
  }
  next[position] = providerId;
  return next;
}

/**
 * The pair Two at once starts from: the stored one while it is still valid,
 * otherwise the given provider first and the next one on offer second.
 */
export function defaultPairIds(
  storedIds: string[],
  firstId: string | null | undefined,
  providers: SetupDisplayModeProvider[],
): string[] {
  if (pairIsChosen(storedIds, providers)) {
    return storedIds;
  }
  const first =
    providers.find((provider) => provider.id === firstId)?.id ??
    providers[0]?.id;
  const second = providers.find((provider) => provider.id !== first)?.id;
  return first && second ? [first, second] : [];
}

/**
 * Whether the cards draw the skeleton rather than readings: the theme pack is
 * still loading, the usage snapshot has not been read yet, or any provider in
 * the rotation still lacks its companion frame. Until every preview has one,
 * no card shows a partial set. The Continue gate and the tiles both ask this,
 * so they cannot disagree.
 */
function tileIsSkeleton(
  themePack: ThemePackLoad,
  usageLoading: boolean,
  rotation: SetupDisplayModePreview[],
): boolean {
  return (
    themePack.status === "loading" ||
    usageLoading ||
    rotation.some((preview) => !preview.frame)
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
  if (automaticPreviews?.length) return rotatingPreviews(automaticPreviews);
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
 * server output renders a still tile. It keeps rotating under reduced motion —
 * only the movement between providers is dropped (`reducedMotion`). It holds
 * while the page is hidden: nobody sees it move, and the timer would keep a
 * minimised window busy.
 */
function useProviderRotation(count: number): {
  index: number;
  reducedMotion: boolean;
} {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [visible, setVisible] = useState(true);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(query.matches);
    const syncVisible = () => setVisible(document.visibilityState !== "hidden");
    sync();
    syncVisible();
    query.addEventListener("change", sync);
    document.addEventListener("visibilitychange", syncVisible);
    return () => {
      query.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", syncVisible);
    };
  }, []);

  const moving = visible && count > 1;

  useEffect(() => {
    if (!moving) return;
    const timer = window.setInterval(
      () => setIndex((current) => (current + 1) % count),
      ROTATION_HOLD_MS,
    );
    return () => window.clearInterval(timer);
  }, [count, moving]);

  return { index: count ? index % count : 0, reducedMotion };
}

function ModeCard({
  calm,
  children,
  description,
  disabled = false,
  ink = false,
  onSelect,
  selected,
  title,
}: {
  calm: boolean;
  children: ReactNode;
  description: string;
  disabled?: boolean;
  ink?: boolean;
  onSelect: () => void;
  selected: boolean;
  title: string;
}) {
  if (calm) {
    return (
      <button
        aria-pressed={selected}
        // The row stretches both cards to one height; a shorter description
        // must not move its preview down.
        className={cn(
          calmCardClass(selected),
          "flex min-w-0 flex-col items-stretch overflow-hidden p-0",
        )}
        disabled={disabled}
        onClick={onSelect}
        type="button"
      >
        {children}
        <span className="flex flex-col gap-1.5 px-5 pt-3 pb-5">
          <span className="flex items-center justify-between font-semibold">
            <span>{title}</span>
            <SelectionDot selected={selected} />
          </span>
          <span className="text-[13px] leading-normal text-muted-foreground">
            {description}
          </span>
        </span>
      </button>
    );
  }
  return (
    <Item
      asChild
      // The row stretches both cards to one height; a shorter description
      // must not move its preview down.
      className={cn(selectedItemClass(selected, ink), "items-start overflow-hidden p-0")}
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
            <ItemTitle className="justify-between">
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

/**
 * The VibeTV panel as it looks with these values, drawn from props only. The
 * frame around the numbers — labels, bar tracks, the rotation strip — never
 * moves; only the provider's own readings cross over. A provider whose usage
 * has not been read yet renders as unavailable rather than as a placeholder.
 */
function PreviewTile({
  calm = false,
  frames,
  index,
}: {
  calm?: boolean;
  frames: SetupDisplayModePreview[];
  index: number;
}) {
  const tileClass = calm
    ? "h-[calc(var(--display-preview-size,104px)+32px)] shrink-0 overflow-hidden bg-muted"
    : "min-h-[140px] bg-muted/50";
  const frame = frames[index];

  if (!frame) {
    return (
      <span
        className={cn("flex w-full items-center justify-center p-4 text-center font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase", tileClass)}
        data-slot="display-mode-preview"
      >
        No usage yet
      </span>
    );
  }

  return (
    <span
      className={cn("flex w-full flex-col justify-center gap-3 p-4 font-mono", tileClass)}
      data-slot="display-mode-preview"
    >
      <CycledText
        className="truncate text-center text-[11px] font-bold tracking-[0.12em] uppercase"
        cycleKey={index}
      >
        {frame.frame?.label || frame.providerLabel}
      </CycledText>

      <span className="flex gap-3">
        {frame.windows.length ? frame.windows.slice(0, 2).map((window, position) => (
          <PreviewReading
            key={window.label}
            align={position === 0 ? "left" : "right"}
            cycleKey={index}
            label={window.label}
            percent={window.percent}
          />
        )) : <span className="w-full text-center text-[10px]">Usage unavailable</span>}
      </span>

      <CycledText
        className="truncate text-center text-[8px] tracking-[0.12em] text-muted-foreground uppercase"
        cycleKey={index}
      >
        {frame.resetLabel || "Reset unavailable"}
      </CycledText>

    </span>
  );
}

/** One half of the panel: a named reading and how full it is. */
function PreviewReading({
  align = "left",
  cycleKey,
  label,
  percent,
}: {
  align?: "left" | "right";
  cycleKey: number;
  label: string;
  percent: number | null;
}) {
  return (
    <span
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-1.5",
        align === "right" && "items-end",
      )}
    >
      <span className="text-[8px] tracking-[0.12em] text-muted-foreground uppercase">
        {label}
      </span>
      <CycledText
        className={cn(
          "text-[26px] leading-none font-bold",
          percent === null && "text-muted-foreground/60",
        )}
        cycleKey={cycleKey}
      >
        {percent === null ? (
          "--"
        ) : (
          <>
            {percent}
            <span className="text-[12px]">%</span>
          </>
        )}
      </CycledText>
      <PreviewBar percent={percent} />
    </span>
  );
}

/**
 * Text that belongs to one provider. Remounting it on every step is what
 * replays the fade, so the reading crosses over while nothing around it moves.
 */
function CycledText({
  children,
  className,
  cycleKey,
}: {
  children: ReactNode;
  className?: string;
  cycleKey: number;
}) {
  return (
    <span
      className={cn("block", className)}
      key={cycleKey}
      style={{
        animation: "vibetv-preview-frame-in 180ms cubic-bezier(0.2, 0, 0, 1) both",
      }}
    >
      {children}
    </span>
  );
}

/** A usage bar that glides to the next provider's reading instead of jumping. */
function PreviewBar({ percent }: { percent: number | null }) {
  return (
    <span className="block h-[3px] w-full rounded-full bg-foreground/10">
      <span
        className="block h-full rounded-full bg-[var(--vibetv-support)]"
        style={{
          transitionDuration: "320ms",
          transitionProperty: "width",
          transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
          width: `${percent ?? 0}%`,
        }}
      />
    </span>
  );
}
