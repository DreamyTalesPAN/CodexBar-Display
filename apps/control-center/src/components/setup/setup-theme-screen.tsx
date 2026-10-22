"use client";

import type { SupportDiagnostics } from "../control-center-types";
import { Button } from "@/components/ui/button";
import { ItemGroup } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { THEME_CARD_TITLE_CLASS, THEME_GRID_CLASS, THEME_GRID_STYLE } from "@/lib/theme-grid";
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
      contentWidth="wide"
      onBack={onBack}
      onCreateSupportReport={onCreateSupportReport}
      windowsHost={windowsHost}
    >
      <SetupWizardTitle className={CALM_TITLE_CLASS}>Choose your theme</SetupWizardTitle>
      <SetupWizardSubtitle className={CALM_SUBTITLE_CLASS}>
        You can always switch themes later.
      </SetupWizardSubtitle>

      {/* The grid fills the window's height and scrolls inside its box. 278 px is the chrome above it (142 px) and below it (the 24 px gap, the 44 px button, the 68 px page bottom), so the page itself never scrolls. Once the install log has lines the box gives up the log's room too: its 12 px margin and 120 px at most. */}
      <ItemGroup
        aria-label="Themes"
        className={cn(
          THEME_GRID_CLASS,
          "mt-6 overflow-y-auto pb-6 [mask-image:linear-gradient(to_bottom,black_calc(100%_-_24px),transparent)]",
          installLogs.length ? "max-h-[calc(100dvh-410px)]" : "max-h-[calc(100dvh-278px)]",
        )}
        onKeyDown={moveAmongRadios}
        role="radiogroup"
        style={THEME_GRID_STYLE}
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

      {/* The wide column would stretch the button across the window; 460 px is the size every calm step ends in. */}
      <Button
        className={cn(CALM_BUTTON_CLASS, "mt-6 max-w-[460px]")}
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
        // The Appearance card's frame: 7 px of padding around a square picture.
        "flex flex-col gap-2 p-[7px]",
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
        // The same square picture as the Appearance cards.
        className="aspect-square w-full rounded-[6px]"
        themeId={theme.id}
        themeSpecPath={theme.themeSpecPath}
      />
      <span className="flex items-center gap-2 px-0.5">
        <span className={cn(THEME_CARD_TITLE_CLASS, "flex-1 text-[13px] font-semibold")}>{theme.name}</span>
        <SelectionDot selected={selected} />
      </span>
    </button>
  );
}
