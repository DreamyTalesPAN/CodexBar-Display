# Control Center Accessibility

The accessibility baseline for the VibeTV Control Center (issue #214): who it is
built for, what an automated check guards, and what has to be checked by hand
before a release. It covers the app in `apps/control-center/`.

This is a first slice. The automated check runs; the manual checklist below has
not been run yet.

## Supported targets

- VoiceOver on macOS, in the Mac App's web view.
- Narrator on Windows, in the Windows App's web view.
- Keyboard only, in both apps.

Both apps show the same Control Center, so the same markup serves all three.

What the Control Center does for them:

- Outside the Theme Studio canvas, every action is a button, a link or a form
  control. It is reached with Tab and used with Enter or Space. Escape closes a
  dialog.
- Opening a dialog moves focus into it. Closing it puts focus back on the
  control that had it before (`components/ui/dialog.tsx`). After a theme is
  deleted its Delete button is gone, so focus goes to the page title.
- When setup moves on, the button that was pressed is gone. The new title
  takes focus (`SetupWizardTitle`), so the keyboard and the screen reader carry
  on from the new step.
- A control keeps focus while its change is saved. Brightness, the screensaver
  settings, the display mode and `Check for updates` are not disabled for that
  moment, so the next key press still reaches them.
- A control without visible text has a name that says what it acts on, for
  example `Delete My Theme` or `Check Codex again`.
- A progress bar has a name and reports its percentage. A usage lane without a
  reading reports no percentage.
- Progress that appears without a click (an update, a theme install, the setup
  log) sits in a `role="status"` region.
- With Reduce motion switched on, one rule in `app/globals.css` cuts every CSS
  animation and transition to a single step. The animated previews check the
  same setting and stop.

## Automated check

`expectNoAxeViolations` in `apps/control-center/src/test/axe.ts` runs axe-core
on the markup a screen test renders. It is called from the existing test file
of each screen, with that file's own fixtures. It runs with the unit tests
(`npm run test:unit`), so the unit-test job in CI runs it.

To run one file:

```bash
cd apps/control-center
npx vitest run src/components/usage-screen.test.tsx
```

| Screen | Test file under `src/components/` | States checked |
| --- | --- | --- |
| Setup, every step in its frame | `setup/setup-wizard.test.tsx` | welcome, device, providers, display, theme, live |
| Setup, device step | `setup/setup-device-screen.test.tsx` | found VibeTVs, connection choice, WiFi form, connecting |
| Setup, providers step | `setup/setup-providers-screen.test.tsx` | list, no match, loading, provider message |
| Setup dialogs | `setup/setup-device-dialogs.test.tsx`, `setup/setup-help-menu-log.test.tsx` | cable help, VibeTV not found, IP address, Help menu with the setup log |
| Overview | `overview-screen.test.tsx` | connected, not connected |
| Usage | `usage-screen.test.tsx` | usage, refreshing, unavailable limits, no provider |
| Themes | `theme-library-screen.test.tsx`, `theme-library-screen.custom.test.tsx` | Themes, Screensavers, empty list, install running, own theme, delete question |
| Updates | `updates-screen.test.tsx` | update offered, update running, update failed |
| Support | `logs-screen.test.tsx`, `setup-event-log.test.tsx` | diagnostics, recent activity, error, setup log |
| Settings | `settings-screen.test.tsx`, `settings-connection.test.tsx` | every section, factory reset question, connection question |
| Whole app | `control-center-shell.test.tsx`, `control-center-app.display-preferences.test.tsx` | navigation with an update waiting, every tab inside the real navigation, `Run setup again?` |

Focus has its own tests in the same files: into the factory reset question and
back to its button, into a setup dialog and back, back to Delete from the
delete question, and onto the new title after a setup step.

That a control keeps focus while its change is saved is checked with
`expectKeepsFocus` (`src/test/focus.ts`) in
`control-center-app.display-preferences.test.tsx` and
`control-center-app.update-check.test.tsx`. jsdom leaves
`document.activeElement` on a control that was disabled, so comparing that
alone proves nothing.

When a screen, a dialog or a state is added, add a check to its test file. A
finding is fixed in the component. Do not switch a rule off to get a green run.

### What the check cannot do

- **Contrast.** The rule `color-contrast` is switched off. The tests run in
  jsdom, which computes no layout and no colours, so axe cannot measure it.
- **What a screen reader says.** axe checks rules about the markup. It does not
  know whether a name makes sense, in which order things are read, or what
  VoiceOver or Narrator do with it.
- **Anything that needs layout.** Whether focus is visible, whether the focus
  order follows the screen, and how big a target is.
- **Page-level rules.** The page title, the language, one main landmark and one
  top heading are not checked. The check looks at the page body, and jsdom
  cannot run two of these rules at all.
- **Results axe marks as "needs review".** Only violations fail a test.
- **States that are not in the table.** A screen is checked alone, inside a
  stand-in for the navigation's main area and title. Only the whole-app test
  uses the real navigation.

## VoiceOver release checklist

On a Mac with the release candidate installed. Switch VoiceOver on with Cmd+F5
and use only the keyboard.

1. **Navigation.** Tab through the sidebar. Each entry is read by name, the
   open one as the current page. With an update waiting, `Update available` is
   read next to Updates.
2. **Overview.** The heading says whether VibeTV is connected. The four status
   entries read their label and their value.
3. **Usage.** Each provider is a heading. Each bar reads its lane, percentage
   and mode, for example `Session: 12% used`. A lane without a reading says so
   and reads no percentage.
4. **Settings.** The brightness slider, the screensaver switch and each
   provider switch read their name and state. Open `Reset to factory settings`:
   focus is inside the question. Press Escape: focus is back on the button.
5. **Run setup again.** In Settings or Support, open `Run setup again` and
   choose Cancel. Focus is back on the button.
6. **Themes.** The themes are read as a list. Each one offers Preview, Edit
   and Install. Open a preview, close it with Escape: focus is back on its
   Preview button.
7. **Updates.** Both versions are read with their labels. If the release
   rehearsal installs an update: `Updating VibeTV` is announced, the progress
   bar reads that name and a percentage, and focus does not move by itself.
8. **Support.** The card titles are reachable as headings (VO+Cmd+H). Recent
   activity is read as a list. `Create report` announces `Creating report`.
9. **Setup.** During the cold-start rehearsal, VoiceOver reads the new title
   after each step. An error dialog takes focus, and Help is still reachable
   with Tab.
10. **Reduce motion.** Switch it on in System Settings, Accessibility, Display.
    Nothing slides or fades, and the animated previews stand still.

## Not yet

- Contrast of the themes customers install or build.
- An increased-contrast mode.
- The Theme Studio canvas. It is driven with the pointer.

Known gaps this slice found and left open:

- The Help menu in setup does not move focus into the menu when it opens, and
  the arrow keys do not move between its entries. The entries are reachable
  with Shift+Tab, and Escape closes the menu.
- The choices in setup (VibeTV, theme) are radio buttons that are reached one by
  one with Tab. The arrow keys do not move between them.
