# Troubleshooting

Primary operator procedures live in:

- `docs/operator-runbook.md`

This page is intentionally short and only points to the canonical runbook.

## Fast Path

```bash
cd companion
go run ./cmd/vibeblock health
go run ./cmd/vibeblock doctor
./scripts/smoke-daemon-sent-frame.sh
```

If issues remain, follow the matching section in `docs/operator-runbook.md`:
- Serial busy / flashing blocked
- LaunchAgent not running
- No new `sent frame` entries
- Restore verification failures (manifest/SHA/MAC)
