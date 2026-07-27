# Design QA: Setup theme chooser

## Comparison target

- Source visual truth: `/Users/paulanduschus/.codex/generated_images/019fa2df-cf91-73f1-9e0f-3a7582453fd8/call_3GLoIzVTaEdHbYKDiuIfib1c.png`
- Existing product UI reference: `/Users/paulanduschus/.codex/state/plugins/product-design/assets/vibetv-control-center-theme-library-current.png`
- Brand tokens: `/Users/paulanduschus/code/Codex/vibetv-shopify-app/docs/vibetv-brandbook.md`
- Final desktop implementation: `/Users/paulanduschus/.codex/visualizations/2026/07/27/019fa2df-cf91-73f1-9e0f-3a7582453fd8/theme-setup-implementation/implementation-desktop-1440x1024-final.png`
- Final mobile implementation: `/Users/paulanduschus/.codex/visualizations/2026/07/27/019fa2df-cf91-73f1-9e0f-3a7582453fd8/theme-setup-implementation/implementation-mobile-390x844-v2.png`

## Viewport and normalization

- Desktop CSS viewport: `1440 x 1024`, device scale factor `1`.
- Source pixels: `1487 x 1058`; normalized proportionally to `1440 x 1024` for the full-view comparison.
- Desktop implementation pixels: `1440 x 1024`.
- Mobile CSS viewport and implementation pixels: `390 x 844`, device scale factor `1`.
- Combined full-view evidence: `/Users/paulanduschus/.codex/visualizations/2026/07/27/019fa2df-cf91-73f1-9e0f-3a7582453fd8/theme-setup-implementation/source-vs-implementation.png` (`2880 x 1024`).

## State

- Companion online.
- Device active, connected, paired, and healthy.
- Device not ready because its active theme is `theme-missing` and `display.themeSpec.active` is `false`.
- Catalog contains the five standard VibeTV themes.
- Final screenshots show the initial chooser before an installation starts.

## Findings

- No actionable P0, P1, or P2 differences remain.
- Typography: the implementation uses the current app font and hierarchy. The exact approved headline is present, theme names remain readable, and no explanatory copy was added.
- Spacing and layout: the list is full-width within the current Theme Library `1180px` content constraint. Rows, borders, `10px` shared-item radius, thumbnail sizing, and desktop density intentionally follow the existing rendered app rather than the looser generated mock.
- Colors and tokens: primary buttons use the VibeTV lime `#CCFF00`, dark ink text, and `8px` button radius from the current component and brandbook. Cards use the existing neutral surface and border treatment.
- Image quality: all five real catalog preview assets are used with their existing crops; no placeholders, CSS drawings, emoji, or replacement illustrations were introduced.
- Copy and content: the only page-level copy is the approved `Choose your VibeTV theme` headline. Each standard theme has one `Install` action. Create, Edit, Published, selection, recovery, and restore language are absent.
- Interaction and accessibility: Install is a semantic button. Mobile buttons are `48px` high, keyboard focus remains supplied by the shared button component, install progress is announced, failure exposes `Try again`, and the layout has no horizontal overflow at `390px`.
- P3 accepted difference: desktop buttons are `36px` high and the content follows the current Theme Library max-width instead of copying the generated mock's oversized desktop rows. This is intentional existing-product fidelity, not an outstanding fix.
- Development-only difference: the Next.js development badge in the screenshot is not part of the production build.

## Focused-region evidence

A separate crop was not required. At the normalized `1440 x 1024` comparison, the headline, preview assets, card boundaries, theme labels, and button geometry are legible. Computed browser styles additionally confirmed `rgb(204, 255, 0)` button fill, `8px` button radius, `36px` desktop button height, and `48px` mobile button height.

## Comparison history

