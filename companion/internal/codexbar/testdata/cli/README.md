# Recorded CodexBar CLI output (issue #357)

Each directory holds one CodexBar build's recordings. Within each macOS set,
the commands ran on the same Mac with the same Codex and Claude logins within
a few minutes. The original set was recorded on 2026-09-02; later dates are
listed below. Account emails and the host name are redacted.

| Directory | Binary | Commands |
|---|---|---|
| `codexbar-macos-0.46.0` | pinned macOS CodexBar CLI from the installed VibeTV app | `usage --json --provider all|codex|claude --web-timeout 8`, `config providers --json`, `serve` → `/dashboard/v1/snapshot` (bearer) and `/usage` |
| `codexbar-macos-0.63.0` | the CodexBar release pinned by this repo, recorded 2026-09-21 | same commands |
| `codexbar-macos-0.80.0` | the CodexBar release pinned by this repo, recorded 2026-10-23 | same commands |
| `win-codexbar-0.55.0` | nesszer/Win-CodexBar tag v0.55.0, `cargo build -p codexbar --release`, run on macOS | same commands; `config providers` has no `--json` (text kept), `/usage` needed the bearer token and `?provider=all` |

The `codexbar-macos-0.46.0` set is kept as the previous pin: the keys the
Companion reads (`usage.primary`/`secondary`/`tertiary`, `extraRateWindows`,
the `{code, kind, message}` provider error, and dashboard `schemaVersion` 1)
are unchanged between the two, which is the evidence that the 0.46 → 0.63
bump does not move the CLI contract. Upstream's 0.48.0 "breaking JSON change"
removed provider-specific payload keys the Companion never read.

The `codexbar-macos-0.80.0` set pins the 0.75 → 0.80 bump the same way: the
keys above and dashboard `schemaVersion` 1 are unchanged; it adds the provider
ids `claudeplatform`, `futureagi`, `munito`, `soniox` and `traecn` and Codex's `openaiDashboard`
block. Account emails and ids, the home folder and the organization names are
redacted, including reset-credit ids.

Compared with the replaced 0.79.0 recordings, the 0.80.0 inventory adds
`soniox` and `traecn` (107 → 109 entries, including the local unloaded `crof`
plugin); existing inventory entries and snapshot key paths are unchanged.
Codex still reports `oauth`, a null primary window and a measured weekly
secondary window; Claude still reports `web`, Session, Weekly and Fable-only
windows. Optional pace ETAs and Notion identity vary with the recorded state.
`TestPinnedCLIFixtureReadiness` checks that Codex and Claude remain ready.

`TestCLIFixtures` in `cli_fixture_test.go` runs the Companion's real parsing paths over
every directory. The macOS set is the baseline and passes; the Win-CodexBar set records
the differences listed in #357.
