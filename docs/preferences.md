# Control Center Preferences Registry

The local VibeTV Mac App exposes one typed preferences contract for safe
Control Center settings:

```http
GET /v1/preferences
GET /v1/preferences?section=providers
PATCH /v1/preferences/{settingId}
```

The first production adapter is the `providers` section. It reads the complete
provider inventory from the supported CodexBar CLI, changes real CodexBar
provider enablement, and never stores a second VibeTV provider list.

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

## Security boundaries

- Never use or expose `config dump`.
- Never return raw CodexBar command errors, cookies, tokens, API keys, account
  emails, or credential values.
- A `secret` descriptor returns only `configured` or `not_configured`; its
  `value` and `effectiveValue` stay `null`.
- Do not put provider state in browser storage, VibeTV runtime configuration,
  Theme Studio drafts, ThemeSpec, or theme packs.
- Credential entry, OAuth, and provider-specific integrations are outside this
  registry slice.
- No device or firmware write is needed for provider preferences.

Existing `/v1/usage`, brightness, device, and theme APIs remain compatible.
