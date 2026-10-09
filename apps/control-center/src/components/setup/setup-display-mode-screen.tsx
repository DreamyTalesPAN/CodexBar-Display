"use client";

import { useEffect, useState, type ReactNode } from "react";
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
} from "../control-center-types";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
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
  providerLabel: string;
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
  /** The first and the second provider of Two at once. */
  pairProviderIds?: string[];
  /**
   * Picks the two providers of Two at once. Without it, or with fewer than
   * two providers to choose from, the mode is not offered.
   */
  onSelectPair?: (providerIds: string[]) => void;
  mode: ProviderDisplaySelection["mode"];
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
  selectedProviderId: string | null;
};

export function SetupDisplayModeScreen({
  automaticPreview,
  automaticPreviews,
  manualPreview,
  mode,
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
      windowsHost={windowsHost}
    >
      <SetupWizardTitle>Display Mode</SetupWizardTitle>
      <SetupWizardSubtitle>
        Show one or multiple AI Providers. You can change this any time.
      </SetupWizardSubtitle>

      <DisplayModeChoice
        automaticPreview={automaticPreview}
        automaticPreviews={automaticPreviews}
        className="mt-4"
        manualPreview={manualPreview}
        mode={mode}
        onSelectMode={onSelectMode}
        onSelectPair={onSelectPair}
        onSelectProvider={onSelectProvider}
        pairPreview={pairPreview}
        pairProviderIds={pairProviderIds}
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
            !providers.some((provider) => provider.id === selectedProviderId)) ||
          (mode === "pair" && !pairIsChosen(pairProviderIds, providers))
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
  | "automaticPreview"
  | "automaticPreviews"
  | "manualPreview"
  | "mode"
  | "onSelectMode"
  | "onSelectPair"
  | "onSelectProvider"
  | "pairPreview"
  | "pairProviderIds"
  | "providers"
  | "saving"
  | "selectedProviderId"
> & { className?: string };

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
  automaticPreview,
  automaticPreviews,
  className,
  manualPreview,
  mode,
  onSelectMode,
  onSelectPair,
  onSelectProvider,
  pairPreview = null,
  pairProviderIds = [],
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
  // Most customers use one provider; for them a pair is no choice at all.
  const offersPair = Boolean(onSelectPair) && providers.length >= 2;

  return (
    <div className={cn("flex w-full flex-col gap-4", className)}>
      <div
        className={cn(
          "grid w-full items-stretch gap-4",
          offersPair ? "grid-cols-3" : "grid-cols-2",
        )}
      >
        <ModeCard
          description="VibeTV switches between your providers based on recent activity and usage."
          disabled={saving}
          onSelect={() => onSelectMode("automatic")}
          selected={mode === "automatic"}
          title="Automatic"
        >
          <PreviewTile frames={rotation} index={index} />
        </ModeCard>
        <ModeCard
          description="VibeTV always shows the one provider you pick."
          disabled={saving}
          onSelect={() => onSelectMode("fixed")}
          selected={mode === "fixed"}
          title="One provider"
        >
          <PreviewTile frames={manualPreview ? [manualPreview] : []} index={0} />
        </ModeCard>
        {offersPair ? (
          <ModeCard
            description="VibeTV shows two providers together, one limit each."
            disabled={saving}
            onSelect={() => onSelectMode("pair")}
            selected={mode === "pair"}
            title="Two at once"
          >
            <PreviewTile frames={pairPreview ? [pairPreview] : []} index={0} />
          </ModeCard>
        ) : null}
      </div>

      {mode === "pair" && offersPair && onSelectPair ? (
        <div className={cn("grid w-full grid-cols-2 gap-4 text-left", SETUP_REVEAL)}>
          {(["First", "Second"] as const).map((name, position) => (
            <Field key={name}>
              <FieldLabel htmlFor={`vibetv-pair-${position}`}>{name}</FieldLabel>
              <Select
                disabled={saving}
                onValueChange={(providerId) =>
                  onSelectPair(withPairProvider(pairProviderIds, position, providerId))
                }
                value={pairProviderIds[position] ?? ""}
              >
                <SelectTrigger aria-label={`${name} provider`} id={`vibetv-pair-${position}`}>
                  <SelectValue placeholder="Choose a provider" />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ))}
        </div>
      ) : null}

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
function withPairProvider(
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

function ModeCard({
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
      className={cn(selectedItemClass(selected), "overflow-hidden p-0")}
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
  frames,
  index,
}: {
  frames: SetupDisplayModePreview[];
  index: number;
}) {
  const frame = frames[index];

  if (!frame) {
    return (
      <span
        className="flex min-h-[140px] w-full items-center justify-center bg-muted/50 p-4 text-center font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase"
        data-slot="display-mode-preview"
      >
        No usage yet
      </span>
    );
  }

  return (
    <span
      className="flex min-h-[140px] w-full flex-col justify-center gap-3 bg-muted/50 p-4 font-mono"
      data-slot="display-mode-preview"
    >
      <CycledText
        className="truncate text-center text-[11px] font-bold tracking-[0.12em] uppercase"
        cycleKey={index}
      >
        {frame.providerLabel}
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
