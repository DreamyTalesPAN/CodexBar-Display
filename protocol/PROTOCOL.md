# vibeblock Protocol v1

Transport is line-delimited JSON over USB CDC serial at `115200` baud.

Each frame must be a single JSON object followed by `\n`.

## Usage Frame

```json
{"v":1,"provider":"claude","label":"Claude","session":73,"weekly":45,"resetSecs":8040}
```

Fields:
- `v` (number, required): protocol version. V1 is `1`.
- `provider` (string, optional): provider machine key.
- `label` (string, optional): display label.
- `session` (number, optional): session usage percent `0..100`.
- `weekly` (number, optional): weekly usage percent `0..100`.
- `resetSecs` (number, optional): seconds remaining until reset.
- `error` (string, optional): if present, firmware should render error screen.

## Error Frame

```json
{"v":1,"error":"codexbar unavailable"}
```

## Rules
- Unknown fields are ignored.
- Missing numeric fields default to `0` on firmware side.
- Host should send at least every 60 seconds.
- Firmware ticks down `resetSecs` locally between host updates.
- Companion may resend the last known good frame during short CodexBar outages (current default max age: 10 minutes).
