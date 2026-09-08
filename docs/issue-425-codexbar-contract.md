# Issue #425: CodexBar 0.56.8 contract check

## Pinned runtime

- Release: `steipete/CodexBar` tag `v0.56.8`.
- Archive: `CodexBar-macos-universal-0.56.8.zip`.
- SHA256: `76541469ef4132c9e3f298d876665701ea472312a6d2cb6326ba49bfb6acad10`.
- The downloaded bytes match GitHub's release-asset digest. The existing bundle
  verifier passes the manifest, MIT license hash, deep code signature, team
  identifier `Y5PE65HELJ`, FinderInfo normalization and Apple notarization checks.

## Exported contract

Checked against the release's actual `CodexBarCLI` with `CODEXBAR_CONFIG` pointing
at a disposable worktree file, without changing the customer's configuration:

- `--version`: `CodexBar 0.56.8`.
- `config dump --json` and `config validate --json`: compatible with bootstrap.
- `config providers --json`: existing `provider`, `displayName`, `enabled` and
  `defaultEnabled` fields, including Gemini and Antigravity.
- `config enable/disable --provider antigravity --json`: writes/readbacks use the
  existing toggle contract and the disposable configuration path.
- `usage --json --status --web-timeout 8` with all providers disabled: `[]` and
  exit 0. No account collection or credential migration was run on this Mac.

The tagged `CLIErrorReporting.swift` exports `error.code`, `error.message` and
`error.kind`. `CLIHelpers.mapError` maps **both**
`GeminiStatusProbeError.consumerTierDeprecated` and several parse/OAuth errors
to code 3. There is no exported migration identifier or destination field.

The tagged `GeminiStatusProbe.swift` detects the supplied HTTP-200
`loadCodeAssist.ineligibleTiers` / `UNSUPPORTED_CLIENT` response without a current
tier. Its subsequent quota-403 handling requires the unsupported-client signal
and account-tier checks; a licensed account's unrelated 403 stays an API error.
VibeTV does not duplicate these Google rules.

`GeminiConsumerTierMigration.deprecationError` supplies the exact guidance:

> Google no longer supports Gemini CLI OAuth for individual, AI Pro, or Ultra accounts. Enable CodexBar's Antigravity provider, sign in to Antigravity or run `agy`, then refresh.

VibeTV recognizes an explicit end-of-support statement before incidental OAuth
or sign-in words. Other 403, parse and authentication errors remain separate.
The original message still passes through the existing redactor. Terminal
`unsupported` cannot be upgraded to ready by an old saved reading.

The shared provider list uses the Screen 07 notice layout from the imported
Claude Design project for every provider notice: name and toggle in the header,
a full-width separator, then customer guidance and any actions in one row.
The guidance wraps as needed; actions stay aligned to its right. Ready,
disabled and initially checking rows retain their compact presentation.

For an upstream-declared migration, the replacement must exist in the current
provider inventory and be named in the upstream guidance. The explicit `Turn on
Antigravity` button uses the same settings callback as its toggle. It does not
change Gemini's setting or search/filter the list. Once Antigravity is enabled,
the card shows the already-on explanation and removes the enable action.
Continue still requires an enabled provider with displayable data. No Google
API requests, credential inspection, alternate usage path or silent migration
were added.

Design source: [Setup Wizard Redesign, Screen 07](https://claude.ai/design/p/36eb7a1c-bd59-42f0-b120-3f1eb3905e4b?file=Setup+Wizard+Redesign.dc.html),
read through the official Claude Design MCP on 2026-09-08 (file etag
`1788871113392683`). The user's subsequent instruction applies the notice
layout globally to all providers, not only Gemini. The imported token files
match the existing Geist font, color palette, 12px card radius and 36px small
button. Source assets and local screenshots are kept under
`tmp/issue425/design-import/`.

## Validation boundaries

Regression fixtures cover the exported migration message, the shared numeric
error code, unrelated/license 403, ordinary sign-in failures, Antigravity weekly
usage, descriptor redaction/readiness, and explicit replacement enablement.
The browser flow exercises the visible wizard against mocked Companion replies
on desktop, matching the requested product scope. It does not prove live Google
quota access on this Mac.

The user approved the final desktop screenshots on 2026-09-08; the exact
shared notice layout and inline actions are recorded in
`docs/control-center-customer-ui-approval.md`.
The installed Mac App and real VibeTV were not modified or used as test targets.
