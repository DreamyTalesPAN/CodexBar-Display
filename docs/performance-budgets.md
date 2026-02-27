# Performance Budgets

This document defines measurable runtime budgets for companion and firmware.

## Companion (Go)

### Benchmarks

```bash
cd companion
go test ./internal/daemon -run '^$' -bench 'BenchmarkRunCycleWithDeps|BenchmarkMarshalFrameWithinLimit' -benchmem -count=1
```

CI budget gate:

```bash
./scripts/check-companion-bench-budget.sh
```

### Budget Limits

| Metric | Budget | Source |
|---|---|---|
| `BenchmarkRunCycleWithDeps` `ns/op` | <= `50000` | `scripts/check-companion-bench-budget.sh` (`MAX_CYCLE_NS`) |
| `BenchmarkRunCycleWithDeps` `allocs/op` | <= `160` | `scripts/check-companion-bench-budget.sh` (`MAX_CYCLE_ALLOCS`) |
| `BenchmarkMarshalFrameWithinLimit` `ns/op` | <= `1000` | `scripts/check-companion-bench-budget.sh` (`MAX_MARSHAL_NS`) |
| `BenchmarkMarshalFrameWithinLimit` `allocs/op` | <= `4` | `scripts/check-companion-bench-budget.sh` (`MAX_MARSHAL_ALLOCS`) |

## Firmware Runtime (ESP8266 / ESP32)

Runtime bench metrics are emitted when firmware is built with `VIBEBLOCK_RUNTIME_BENCH`.

Bench-enabled envs:
- ESP8266: `esp8266_probe_bench`
- ESP32: `lilygo_t_display_s3_bench`

### ESP8266 Command

```bash
cd firmware_esp8266
pio run -e esp8266_probe_bench -t upload --upload-port /dev/cu.usbserial-10
pio device monitor --baud 115200
```

### ESP32 Command

```bash
cd firmware
pio run -e lilygo_t_display_s3_bench -t upload --upload-port /dev/cu.usbmodem101
pio device monitor --baud 115200
```

Expected runtime metric line (once per minute window):

```text
bench board=<board-id> loops=<n> renders=<n> loop_cpu_us_max=<us> render_us_max=<us>
```

### Budget Limits

| Target | `loop_cpu_us_max` | `render_us_max` | Notes |
|---|---|---|---|
| ESP8266 (`esp8266_probe_bench`) | <= `2500` | <= `45000` | Includes JSON parse + runtime update path |
| ESP32 (`lilygo_t_display_s3_bench`) | <= `2000` | <= `30000` | Parallel display path is expected to render faster |

## Static Size Budgets (Existing Gate)

Firmware RAM/Flash percentage budgets are enforced in CI via:
- `scripts/check-firmware-size-budget.sh`
- `.github/workflows/ci.yml` firmware matrix thresholds