1. First desktop pass
   - Finding: P1 layout mismatch because the setup container shrank to its contents.
   - Evidence: `/Users/paulanduschus/.codex/visualizations/2026/07/27/019fa2df-cf91-73f1-9e0f-3a7582453fd8/theme-setup-implementation/implementation-desktop-1440x1024.png`
   - Fix: added `w-full` while retaining the current Theme Library `max-w-[1180px]`.
   - Post-fix evidence: `/Users/paulanduschus/.codex/visualizations/2026/07/27/019fa2df-cf91-73f1-9e0f-3a7582453fd8/theme-setup-implementation/implementation-desktop-1440x1024-v2.png`

2. First mobile pass
   - Finding: P2 accessibility mismatch because the reused small desktop button produced a `36px` mobile tap target.
   - Evidence: `/Users/paulanduschus/.codex/visualizations/2026/07/27/019fa2df-cf91-73f1-9e0f-3a7582453fd8/theme-setup-implementation/implementation-mobile-390x844-before-touch-fix.png`
   - Fix: kept the current desktop button size and raised setup-mode buttons to `48px` on mobile.
   - Post-fix evidence: `/Users/paulanduschus/.codex/visualizations/2026/07/27/019fa2df-cf91-73f1-9e0f-3a7582453fd8/theme-setup-implementation/implementation-mobile-390x844-v2.png`

3. Final pass
   - Full-view comparison: `/Users/paulanduschus/.codex/visualizations/2026/07/27/019fa2df-cf91-73f1-9e0f-3a7582453fd8/theme-setup-implementation/source-vs-implementation.png`
   - Result: no actionable P0, P1, or P2 findings.

## Primary interactions tested

- No theme installation starts automatically.
- Clicking a theme's Install button calls the expected install endpoint for that theme.
- An installation failure shows `Install failed` and a manual `Try again` action.
- After a successful install, an active theme with `ready=false` keeps the chooser visible.
- A failed first device readback also keeps the chooser visible without starting a second install.
- Enriching the same device from an IP-only identity to its stable device ID does not leave setup.
- A partial completion readback is merged with the confirmed display state before setup closes; a later unrelated `ready=false` state does not reopen it.
- Retrying can succeed, refreshes settings and device status, and exits setup only after the merged readback reports `ready=true`, `themeSpec.active=true`, and `renderOk=true`.
- Browser console errors and warnings checked: none.

## Real-device verification

- Date: `2026-07-27`.
- Device: `9517433`, `esp8266-smalltv-st7789`, `http://192.168.178.163`.
- Test firmware: `1.0.40-dev-theme-chooser-262`.
- The authenticated test filesystem produced the exact customer state: connected, paired, healthy, `ready=false`, `connectionState=reconnecting`, `activeTheme=theme-missing`, and `display.themeSpec.active=false`.
- The browser-rendered Control Center showed `Choose your VibeTV theme` with the five published themes and one Install action per theme.
- Installing Synthwave from that screen completed successfully and returned the app to Overview only after device readback reported `ready=true`.
- Final device readback: same device ID and board, station Wi-Fi, authenticated pairing, `health.ok=true`, `activeTheme=synthwave`, `display.themeSpec.active=true`, `renderOk=true`, `renderError=null`, and healthy Companion stream.
- Final browser evidence: `/Users/paulanduschus/.codex/visualizations/2026/07/27/019fa2df-cf91-73f1-9e0f-3a7582453fd8/theme-setup-implementation/real-device-success-673x753.png`.

## Implementation checklist

- [x] Route the precise `theme-missing` device state into setup.
- [x] Reuse the current Theme Library list, previews, cards, install progress, and button components.
- [x] Hide non-setup actions and metadata.
- [x] Preserve firmware, board, catalog, connectivity, and pairing blockers.
- [x] Require healthy device, stream, and render input before entering the chooser.
- [x] Keep the chooser visible across `ready=false` and failed readbacks until the device confirms ready and rendered.
- [x] Verify desktop, mobile, failure, retry, and successful completion.

final result: passed
