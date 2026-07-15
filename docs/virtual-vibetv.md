# Release-candidate testing with Virtual VibeTV

Issue #177 is implemented as three isolated layers:

1. native Go and firmware tests run on every commit;
2. Virtual VibeTV runs the real Companion HTTP, theme, frame, and OTA flow without physical hardware;
3. disposable Tart clones run the complete Mac installation and update journey from clean, legacy, and current-native source snapshots.

The candidate path does not merge `main`, create a Git tag, create a GitHub Release, or change production endpoints. The physical VibeTV remains a separate, explicitly approved final canary.

## Virtual VibeTV

Virtual VibeTV supports:

- stable `deviceId`, firmware version, capabilities, and pairing token;
- `GET /hello`, `GET /health`, and `GET /assets`;
- authenticated `POST /frame`, asset upload/delete, and `POST /theme/active`;
- `POST /update`, `POST /update/firmware`, and `POST /update/firmware.raw`;
- candidate SHA-256 validation and simulated reboot unavailability;
- prevention and reporting of an unnecessary second flash;
- unhealthy health, render failure, stream restart failure, device-never-returns, and accepted-upload/transport-error scenarios;
- wrong-device rejection and same-`deviceId` rediscovery at a changed address;
- a status timeline and virtual framebuffer.

Simulator-only read endpoints are:

- `GET /__virtual/state`: machine-readable state, writes, violations, and event timeline;
- `GET /framebuffer`: last accepted frame and render result.

Run it locally:

```bash
cd companion
go run ./cmd/virtual-vibetv \
  --firmware 1.0.43 \
  --candidate-firmware 1.0.44 \
  --scenario normal
```

## Private candidate bundle

The candidate bundle contains only short-lived test inputs:

- signed and notarized `VibeTV-Control-Center.dmg`;
- the verified current-public baseline DMG;
- EdDSA-signed update enclosure and signed private Sparkle `appcast.xml`;
- Sparkle's official external CLI updater, built from checksum-pinned 2.9.4 source;
- candidate firmware and local-only firmware manifest;
- local-only Mac App release metadata and installer;
- a Darwin-arm64 Virtual VibeTV binary;
- SHA-256 checksums and candidate build metadata.

All candidate URLs point to `127.0.0.1:47835` inside the guest. Production endpoints are never changed.

Build a bundle from prepared artifacts:

```bash
./scripts/release-candidate/create-candidate-bundle.sh \
  --dmg dist/macos/VibeTV-Control-Center.dmg \
  --baseline-dmg tmp/public-baseline.dmg \
  --baseline-version 1.0.44 \
  --firmware firmware_esp8266/.pio/build/esp8266_smalltv_st7789/firmware.bin \
  --virtual-vibetv tmp/virtual-vibetv \
  --sparkle-cli-archive tmp/sparkle-cli.tar.gz \
  --candidate 1.0.45 \
  --candidate-firmware 1.0.37 \
  --build 123 \
  --source-sha "$(git rev-parse HEAD)" \
  --sparkle-key-file /secure/path/sparkle-private-key \
  --output tmp/release-candidate-bundle
```

`--allow-unsigned-appcast` exists only for the fast infrastructure contract test. A real VM run rejects an unsigned appcast.

The manual GitHub Actions workflow `CODEX Test VibeTV Release Candidate` builds the candidate from any requested source ref, builds Sparkle's official CLI from pinned source, signs and notarizes the candidate in a separate trusted job, verifies the requested public baseline DMG, signs the update and private feed with Sparkle 2.9.4, and uploads the bundle with one-day retention. It publishes no release.

## macOS source snapshots

Tart uses Apple's Virtualization framework and requires an Apple-Silicon Mac. Install Tart once:

```bash
brew install cirruslabs/cli/tart
```

Prepare the three reusable source snapshots:

```bash
./scripts/prepare-release-candidate-vms.sh \
  --from-app <current-public-version> \
  --legacy-app <previous-public-or-migration-floor-version>
```

This creates:

- `CODEX-vibetv-clean`;
- `CODEX-vibetv-legacy-<resolved-version>`;
- `CODEX-vibetv-native-<current-public-version>`.

No legacy version is built into the scripts. The current local/Tart path requires the chosen migration baseline explicitly. The cloud target should instead resolve `current_public` and `previous_public` from stable release metadata at the beginning of every run, while keeping a separately governed `migration_floor` only when an older installation topology remains supported.

The source images are not modified during tests. Every test creates a uniquely named `CODEX-rc-*` clone. The clone is stopped and deleted after the run, even on failure. `--keep-failed-vm` is the only explicit exception and is intended for debugging.

The default clean base is `ghcr.io/cirruslabs/macos-sequoia-base:latest`, whose Tart Guest Agent allows non-interactive `tart exec` commands. A different source can be passed with `--base-image`.

## One reproducible command

Run all three customer states:

```bash
./scripts/test-release-candidate.sh \
  --from-app 1.0.44 \
  --legacy-app 1.0.43 \
  --from-firmware 1.0.36 \
  --candidate 1.0.45 \
  --candidate-firmware 1.0.37 \
  --bundle tmp/release-candidate-bundle
```

Use `--skip-mac-update` for a firmware-only run or `--skip-firmware-update` for a Mac-only run. A skipped component is recorded explicitly in `result.json`; it is not reported as an update success.

For each state the guest verifies:

- installation under `/Applications`;
- candidate app version and bundle build;
- background runtime version;
- the expected `SMAppService` and its unique PID;
- sole ownership of port `127.0.0.1:47832`;
- absence of duplicate legacy services;
- current-public first install or legacy migration before the candidate update;
- real Sparkle download, app replacement, and relaunch from private sources;
- private candidate sources, signed update, and signed feed;
- firmware OTA and reboot recovery;
- rediscovery using the same `deviceId`;
- healthy `/health`, stream, and render state;
- a second update is `already_current` and performs no second OTA upload.

The output directory contains:

- `result.json`: aggregate machine result;
- `summary.md`: human result;
- one result directory per source state;
- status, update-job, device, and Virtual VibeTV JSON evidence;
- event timelines, logs, and final screenshots;
- host VM lifecycle log proving clone disposal.

Mac App and firmware candidates can be tested together or independently with the explicit skip flags. If the candidate firmware version already equals the public source version, the normal firmware path additionally proves that the update is a zero-upload no-op.

## CI pyramid

- Every commit: `go test ./...` covers native behavior and Virtual VibeTV integration; `test-release-candidate-contract.sh` covers bundle creation, three-state VM orchestration, result aggregation, and clone disposal with a fake driver.
- Every candidate: the manual workflow creates private one-day artifacts.
- Optional full candidate gate: a prepared Apple-Silicon runner with labels `self-hosted`, `macOS`, `ARM64`, and `codex-vibetv-rc` runs the Tart matrix.
- Before release: one separately approved physical VibeTV canary. This infrastructure never performs that hardware write automatically.

The VM design follows Apple's Virtualization framework model and Tart's documented clone, shared-directory, Guest Agent, and command-execution flow. Sparkle's pinned official `sign_update` tool signs both the candidate DMG entry and the private feed. The guest then uses Sparkle's official CLI to terminate the running public app, download and verify the candidate, replace it, and relaunch it.
