# Known-Good Firmware

Known-good recovery firmware is published as release assets for every stable tag.

## Source of Truth

For each release tag `vX.Y.Z`, the GitHub Release includes:
- `firmware-manifest-vX.Y.Z.json`
- `vibeblock-firmware-<env>-vX.Y.Z.bin` for all supported envs

The manifest contains environment, board, protocol version, firmware version, and checksums.

## Local Storage Convention

Recommended local mirror path:

- `~/Library/Application Support/vibeblock/known-good/`

Example layout:

- `~/Library/Application Support/vibeblock/known-good/firmware-manifest-v1.0.0.json`
- `~/Library/Application Support/vibeblock/known-good/vibeblock-firmware-esp8266_smalltv_st7789-v1.0.0.bin`

## Restore Paths

- Last-known-good rollback:

```bash
cd companion
go run ./cmd/vibeblock rollback --port /dev/cu.usbserial-10
```

- Explicit known-good image restore:

```bash
cd companion
go run ./cmd/vibeblock restore-known-good \
  --port /dev/cu.usbserial-10 \
  --image "$HOME/Library/Application Support/vibeblock/known-good/vibeblock-firmware-esp8266_smalltv_st7789-v1.0.0.bin"
```
