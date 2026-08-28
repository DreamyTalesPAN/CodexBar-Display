"use client";

import { Button } from "@/components/ui/button";
import type { ProviderDisplaySelection } from "../control-center-types";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { SelectionCheck, selectedItemClass } from "./setup-selectable-card";
import {
  SetupWizardScreen,
  SetupWizardSubtitle,
  SetupWizardTitle,
} from "./setup-wizard-screen";

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
  sessionPercent: number | null;
  weeklyPercent: number | null;
};

type SetupDisplayModeScreenProps = {
  /** Live usage of the provider Automatic would show right now. */
  automaticPreview: SetupDisplayModePreview | null;
  /** Live usage of the provider Manual is pinned to right now. */
  manualPreview: SetupDisplayModePreview | null;
  mode: ProviderDisplaySelection["mode"];
  onAskAiToFix?: () => boolean | Promise<boolean>;
  onBack?: () => void;
  onContinue: () => void;
  onCreateSupportReport?: () => void;
  onSelectMode: (mode: ProviderDisplaySelection["mode"]) => void;
  onSelectProvider: (providerId: string) => void;
  providers: SetupDisplayModeProvider[];
  selectedProviderId: string | null;
};

export function SetupDisplayModeScreen({
  automaticPreview,
  manualPreview,
  mode,
  onAskAiToFix,
  onBack,
  onContinue,
  onCreateSupportReport,
  onSelectMode,
  onSelectProvider,
  providers,
  selectedProviderId,
}: SetupDisplayModeScreenProps) {
  return (
    <SetupWizardScreen
      contentWidth="wide"
      label="Display Mode"
      onAskAiToFix={onAskAiToFix}
      onBack={onBack}
      onCreateSupportReport={onCreateSupportReport}
    >
      <SetupWizardTitle>Display Mode</SetupWizardTitle>
      <SetupWizardSubtitle>
        Show one or multiple AI Providers. You can change this any time.
      </SetupWizardSubtitle>

      <div className="mt-4 grid w-full grid-cols-2 gap-3">
        <ModeCard
          description="VibeTV switches between your providers based on recent activity and usage."
          onSelect={() => onSelectMode("automatic")}
          preview={automaticPreview}
          selected={mode === "automatic"}
          title="Automatic"
        />
        <ModeCard
          description="VibeTV always shows the one provider you pick — nothing else."
          onSelect={() => onSelectMode("fixed")}
          preview={manualPreview}
          selected={mode === "fixed"}
          title="Manual"
        />
      </div>

      {mode === "fixed" ? (
        <div className="mt-4 flex w-full flex-col gap-2 text-left">
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
                onClick={() => onSelectProvider(provider.id)}
                type="button"
              >
                <ItemContent>
                  <ItemTitle>{provider.label}</ItemTitle>
                </ItemContent>
                <ItemActions>
                  <SelectionCheck
                    selected={provider.id === selectedProviderId}
                  />
                </ItemActions>
              </button>
            </Item>
          ))}
        </div>
      ) : null}

      <Button
        className="mt-4 w-full"
        disabled={mode === "fixed" && !selectedProviderId}
        onClick={onContinue}
        type="button"
      >
        Continue
      </Button>
    </SetupWizardScreen>
  );
}

function ModeCard({
  description,
  onSelect,
  preview,
  selected,
  title,
}: {
  description: string;
  onSelect: () => void;
  preview: SetupDisplayModePreview | null;
  selected: boolean;
  title: string;
}) {
  return (
    <Item
      asChild
      className={selectedItemClass(selected)}
      variant="outline"
    >
      <button aria-pressed={selected} onClick={onSelect} type="button">
        <ItemContent className="gap-3">
          <PreviewTile preview={preview} />
          <ItemTitle className="justify-between">
            <span>{title}</span>
            <SelectionCheck selected={selected} />
          </ItemTitle>
          <ItemDescription className="text-xs">{description}</ItemDescription>
        </ItemContent>
      </button>
    </Item>
  );
}

/**
 * The VibeTV screen as it looks with these values, drawn from props only. A
 * provider whose usage has not been read yet renders as unavailable rather
 * than as a placeholder number.
 */
function PreviewTile({ preview }: { preview: SetupDisplayModePreview | null }) {
  return (
    <span className="flex aspect-square w-full flex-col justify-center gap-2 rounded-[8px] bg-black p-3 font-mono text-[10px] font-bold uppercase text-[var(--vibetv-signal)]">
      {preview ? (
        <>
          <span className="truncate text-sm leading-none">
            {preview.providerLabel}
          </span>
          <PreviewLane label="Session" percent={preview.sessionPercent} />
          <PreviewLane label="Weekly" percent={preview.weeklyPercent} />
          <span className="truncate text-white/60">
            {preview.resetLabel || "Reset unavailable"}
          </span>
        </>
      ) : (
        <span className="text-center">No usage yet</span>
      )}
    </span>
  );
}

function PreviewLane({
  label,
  percent,
}: {
  label: string;
  percent: number | null;
}) {
  return (
    <span className="flex flex-col gap-1">
      <span className="flex items-center justify-between gap-2">
        <span>{label}</span>
        <span>{percent === null ? "--" : `${percent}%`}</span>
      </span>
      <span className="block h-1 w-full bg-white/15">
        <span
          className="block h-full bg-[var(--vibetv-signal)]"
          style={{ width: `${percent ?? 0}%` }}
        />
      </span>
    </span>
  );
}
