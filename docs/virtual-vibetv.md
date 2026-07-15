# Virtual VibeTV

Virtual VibeTV is a lightweight, protocol-faithful simulator of the observable
VibeTV device behavior. It reproduces the real Companion HTTP, theme, frame, and
OTA flow without physical hardware, so the update client can be exercised
deterministically on every commit. It does **not** emulate the ESP8266 processor,
Wi-Fi, bootloader, flash timing, or display timing.

This is the first layer of the release-candidate testing described in issue #177.
The macOS VM snapshot and private-candidate-artifact layers are added separately.

## What it simulates

Virtual VibeTV supports:

- stable `deviceId`, firmware version, capabilities, and pairing token;
- `GET /hello`, `GET /health`, and `GET /assets`;
- authenticated `POST /frame`, asset upload/delete, and `POST /theme/active`;
- `POST /update`, `POST /update/firmware`, and `POST /update/firmware.raw`;
- candidate SHA-256 validation and simulated reboot unavailability;
- prevention and reporting of an unnecessary second flash;
- unhealthy health, render failure, stream restart failure, device-never-returns,
  and accepted-upload/transport-error scenarios;
- wrong-device rejection and same-`deviceId` rediscovery at a changed address;
- a status timeline and virtual framebuffer.

Simulator-only read endpoints are:

- `GET /__virtual/state`: machine-readable state, writes, violations, and event timeline;
- `GET /framebuffer`: last accepted frame and render result.

## Scenarios

`--scenario` selects one deterministic behavior:

| Scenario                   | Behavior verified                                                        |
| -------------------------- | ------------------------------------------------------------------------ |
| `normal`                   | full happy-path OTA, reboot, rediscovery, health, stream, render         |
| `different-device`         | a different `deviceId` responds after the update and is rejected         |
| `never-returns`            | the device never comes back after the update                            |
| `health-unhealthy`         | `/health` keeps reporting an unhealthy device                            |
| `render-fails`             | render verification fails                                                 |
| `stream-restart-fails`     | the stream does not restart cleanly                                      |
| `accepted-transport-error` | the OTA is accepted but the HTTP acknowledgement is dropped              |

## Run it locally

```bash
cd companion
go run ./cmd/virtual-vibetv \
  --firmware 1.0.43 \
  --candidate-firmware 1.0.44 \
  --scenario normal
```

The real firmware update client is exercised against the simulator by the Go
integration tests in `companion/cmd/codexbar-display/release_commands_test.go`,
which run as part of `go test ./...` on every commit. Those tests prove, among
other things, that:

- `already_current` firmware performs no OTA upload and reports no second flash;
- an accepted OTA that then drops its HTTP acknowledgement is not blindly
  re-flashed — the client verifies the candidate version before retrying;
- rediscovery only accepts a device reporting the original `deviceId`.
