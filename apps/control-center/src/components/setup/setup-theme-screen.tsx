"use client";

import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { ThemeRenderPreview } from "../theme-render-preview";
import { SetupLog, type SetupLogLine } from "./setup-log";
import { SelectionCheck, selectedItemClass } from "./setup-selectable-card";
import {
  SetupWizardScreen,
  SetupWizardSubtitle,
  SetupWizardTitle,
} from "./setup-wizard-screen";

export type SetupThemeOption = {
  id: string;
  name: string;
  /** Where the published spec lives, so the preview draws the real theme. */
  themeSpecPath?: string;
};

type SetupThemeScreenProps = {
  /** Install steps the companion reported, newest last. */
  installLogs?: string[];
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
  installLogs = [],
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
        <span>{installing ? "Installing" : "Install"}</span>
      </Button>

      <SetupLog
        className="mt-4"
        lines={installLogLines(installLogs)}
        running={installing}
      />
    </SetupWizardScreen>
  );
}

function installLogLines(logs: string[]): SetupLogLine[] {
  return logs.map((text, index) => ({ id: `${index}-${text}`, text }));
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
    <Item asChild className={selectedItemClass(selected)} variant="outline">
      <button aria-pressed={selected} onClick={onSelect} type="button">
        <ItemMedia>
          <ThemeRenderPreview
            className="h-[52px] w-[72px] rounded-md"
            themeId={theme.id}
            themeSpecPath={theme.themeSpecPath}
          />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{theme.name}</ItemTitle>
        </ItemContent>
        <ItemActions>
          <SelectionCheck selected={selected} />
        </ItemActions>
      </button>
    </Item>
  );
}
