"use client";

import type { SupportDiagnostics } from "../control-center-types";
import { Button } from "@/components/ui/button";
import { ItemGroup } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { ThemeRenderPreview } from "../theme-render-preview";
import { SetupLog, type SetupLogLine } from "./setup-log";
import { SelectionDot, calmCardClass, moveAmongRadios } from "./setup-selectable-card";
import {
  CALM_BUTTON_CLASS,
  CALM_SUBTITLE_CLASS,
  CALM_TITLE_CLASS,
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
  /** The app runs on Windows; the Help menu words its outcomes for it. */
  windowsHost?: boolean;
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
  windowsHost,
  onInstall,
  onSelect,
  selectedThemeId,
  themes,
}: SetupThemeScreenProps) {
  const selected = themes.find((theme) => theme.id === selectedThemeId) || null;
  // The Tab stop of the group: the selected theme, or the first one.
  const selectedIndex = themes.findIndex((theme) => theme.id === selectedThemeId);

  return (
    <SetupWizardScreen
      label="Choose your theme"
      aiFixPrompt={aiFixPrompt}
      onBack={onBack}
      onCreateSupportReport={onCreateSupportReport}
      windowsHost={windowsHost}
    >
      <SetupWizardTitle className={CALM_TITLE_CLASS}>Choose your theme</SetupWizardTitle>
      <SetupWizardSubtitle className={CALM_SUBTITLE_CLASS}>
        You can always switch themes later.
      </SetupWizardSubtitle>

      <ItemGroup
        aria-label="Themes"
        className="mt-6 gap-2"
        onKeyDown={moveAmongRadios}
        role="radiogroup"
      >
        {themes.map((theme, index) => (
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
            tabStop={index === Math.max(selectedIndex, 0)}
            theme={theme}
          />
        ))}
      </ItemGroup>

      <Button
        className={cn(CALM_BUTTON_CLASS, "mt-6")}
        disabled={installing || !selected || Boolean(selected.blockedReason)}
        onClick={onInstall}
        type="button"
      >
        {installing ? <Spinner data-icon="inline-start" /> : null}
        <span>{installing ? "Installing" : "Install"}</span>
      </Button>
      {selected?.blockedReason ? (
        <p
          className="mt-2 text-[13px] text-muted-foreground"
          data-slot="theme-blocked-reason"
        >
          {selected.blockedReason}
        </p>
      ) : null}

      <SetupLog
        className="mt-3 empty:mt-0"
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
  tabStop,
  theme,
}: {
  disabled?: boolean;
  onSelect: () => void;
  selected: boolean;
  tabStop: boolean;
  theme: SetupThemeOption;
}) {
  return (
    <button
      aria-checked={selected}
      className={cn(
        calmCardClass(selected),
        "flex items-center gap-4 py-2.5 pr-5 pl-2.5",
        // While one installs, the cards not picked fade back.
        disabled && !selected && "opacity-50",
      )}
      disabled={disabled}
      onClick={onSelect}
      role="radio"
      tabIndex={tabStop ? 0 : -1}
      type="button"
    >
      <ThemeRenderPreview
        className="size-20 shrink-0 rounded-[6px]"
        themeId={theme.id}
        themeSpecPath={theme.themeSpecPath}
      />
      <span className="min-w-0 flex-1 font-semibold">{theme.name}</span>
      <SelectionDot selected={selected} />
    </button>
  );
}
