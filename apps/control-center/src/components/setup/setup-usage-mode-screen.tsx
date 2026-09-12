"use client";

import { Button } from "@/components/ui/button";
import type { SupportDiagnostics } from "../control-center-types";
import {
  ModeCard,
  PreviewTile,
  type SetupDisplayModePreview,
} from "./setup-display-mode-screen";
import type { UsageDisplayMode } from "./setup-display-previews";
import type { SetupThemeOption } from "./setup-theme-screen";
import {
  SetupWizardScreen,
  SetupWizardTitle,
  SetupWizardSubtitle,
} from "./setup-wizard-screen";

type UsageModeChoiceProps = {
  mode: UsageDisplayMode | null;
  onSelect: (mode: UsageDisplayMode) => void;
  preview: SetupDisplayModePreview | null;
  theme?: SetupThemeOption;
  saving?: boolean;
};

export function UsageModeChoice({
  mode,
  onSelect,
  preview,
  theme,
  saving,
}: UsageModeChoiceProps) {
  return (
    <div
      className="grid w-full grid-cols-2 items-stretch gap-4"
      role="group"
      aria-label="Show usage as"
    >
      {([
        ["used", "Used", "Counts up as you work — how much of the limit is gone."],
        ["remaining", "Remaining", "Counts down — how much you still have before the reset."],
      ] as const).map(([value, title, description]) => (
        <ModeCard
          key={value}
          title={title}
          description={description}
          selected={mode === value}
          disabled={saving || mode === null}
          onSelect={() => onSelect(value)}
        >
          <PreviewTile preview={preview} theme={theme} usageMode={value} />
        </ModeCard>
      ))}
    </div>
  );
}

export function SetupUsageModeScreen({
  onBack,
  onContinue,
  aiFixPrompt,
  onCreateSupportReport,
  ...choice
}: UsageModeChoiceProps & {
  onBack?: () => void;
  onContinue: () => void;
  aiFixPrompt?: () => string;
  onCreateSupportReport?: () => Promise<SupportDiagnostics | null>;
}) {
  return (
    <SetupWizardScreen
      label="Show usage as"
      onBack={onBack}
      aiFixPrompt={aiFixPrompt}
      onCreateSupportReport={onCreateSupportReport}
    >
      <SetupWizardTitle>Show usage as</SetupWizardTitle>
      <SetupWizardSubtitle>You can change this later in Settings.</SetupWizardSubtitle>
      <div className="mt-4 w-full"><UsageModeChoice {...choice} /></div>
      <Button
        className="mt-4 w-full"
        disabled={choice.saving || choice.mode === null}
        onClick={onContinue}
      >
        Continue
      </Button>
    </SetupWizardScreen>
  );
}
