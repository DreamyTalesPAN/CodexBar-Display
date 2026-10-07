# VibeTV Documentation

This is the documentation map for the Control Center launch flow. Customer
setup starts at `app.vibetv.shop`, then the Mac App opens the local Control
Center on the customer's Mac.

## Customer Docs

- [Customer setup](customer-setup.md): normal Mac setup through Control Center.
- [Providers](providers.md): which AI provider signals VibeTV can show.
- [Themes](themes.md): switching themes, installing theme packs, and building new themes.
- [Architecture](architecture.md): how CodexBar, the Mac App, Control Center, and VibeTV fit together.

## Control Center

- [Control Center readiness](control-center-customer-readiness.md): launch-readiness checks and support flow.
- [Control Center UI principles](control-center-ui-principles.md): customer-facing UI rules.
- [Control Center UI approvals](control-center-customer-ui-approval.md): append-only approval log for visible UI changes.

## Device And Release Docs

- [Hardware contract](hardware-contract.md): firmware, WiFi (incl. the 802.11g interop rule), display, and endpoint contract.
- [Firmware provisioning](firmware-provisioning.md): provisioning and OTA packaging.
- [Firmware guardrails](firmware-guardrails.md): firmware safety rules.
- [ThemeSpec slot budget](themespec-slot-budget.md): measured RAM and transition cost of a second resident ThemeSpec.
- [Operator runbook](operator-runbook.md): support, recovery, and smoke-test procedures.
- [Firmware migrations](firmware-migrations/1.0.36-to-1.0.37.md): per-version migration notes and their compatibility modes.
- [macOS DMG distribution](macos-dmg-distribution.md): signed and notarized customer distribution path.
- [Hosted VibeTV gates](vibetv-hosted-gates.md): owner-dispatched merge and release-candidate gates in GitHub Actions.
- [Operator runbook](operator-runbook.md): support, recovery, network diagnosis (`net-probe`), the one-command hardware self-test, and smoke tests.
- [Firmware OTA contract](firmware-ota-contract.md): the supported customer update path and its safety invariants.
- [Customer rehearsal](../AGENTS.md#customer-rehearsal-cold-and-warm-start): the cold/warm-start scripts every change is validated with before hand-off.
- [Usage polling architecture](usage-polling-architecture.md): usage collection and latency behavior.
- [Preferences registry](preferences.md): typed local settings descriptors and the provider adapter.
- [Token usage support matrix](token-usage-support-matrix.md): token stats by provider shape.
- [Protocol](../protocol/PROTOCOL.md): frame protocol and payload details.

## Theme Docs

- [Themes](themes.md): public theme overview.
- [Theme packs](theme-packs.md): installable theme-pack format and CLI.
- [Theme development guide](theme-dev-guide.md): hardware-safe ThemeSpec and asset rules.
- [Shopify theme boundary](vibetv-shopify-theme-shop.md): separation between Shopify products and Mac App theme packaging.

## Product Wording

Some internal docs still mention legacy LaunchAgent or direct installer details
because they are useful for migration and support. For customer-facing copy,
prefer this wording:

- `Hosted setup` for `app.vibetv.shop`.
- `Control Center` for the local browser app opened by the Mac App.
- `Mac App` for the local `codexbar-display` service.
- `VibeTV` for the physical device.
- `Theme Library` for customer theme switching.

Avoid making customers reason about Companion APIs, daemons, firmware internals,
release assets, transport layers, or pairing tokens unless the document is
explicitly for operators or developers.
