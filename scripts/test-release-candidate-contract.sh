#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-rc-contract.XXXXXX")"
cleanup() {
  rm -rf "$WORK"
}
trap cleanup EXIT HUP INT TERM

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

mkdir -p "$WORK/input"
printf 'fake dmg' > "$WORK/input/VibeTV-Control-Center.dmg"
printf 'fake public baseline dmg' > "$WORK/input/public-baseline.dmg"
printf 'fake firmware' > "$WORK/input/firmware.bin"
cat > "$WORK/input/virtual-vibetv" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod 755 "$WORK/input/virtual-vibetv"
mkdir -p "$WORK/input/sparkle.app/Contents/MacOS"
printf '#!/usr/bin/env bash\nexit 0\n' > "$WORK/input/sparkle.app/Contents/MacOS/sparkle"
chmod 755 "$WORK/input/sparkle.app/Contents/MacOS/sparkle"
tar -czf "$WORK/input/sparkle-cli.tar.gz" -C "$WORK/input" sparkle.app

"$ROOT/scripts/release-candidate/create-candidate-bundle.sh" \
  --dmg "$WORK/input/VibeTV-Control-Center.dmg" \
  --baseline-dmg "$WORK/input/public-baseline.dmg" \
  --baseline-version 1.0.43 \
  --firmware "$WORK/input/firmware.bin" \
  --virtual-vibetv "$WORK/input/virtual-vibetv" \
  --sparkle-cli-archive "$WORK/input/sparkle-cli.tar.gz" \
  --candidate 9.8.7 \
  --candidate-firmware 9.8.6 \
  --build 123 \
  --source-sha abcdef1234567890 \
  --output "$WORK/bundle" \
  --allow-unsigned-appcast \
  > "$WORK/bundle.log"

for required in candidate.json checksums.txt appcast.xml firmware-manifest.json mac-app-release.json \
  VibeTV-Control-Center.dmg public-baseline.dmg firmware.bin sparkle-cli.tar.gz \
  virtual-vibetv install-candidate-mac-app.sh; do
  [[ -f "$WORK/bundle/$required" ]] || fail "bundle missing $required"
done
(
  cd "$WORK/bundle"
  shasum -a 256 -c checksums.txt >/dev/null
) || fail "bundle checksums do not verify"
python3 - "$WORK/bundle/candidate.json" "$WORK/bundle/firmware-manifest.json" <<'PY' || fail "bundle metadata is wrong"
import json, sys
candidate = json.load(open(sys.argv[1]))
firmware = json.load(open(sys.argv[2]))
assert candidate["candidate"] == "9.8.7"
assert candidate["candidateFirmware"] == "9.8.6"
assert candidate["baselineApp"] == "1.0.43"
assert candidate["private"] is True
assert firmware["artifacts"][0]["firmwareVersion"] == "9.8.6"
PY

export VIBETV_RC_FAKE_DRIVER_LOG="$WORK/fake-driver.log"
"$ROOT/scripts/test-release-candidate.sh" \
  --from-app 1.0.43 \
  --legacy-app 1.0.42 \
  --from-firmware 1.0.36 \
  --candidate 9.8.7 \
  --candidate-firmware 9.8.6 \
  --bundle "$WORK/bundle" \
  --vm-driver fake \
  --output "$WORK/run" \
  > "$WORK/run.log"

python3 - "$WORK/run/result.json" <<'PY' || fail "aggregate result is wrong"
import json, sys
result = json.load(open(sys.argv[1]))
assert result["status"] == "passed"
assert [item["state"] for item in result["states"]] == ["clean", "legacy", "native"]
assert all(item["checks"]["snapshotDisposed"] for item in result["states"])
PY
[[ "$(grep -c '^clone ' "$WORK/fake-driver.log")" == "3" ]] || fail "expected three VM clones"
[[ "$(grep -c '^delete ' "$WORK/fake-driver.log")" == "3" ]] || fail "expected three disposed VM clones"

