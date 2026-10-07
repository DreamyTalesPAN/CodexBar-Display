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

`vibetv.usage.displayMode` decides whether percentages count what is used or
what remains, on the VibeTV frame and in `GET /v1/usage` alike. `null` follows
CodexBar's own setting, as before this preference existed; `effectiveValue`
then reports the mode in use. An explicit value wins over CodexBar's setting.
Settings shows it as `Usage display` with `Default`, `Used` and `Remaining`.

```http
PATCH /v1/preferences/vibetv.usage.displayMode
{"value": "remaining"}
```

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
