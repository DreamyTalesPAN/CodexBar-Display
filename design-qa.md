# Provider loading state design QA

**Comparison target**

- Source visual truth: `/var/folders/4v/dyq0kpnn23g98t5n20snltkw0000gn/T/codex-clipboard-7099f2bf-4915-40d2-9cee-5c1affdf98aa.png`
- Normalized source crop: `/Users/paulanduschus/.codex/visualizations/2026/09/02/01a06173-eb39-7990-8906-167e9d8304bf/provider-loading-reference.png`
- Browser-rendered implementation: `/Users/paulanduschus/.codex/visualizations/2026/09/02/01a06173-eb39-7990-8906-167e9d8304bf/provider-loading-implementation.png`
- Side-by-side evidence: `/Users/paulanduschus/.codex/visualizations/2026/09/02/01a06173-eb39-7990-8906-167e9d8304bf/provider-loading-comparison.png`
- State: initial `Choose AI providers` scan after one 20-second `still checking, hang tight` update; provider search, rows, and Continue disabled.
- Viewport and density: source artboard 1152 x 845 px, cropped to its 1120 x 789 px app canvas; implementation viewport 1120 x 789 CSS px at device scale factor 1, producing 1120 x 789 px. No density resampling was needed.

**Findings**

- No actionable P0, P1, or P2 differences remain.
- Fonts and typography: the implementation uses the existing Control Center Geist/Geist Mono stack, preserves the source hierarchy, and keeps both log lines readable. The shared setup heading is slightly more compact than the mock, which is intentional so the loading state does not resize when the real provider list replaces it.
- Spacing and layout rhythm: title, subtitle, log, search, three rows, Continue, Back, and Help retain the source order and alignment. The implementation reserves the existing 118 px setup-log height, creating more space before Search than the static mock; this prevents controls from jumping as a new line arrives every 20 seconds.
- Colors and tokens: background, ink, muted skeletons, borders, radii, and disabled lime action use the existing VibeTV tokens and shared controls. This matches the live app rather than introducing loading-only styling.
- Image quality and assets: the state contains no raster imagery or custom artwork. Search, Back, and Help use the app's existing icon library; no placeholder asset or handcrafted SVG was introduced.
- Copy and content: title, apology, `reading provider usage on this Mac`, repeated `still checking, hang tight`, Search placeholder, Continue, Back, and Help match the approved design.
- Accessibility and interaction: the progress log is a polite live region, every new line has a stable unique key, Search and Continue are disabled during loading, decorative skeletons are hidden from assistive technology, reduced-motion handling comes from the existing global rule, and the interval is removed when the real list mounts.

**Full-view comparison evidence**

- The combined comparison shows the same information hierarchy, state, control order, three-row skeleton count, and disabled primary action.
- The implementation deliberately keeps the existing provider-screen width, control heights, Back treatment, and fixed log reserve so the transition into the real list is stable and visually consistent with the rest of setup.

**Focused region comparison evidence**

- A separate crop was not needed: at the normalized 1120 x 789 full-view resolution, all typography, icons, borders, skeleton shapes, and disabled states are readable without magnification. There are no detailed image assets to inspect separately.

**Primary interactions and browser checks**

- Verified loading screen appears before the provider inventory answers.
- Verified Search and Continue remain disabled.
- Verified a first and second `still checking, hang tight` line append after 20 and 40 seconds.
- Verified the timer is removed and the real provider list appears when inventory arrives.
- Verified no `Starting AI usage` dialog covers the state.
- Verified no unexpected browser console or page errors. The fixture's expected 404 responses for the intentionally unavailable first display frame were identified separately.

**Comparison history**

- Pass 1: no P0/P1/P2 mismatch found. No visual fix iteration was required after the normalized side-by-side comparison.

**Implementation checklist**

- [x] Use the existing setup shell, controls, tokens, and icons.
- [x] Keep loading controls disabled and accessible.
- [x] Append one visible status line every 20 seconds.
- [x] Replace loading with the authoritative provider list automatically.
- [x] Preserve stable layout while the log grows.

**Follow-up polish**

- None required for handoff.

final result: passed
