# Control Center Accessibility Baseline

The accessibility standard for VibeTV Control Center (issue #214). It applies to
the Next.js app in `apps/control-center/`, wherever it is shown: inside the
macOS app, inside the Windows app, and hosted on the web.

## Targets

- **Standard:** WCAG 2.1 level AA for every screen and dialog of the Control
  Center.
- **Supported combinations:**
  - macOS app (WKWebView) with VoiceOver and Full Keyboard Access.
  - Hosted and local web UI in current Safari and Chrome on macOS with
    VoiceOver.
  - Windows app (WebView2) with the keyboard. Narrator is expected to work
    because the same markup is used, but it is not part of the release check.
- **Keyboard:** every action is reachable with Tab and operable with Enter or
  Space; Escape closes a dialog. No action depends on hover or on a pointer.
- **Focus:**
  - Opening a dialog moves focus into it.
  - Closing a dialog returns focus to the control that had it before
    (`components/ui/dialog.tsx`).
  - When setup continues to the next step, focus moves to that step's title
    (`SetupWizardTitle`).
- **Names and states:** every control has a name that says what it acts on
  ("Delete My Theme", "Check Codex again"). Usage values carry their provider,
  window, percentage and mode as text ("Codex" → "Session: 12% used"). A status
  is always a word, never only a colour or an icon. A disabled action says why
  in text a screen reader reaches, not only in a tooltip.
- **Changes on screen:** progress, loading and results that appear without a
  click are announced through `role="status"`; errors through `role="alert"` or
  a dialog.
- **Motion:** with "Reduce motion" every animation and transition is cut to a
  single frame (`prefers-reduced-motion` in `app/globals.css`).
- **Contrast:** text meets 4.5:1 and control outlines 3:1 against their
  background (table below). With "Increase contrast" separators and control
  outlines are darkened and keyboard focus gets a solid 2px outline
  (`prefers-contrast: more` in `app/globals.css`). Windows contrast themes
  arrive as `forced-colors` and are applied by the browser.

Not covered by this baseline yet: the Theme Studio editor (its canvas is
pointer-driven; only its "Save your changes?" dialog is checked), a contrast
check for themes made in Theme Studio, and the pixels a theme draws on the
VibeTV itself. These stay open in #214.

### Colour token contrast

Computed from the tokens in `app/globals.css` (WCAG relative luminance).

| Pair | Ratio |
| --- | --- |
| Text on background (`#1B1B1B` on `#F9F9F9`) | 16.4:1 |
| Secondary text on background (`#444933` on `#F9F9F9`) | 8.9:1 |
| Secondary text on muted (`#444933` on `#EEEEEE`) | 8.1:1 |
| Primary button (`#1B1B1B` on `#CCFF00`) | 14.7:1 |
| Destructive (`#7D2633` and `#F9F9F9`) | 9.1:1 |
| Warning (`#4D3D00` on `#FFF2B8`) | 9.4:1 |
| Success (`#3B5200` on `#F1FFD0`) | 8.3:1 |
| Sidebar text (`#EDEDED` on `#1B1B1B`) | 14.7:1 |
| Sidebar active item (`#EDEDED` on `#444933`) | 8.0:1 |
| Focus ring colour (`#506600` on `#F9F9F9`) | 6.2:1 |
| Input outline (`#888888` on `#F9F9F9`) | 3.4:1 |
| Separator (`#E3E3E3` on `#F9F9F9`) | 1.2:1, decorative |
| Separator with "Increase contrast" (`#707070` on `#F9F9F9`) | 4.7:1 |

## Automated check

`apps/control-center/src/components/accessibility.test.tsx` renders each core
screen and dialog with realistic props in jsdom and runs axe-core on the whole
document. It runs with the unit tests (`npm run test:unit`), so it is part of
the unit-test CI job. To run it alone:

```bash
cd apps/control-center
npx vitest run src/components/accessibility.test.tsx
```

Covered: Overview (connected, no VibeTV), Usage (data, loading, error),
Settings, Appearance (themes, screensavers), Updates (idle, installing),
Support, all six setup steps, the ten setup dialogs, and the confirmations and
errors: reset to factory settings, switch connection, delete a custom theme,
update failed, leave Theme Studio with unsaved changes. The same file checks
focus into and out of dialogs, focus on a setup step change, and the names of
usage cards, usage bars and disabled install buttons.

One axe rule is switched off: `color-contrast`. jsdom has no layout and no
computed colours, so axe cannot measure it there. The token table above covers
it instead. Every other rule runs. A finding is fixed in the component; rules
are not disabled to get a green run.

When a new screen or dialog is added, add it to this test.

## VoiceOver release checklist

Before a release, on a Mac with the release candidate installed. Turn VoiceOver
on with Cmd+F5. Use only the keyboard.

1. **Navigation.** Tab through the sidebar. Each entry is read with its name,
   the current one as "current page". With an update waiting, "Update
   available" is read after Updates.
2. **Overview.** The heading says whether VibeTV is connected. The four tiles
   read label, then value (for example "VibeTV, Connected").
3. **Usage.** Each provider card is announced with the provider name. Each bar
   reads window, percentage and mode ("Session: 12% used"). Refresh is
   reachable by name.
4. **Settings.** Brightness, the screensaver switch and each provider switch
   read their name and state. Open "Reset to factory settings": focus is inside
   the dialog, Escape closes it, focus is back on the button.
5. **Appearance.** Each theme row offers Preview, Edit and Install by name. On
   a disabled Install the reason is read. Delete a custom theme: the dialog
   opens on Cancel; after Cancel focus is back on Delete.
6. **Updates.** Start an update (only with a device meant for it): progress is
   announced without moving focus. A failed update opens a dialog that is read
   with title and description.
7. **Support.** The cards are reachable as headings (VO+Cmd+H). "Create
   report" announces its result.
8. **Setup.** Run setup again. After each Continue, VoiceOver reads the new
   step's title. Each provider switch reads the provider name. An error dialog
   takes focus; Help stays reachable with Tab.
9. **System settings.** System Settings → Accessibility → Display: with
   "Reduce motion" nothing slides or fades; with "Increase contrast" separators
   and input outlines are clearly visible and focus has a solid outline.
