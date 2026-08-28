"use client";

import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  SetupWizardScreen,
  SetupWizardSubtitle,
  SetupWizardTitle,
} from "./setup-wizard-screen";

export type SetupThemeOption = {
  id: string;
  name: string;
  /**
   * Rendered thumbnail for this theme. The theme library owns how a preview is
   * loaded and drawn, so the caller hands the finished node in instead of this
   * screen fetching render packs of its own.
   */
  preview?: ReactNode;
};

type SetupThemeScreenProps = {
  /** Label on the disabled install button while the install runs. */
  busyLabel?: string;
  installing?: boolean;
  onAskAiToFix?: () => boolean | Promise<boolean>;
  onBack?: () => void;
  onCreateSupportReport?: () => void;
  onInstall: () => void;
  onSelect: (theme: SetupThemeOption) => void;
  selectedThemeId: string | null;
  themes: SetupThemeOption[];
};

export function SetupThemeScreen({
  busyLabel = "Installing",
  installing = false,
  onAskAiToFix,
  onBack,
  onCreateSupportReport,
  onInstall,
  onSelect,
  selectedThemeId,
  themes,
}: SetupThemeScreenProps) {
  const selected = themes.find((theme) => theme.id === selectedThemeId) || null;

  return (
    <SetupWizardScreen
      label="Choose your theme"
      onAskAiToFix={onAskAiToFix}
      onBack={onBack}
      onCreateSupportReport={onCreateSupportReport}
    >
      <SetupWizardTitle>Choose your theme</SetupWizardTitle>
      <SetupWizardSubtitle>
        You can always switch themes later.
      </SetupWizardSubtitle>

      <div className="mt-4 flex w-full flex-col gap-3">
        {themes.map((theme) => (
          <SetupThemeCard
            key={theme.id}
            onSelect={() => onSelect(theme)}
            selected={theme.id === selectedThemeId}
            theme={theme}
          />
        ))}
      </div>

      <Button
        className="mt-4 w-full"
        disabled={installing || !selected}
        onClick={onInstall}
        type="button"
      >
        {installing ? <Spinner data-icon="inline-start" /> : null}
        <span>
          {installing
            ? busyLabel
            : selected
              ? `Install ${selected.name}`
              : "Install"}
        </span>
      </Button>
    </SetupWizardScreen>
  );
}

function SetupThemeCard({
  onSelect,
  selected,
  theme,
}: {
  onSelect: () => void;
  selected: boolean;
  theme: SetupThemeOption;
}) {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "flex w-full items-center gap-3 rounded-[var(--radius-card)] bg-card p-3 text-left ring-1 ring-foreground/10",
        selected && "outline-2 outline-ring/30",
      )}
      onClick={onSelect}
      type="button"
    >
      <span className="grid h-[52px] w-[72px] shrink-0 place-items-center overflow-hidden rounded-md bg-muted">
        {theme.preview}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
        {theme.name}
      </span>
      {selected ? (
        <Check className="size-4 shrink-0 text-[var(--vibetv-support)]" />
      ) : null}
    </button>
  );
}
