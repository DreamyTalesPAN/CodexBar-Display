# Control Center Preferences Registry

The local VibeTV Mac App exposes one typed preferences contract for safe
Control Center settings:

```http
GET /v1/preferences
GET /v1/preferences?section=providers
GET /v1/preferences?section=display
PATCH /v1/preferences/{settingId}
```

The first production adapter is the `providers` section. It reads the complete
provider inventory from the supported CodexBar CLI, changes real CodexBar
provider enablement, and never stores a second VibeTV provider list. The
`display` section holds the Mac App's own display preferences.

## Descriptor contract

Every item has a stable `id`, `section`, `owner`, `type`, `value`,
`effectiveValue`, availability, write strategy, and writable state. Supported
types are:

- `boolean`
- `enum`
- `integer`
- `duration`
- `string`
- `secret`
- `action`

Enum descriptors carry their options. Integer and duration descriptors carry
optional minimum, maximum, step, and unit constraints. Inheritable settings use
`null` for their current value and set `allowsDefault: true`; Control Center
labels that state exactly `Default`.

The Mac App validates type, registered enum options, numeric range, step, and
inheritance before invoking an adapter. Unknown IDs and unavailable settings
are rejected. Adding a future adapter does not require another HTTP endpoint.

## Provider adapter

Provider descriptors are generated in a loop from:

```text
codexbar config providers --json
```

Writes use direct process arguments for one of:

```text
codexbar config enable --provider <id>
codexbar config disable --provider <id>
```

After enabling or retrying a provider, the adapter verifies that exact inventory
entry with:

```text
codexbar usage --json --provider <id> --source auto --web-timeout 8
```

Another working provider cannot make the requested provider appear ready.
Provider-specific source fallback, authentication checks, and quota/model
mapping remain owned by CodexBar.
Disabled inventory entries are also removed from the Companion usage response,
including stale persisted snapshots.

The browser receives only stable health states and short recovery messages.
Local sign-in/setup health and upstream service status remain separate.

## Display adapter

Display preferences are owned by VibeTV (`owner: "vibetv"`,
`writeStrategy: "vibetv_override"`). They are stored in the Mac App's runtime
configuration, and a write re-renders the VibeTV frame from the usage already
collected. No provider is asked again and nothing in CodexBar is changed.

| ID | Type | Values |
| --- | --- | --- |
| `vibetv.usage.displayMode` | `enum`, `allowsDefault` | `null` (Default), `"used"`, `"remaining"` |
| `vibetv.display.rotateSeconds` | `enum` | `"0"` (When activity changes), `"30"`, `"60"`, `"300"` |

`vibetv.usage.displayMode` decides whether percentages count what is used or
what remains, on the VibeTV frame and in `GET /v1/usage` alike. `null` follows
CodexBar's own setting, as before this preference existed; `effectiveValue`
then reports the mode in use. An explicit value wins over CodexBar's setting.
Settings shows it as `Usage display` with `Default`, `Used` and `Remaining`.

```http
PATCH /v1/preferences/vibetv.usage.displayMode
{"value": "remaining"}
```

`vibetv.display.rotateSeconds` decides when the Automatic display mode moves
to another provider. Settings shows it under the Automatic card as
`Switch providers`. It is stored beside the display selection, not inside it,
so saving `/v1/provider-display` never changes it.

```http
PATCH /v1/preferences/vibetv.display.rotateSeconds
{"value": "30"}
```

### What Automatic does

Automatic shows one provider at a time. Only providers that are switched on
and have a current reading take part; a provider without one is skipped, and a
single remaining provider simply stays on screen.

- `"0"`, `When activity changes` (the default): VibeTV shows the provider whose
  usage rose since the previous reading. If several rose, the larger rise wins
  (token counts before percentages), and an equal rise goes to the provider
  that comes first in CodexBar's order. While nothing rises, the provider on
  screen stays. With no provider shown yet, the first one in CodexBar's order
  is shown.
- `"30"`, `"60"`, `"300"`: the timer alone decides. Each provider keeps the
  screen for that many seconds, then the next one in CodexBar's order follows.
  Usage on another provider does not cut a turn short. Switching the timer on
  starts with the provider already on screen.

The timer is checked each time a frame is sent. The Mac App sends one every 2
seconds over USB-C and every 30 seconds over WiFi, so over WiFi a switch can
come up to 30 seconds late. The `coding`/`idle` state in the frame is the same
in both cases and covers all providers, so the screensaver does not depend on
which provider is on screen. Manual ignores this preference.

Brightness and the screensaver stay on `/v1/settings`; they are device
settings and are not part of this section.

## Security boundaries

- Never use or expose `config dump`.
- Never return raw CodexBar command errors, cookies, tokens, API keys, account
  emails, or credential values.
- A `secret` descriptor returns only `configured` or `not_configured`; its
  `value` and `effectiveValue` stay `null`.
- Do not put provider state in browser storage, VibeTV runtime configuration,
  Theme Studio drafts, ThemeSpec, or theme packs.
- Display preferences live in the runtime configuration only. They never
  change theme drafts, ThemeSpec, theme packs, or Theme Studio dirty state.
- Credential entry, OAuth, and provider-specific integrations are outside this
  registry slice.
- No device or firmware write is needed for provider preferences.

Existing `/v1/usage`, brightness, device, and theme APIs remain compatible.
