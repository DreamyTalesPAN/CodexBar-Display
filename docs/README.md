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

## Device And Release Docs

- [Hardware contract](hardware-contract.md): firmware, WiFi, display, and endpoint contract.
- [Firmware provisioning](firmware-provisioning.md): provisioning and OTA packaging.
- [Firmware guardrails](firmware-guardrails.md): firmware safety rules.
- [Operator runbook](operator-runbook.md): support, recovery, and smoke-test procedures.
- [Usage polling architecture](usage-polling-architecture.md): usage collection and latency behavior.
- [Preferences registry](preferences.md): typed local settings descriptors and the provider adapter.
- [Token usage support matrix](token-usage-support-matrix.md): token stats by provider shape.
- [Protocol](../protocol/PROTOCOL.md): frame protocol and payload details.

## Theme Docs

- [Themes](themes.md): public theme overview.
- [Theme packs](theme-packs.md): installable theme-pack format and CLI.
- [Theme development guide](theme-dev-guide.md): hardware-safe ThemeSpec and asset rules.
- [Theme shop notes](vibetv-shopify-theme-shop.md): Shopify catalog and Control Center integration.

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
