"use client";

import type { SupportDiagnostics } from "../control-center-types";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
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
  /** Why this device cannot install it, or null when it can. */
  blockedReason?: string | null;
  id: string;
  name: string;
  /** Where the published spec lives, so the preview draws the real theme. */
  themeSpecPath?: string;
};

type SetupThemeScreenProps = {
  /** Install steps the companion reported, newest last. */
  installLogs?: string[];
  installing?: boolean;
  aiFixPrompt?: () => string;
  onBack?: () => void;
  onCreateSupportReport?: () => Promise<SupportDiagnostics | null>;
  onInstall: () => void;
  onSelect: (theme: SetupThemeOption) => void;
  selectedThemeId: string | null;
  themes: SetupThemeOption[];
};

export function SetupThemeScreen({
  installLogs = [],
  installing = false,
  aiFixPrompt,
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
      aiFixPrompt={aiFixPrompt}
      onBack={onBack}
      onCreateSupportReport={onCreateSupportReport}
    >
      <SetupWizardTitle className="text-[40px]">
        Choose your theme
      </SetupWizardTitle>
      <SetupWizardSubtitle className="text-lg">
        You can always switch themes later.
      </SetupWizardSubtitle>

      <ItemGroup
        aria-label="Themes"
        className="mt-4 gap-3"
        role="radiogroup"
      >
        {themes.map((theme) => (
          <SetupThemeCard
            // Install is closed while one is running, so a new pick has nothing
            // to act on: the running install still activates the theme it
            // started with, and the poll behind it puts that theme back as the
            // selected one. All the customer got was a card that answered and
            // then changed its mind.
            disabled={installing}
            key={theme.id}
            onSelect={() => onSelect(theme)}
            selected={theme.id === selectedThemeId}
            theme={theme}
          />
        ))}
      </ItemGroup>

      <Button
        className="mt-4 w-full"
        disabled={installing || !selected || Boolean(selected.blockedReason)}
        onClick={onInstall}
        type="button"
      >
        {installing ? <Spinner data-icon="inline-start" /> : null}
        <span>{installing ? "Installing" : "Install"}</span>
      </Button>
      {selected?.blockedReason ? (
        <p
          className="mt-2 text-sm text-muted-foreground"
          data-slot="theme-blocked-reason"
        >
          {selected.blockedReason}
        </p>
      ) : null}

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
  disabled = false,
  onSelect,
  selected,
  theme,
}: {
  disabled?: boolean;
  onSelect: () => void;
  selected: boolean;
  theme: SetupThemeOption;
}) {
  return (
    <Item
      asChild
      className={`${selectedItemClass(selected)} p-4`}
      variant="outline"
    >
      <button
        aria-checked={selected}
        disabled={disabled}
        onClick={onSelect}
        role="radio"
        type="button"
      >
        <ItemMedia>
          <ThemeRenderPreview
            className="h-[72px] w-[100px] rounded-md"
            themeId={theme.id}
            themeSpecPath={theme.themeSpecPath}
          />
        </ItemMedia>
        <ItemContent>
          <ItemTitle className="text-lg font-semibold">{theme.name}</ItemTitle>
        </ItemContent>
        <ItemActions>
          <SelectionCheck selected={selected} />
        </ItemActions>
      </button>
    </Item>
  );
}