if "$ROOT/scripts/release-candidate/create-candidate-bundle.sh" \
  --dmg "$WORK/input/VibeTV-Control-Center.dmg" \
  --baseline-dmg "$WORK/input/public-baseline.dmg" \
  --baseline-version 1.0.43 \
  --firmware "$WORK/input/firmware.bin" \
  --virtual-vibetv "$WORK/input/virtual-vibetv" \
  --sparkle-cli-archive "$WORK/input/sparkle-cli.tar.gz" \
  --candidate 9.8.7 \
  --build 123 \
  --source-sha abcdef1234567890 \
  --output "$WORK/should-fail" \
  > "$WORK/unsigned.log" 2>&1; then
  fail "real bundle unexpectedly allowed an unsigned appcast"
fi

workflow="$ROOT/.github/workflows/release-candidate.yml"
grep -q '^name: CODEX Test VibeTV Release Candidate$' "$workflow" \
  || fail "candidate workflow name must use the CODEX prefix"
grep -q 'ref: \${{ github.workflow_sha }}' "$workflow" \
  || fail "secret-bearing jobs must use trusted workflow source"
grep -q 'SPARKLE_ED_PRIVATE_KEY_BASE64' "$workflow" \
  || fail "candidate workflow does not create a signed private appcast"
grep -q 'build-sparkle-cli.sh' "$workflow" \
  || fail "candidate workflow does not build Sparkle's official CLI updater"
grep -q 'extract-candidate-app-archive.sh' "$workflow" \
  || fail "secret-bearing job does not use the safe candidate app extractor"
grep -q 'retention-days: 1' "$workflow" \
  || fail "candidate artifacts are not short-lived"
grep -q 'runs-on: \[self-hosted, macOS, ARM64, codex-vibetv-rc\]' "$workflow" \
  || fail "real VM gate is not isolated to the prepared Apple-Silicon runner"
if grep -Eq 'gh release|git tag|git push origin main|releases/create' "$workflow"; then
  fail "candidate workflow must not merge, tag, or publish"
fi
grep -q 'SPARKLE_SOURCE_SHA256=' "$ROOT/scripts/release-candidate/build-sparkle-cli.sh" \
  || fail "Sparkle CLI source is not checksum-pinned"
grep -q 'sparkle.app/Contents/MacOS/sparkle' "$ROOT/scripts/release-candidate/guest-run.sh" \
  || fail "real guest path does not invoke Sparkle CLI"
if grep -R -q 'CODEX-vibetv-legacy-1\.0\.41\|LEGACY_APP="1\.0\.41"' \
  "$ROOT/scripts" "$ROOT/docs/virtual-vibetv.md"; then
  fail "legacy baseline must not be hard-coded to 1.0.41"
fi

mkdir -p "$WORK/safe-app/VibeTV Control Center.app/Contents"
printf '<plist version="1.0"><dict/></plist>\n' \
  > "$WORK/safe-app/VibeTV Control Center.app/Contents/Info.plist"
COPYFILE_DISABLE=1 tar -czf "$WORK/safe-app.tar.gz" -C "$WORK/safe-app" "VibeTV Control Center.app"
"$ROOT/scripts/release-candidate/extract-candidate-app-archive.sh" \
  --archive "$WORK/safe-app.tar.gz" \
  --output "$WORK/safe-extracted" >/dev/null \
  || fail "safe candidate app archive was rejected"

python3 - "$WORK/malicious-app.tar.gz" <<'PY'
import io, tarfile, sys
with tarfile.open(sys.argv[1], "w:gz") as archive:
    payload = b"overwrite"
    member = tarfile.TarInfo("../../scripts/release-candidate/guest-run.sh")
    member.size = len(payload)
    archive.addfile(member, io.BytesIO(payload))
PY
if "$ROOT/scripts/release-candidate/extract-candidate-app-archive.sh" \
  --archive "$WORK/malicious-app.tar.gz" \
  --output "$WORK/malicious-extracted" >/dev/null 2>&1; then
  fail "unsafe candidate app archive path was accepted"
fi

printf 'PASS: release-candidate bundle, VM lifecycle, reports, and disposal contract\n'
