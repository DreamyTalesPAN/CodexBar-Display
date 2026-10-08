# Recorded CodexBar CLI output (issue #357)

Each directory holds one CodexBar build's recordings, made on the same Mac with
the same Codex and Claude logins within a few minutes of each other
(2026-09-02). Account emails and the host name are redacted.

| Directory | Binary | Commands |
|---|---|---|
| `codexbar-macos-0.46.0` | pinned macOS CodexBar CLI from the installed VibeTV app | `usage --json --provider all|codex|claude --web-timeout 8`, `config providers --json`, `serve` → `/dashboard/v1/snapshot` (bearer) and `/usage` |
| `codexbar-macos-0.63.0` | the CodexBar release pinned by this repo, recorded 2026-09-21 | same commands |
| `win-codexbar-0.55.0` | nesszer/Win-CodexBar tag v0.55.0, `cargo build -p codexbar --release`, run on macOS | same commands; `config providers` has no `--json` (text kept), `/usage` needed the bearer token and `?provider=all` |

The `codexbar-macos-0.46.0` set is kept as the previous pin: the keys the
Companion reads (`usage.primary`/`secondary`/`tertiary`, `extraRateWindows`,
the `{code, kind, message}` provider error, and dashboard `schemaVersion` 1)
are unchanged between the two, which is the evidence that the 0.46 → 0.63
bump does not move the CLI contract. Upstream's 0.48.0 "breaking JSON change"
removed provider-specific payload keys the Companion never read.

`TestCLIFixtures` in `cli_fixture_test.go` runs the Companion's real parsing paths over
every directory. The macOS set is the baseline and passes; the Win-CodexBar set records
the differences listed in #357.
