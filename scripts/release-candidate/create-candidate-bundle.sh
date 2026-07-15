#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SPARKLE_VERSION="2.9.4"
SPARKLE_SHA256="ce89daf967db1e1893ed3ebd67575ed82d3902563e3191ca92aaec9164fbdef9"
SPARKLE_URL="https://github.com/sparkle-project/Sparkle/releases/download/${SPARKLE_VERSION}/Sparkle-${SPARKLE_VERSION}.tar.xz"

DMG=""
FIRMWARE=""
VIRTUAL_VIBETV=""
BASELINE_DMG=""
BASELINE_VERSION=""
SPARKLE_CLI_ARCHIVE=""
CANDIDATE=""
CANDIDATE_FIRMWARE=""
BUILD=""
SOURCE_SHA=""
OUTPUT=""
SPARKLE_KEY_FILE=""
ALLOW_UNSIGNED=0

usage() {
  cat <<'EOF'
Usage:
  create-candidate-bundle.sh \
    --dmg path.dmg --baseline-dmg public.dmg --baseline-version x.y.z \
    --firmware firmware.bin --virtual-vibetv path --sparkle-cli-archive path.tar.gz \
    --candidate x.y.z [--candidate-firmware x.y.z] --build n --source-sha sha --output dir \
    --sparkle-key-file private-key

Creates a short-lived, private release-candidate bundle. Use
--allow-unsigned-appcast only for local contract tests; real candidate bundles
must use Sparkle's EdDSA-signed appcast.
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

need_value() {
  [[ -n "${2:-}" ]] || die "$1 needs a value"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dmg) need_value "$1" "${2:-}"; DMG="$2"; shift 2 ;;
    --baseline-dmg) need_value "$1" "${2:-}"; BASELINE_DMG="$2"; shift 2 ;;
    --baseline-version) need_value "$1" "${2:-}"; BASELINE_VERSION="${2#v}"; shift 2 ;;
    --firmware) need_value "$1" "${2:-}"; FIRMWARE="$2"; shift 2 ;;
    --virtual-vibetv) need_value "$1" "${2:-}"; VIRTUAL_VIBETV="$2"; shift 2 ;;
    --sparkle-cli-archive) need_value "$1" "${2:-}"; SPARKLE_CLI_ARCHIVE="$2"; shift 2 ;;
    --candidate) need_value "$1" "${2:-}"; CANDIDATE="${2#v}"; shift 2 ;;
    --candidate-firmware) need_value "$1" "${2:-}"; CANDIDATE_FIRMWARE="${2#v}"; shift 2 ;;
    --build) need_value "$1" "${2:-}"; BUILD="$2"; shift 2 ;;
    --source-sha) need_value "$1" "${2:-}"; SOURCE_SHA="$2"; shift 2 ;;
    --output) need_value "$1" "${2:-}"; OUTPUT="$2"; shift 2 ;;
    --sparkle-key-file) need_value "$1" "${2:-}"; SPARKLE_KEY_FILE="$2"; shift 2 ;;
    --allow-unsigned-appcast) ALLOW_UNSIGNED=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ "$CANDIDATE" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] \
  || die "--candidate must be a SemVer release version"
[[ "$BASELINE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] \
  || die "--baseline-version must be a SemVer release version"
[[ -n "$CANDIDATE_FIRMWARE" ]] || CANDIDATE_FIRMWARE="$CANDIDATE"
[[ "$CANDIDATE_FIRMWARE" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] \
  || die "--candidate-firmware must be a SemVer release version"
[[ "$BUILD" =~ ^[0-9]+$ ]] || die "--build must be numeric"
[[ "$SOURCE_SHA" =~ ^[0-9a-fA-F]{7,64}$ ]] || die "--source-sha must be a git SHA"
[[ -f "$DMG" ]] || die "DMG not found: $DMG"
[[ -f "$BASELINE_DMG" ]] || die "baseline DMG not found: $BASELINE_DMG"
[[ -f "$FIRMWARE" ]] || die "firmware not found: $FIRMWARE"
[[ -x "$VIRTUAL_VIBETV" ]] || die "Virtual VibeTV binary is not executable: $VIRTUAL_VIBETV"
[[ -f "$SPARKLE_CLI_ARCHIVE" ]] || die "Sparkle CLI archive not found: $SPARKLE_CLI_ARCHIVE"
[[ -n "$OUTPUT" && "$OUTPUT" != "/" ]] || die "safe --output directory is required"
if [[ -z "$SPARKLE_KEY_FILE" && "$ALLOW_UNSIGNED" != "1" ]]; then
  die "real candidate bundles require --sparkle-key-file"
fi
if [[ -n "$SPARKLE_KEY_FILE" ]]; then
  [[ -f "$SPARKLE_KEY_FILE" ]] || die "Sparkle private key file not found"
  [[ "$(stat -f '%Lp' "$SPARKLE_KEY_FILE" 2>/dev/null || stat -c '%a' "$SPARKLE_KEY_FILE")" == "600" ]] \
    || die "Sparkle private key file must have mode 600"
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-candidate.XXXXXX")"
cleanup() {
  rm -rf "$WORK"
}
trap cleanup EXIT HUP INT TERM

if [[ -d "$OUTPUT" ]] && find "$OUTPUT" -mindepth 1 -maxdepth 1 | grep -q .; then
  die "output directory must be empty: $OUTPUT"
fi
mkdir -p "$OUTPUT"
cp "$DMG" "$OUTPUT/VibeTV-Control-Center.dmg"
cp "$BASELINE_DMG" "$OUTPUT/public-baseline.dmg"
cp "$FIRMWARE" "$OUTPUT/firmware.bin"
cp "$SPARKLE_CLI_ARCHIVE" "$OUTPUT/sparkle-cli.tar.gz"
cp "$VIRTUAL_VIBETV" "$OUTPUT/virtual-vibetv"
chmod 755 "$OUTPUT/virtual-vibetv"
cp "$ROOT/scripts/release-candidate/install-candidate-mac-app.sh" "$OUTPUT/install-candidate-mac-app.sh"
chmod 755 "$OUTPUT/install-candidate-mac-app.sh"

firmware_sha="$(shasum -a 256 "$OUTPUT/firmware.bin" | awk '{print $1}')"
dmg_sha="$(shasum -a 256 "$OUTPUT/VibeTV-Control-Center.dmg" | awk '{print $1}')"
baseline_dmg_sha="$(shasum -a 256 "$OUTPUT/public-baseline.dmg" | awk '{print $1}')"
sparkle_cli_sha="$(shasum -a 256 "$OUTPUT/sparkle-cli.tar.gz" | awk '{print $1}')"

python3 - "$OUTPUT" "$CANDIDATE" "$CANDIDATE_FIRMWARE" "$BUILD" "$SOURCE_SHA" \
  "$BASELINE_VERSION" "$firmware_sha" "$dmg_sha" "$baseline_dmg_sha" "$sparkle_cli_sha" <<'PY'
import json
import pathlib
import sys

out = pathlib.Path(sys.argv[1])
(
    candidate, candidate_firmware, build, source_sha, baseline_version,
    firmware_sha, dmg_sha, baseline_dmg_sha, sparkle_cli_sha,
) = sys.argv[2:]
base = "http://127.0.0.1:47835"

firmware_manifest = {
    "schemaVersion": 1,
    "release": f"v{candidate}",
    "artifacts": [{
        "firmwareEnv": "esp8266_smalltv_st7789",
        "board": "esp8266-smalltv-st7789",
        "firmwareVersion": candidate_firmware,
        "asset": "firmware.bin",
        "firmwareUrl": f"{base}/firmware.bin",
        "sha256": firmware_sha,
        "message": "Private release-candidate firmware.",
    }],
}
release = {
    "tag_name": f"v{candidate}",
    "draft": True,
    "prerelease": True,
    "assets": [{
        "name": "VibeTV-Control-Center.dmg",
        "browser_download_url": f"{base}/VibeTV-Control-Center.dmg",
        "size": (out / "VibeTV-Control-Center.dmg").stat().st_size,
    }],
}
metadata = {
    "schemaVersion": 1,
    "candidate": candidate,
    "candidateFirmware": candidate_firmware,
    "baselineApp": baseline_version,
    "build": build,
    "sourceSha": source_sha,
    "private": True,
    "expiresAfterHours": 24,
    "endpoints": {
        "appcast": f"{base}/appcast.xml",
        "macAppRelease": f"{base}/mac-app-release.json",
        "macAppInstaller": f"{base}/install-candidate-mac-app.sh",
        "firmwareManifest": f"{base}/firmware-manifest.json",
    },
    "artifacts": {
        "dmg": {"path": "VibeTV-Control-Center.dmg", "sha256": dmg_sha},
        "baselineDmg": {"path": "public-baseline.dmg", "sha256": baseline_dmg_sha},
        "firmware": {"path": "firmware.bin", "sha256": firmware_sha},
        "sparkleCLI": {"path": "sparkle-cli.tar.gz", "sha256": sparkle_cli_sha},
        "virtualVibeTV": {"path": "virtual-vibetv"},
    },
}

for name, payload in (
    ("firmware-manifest.json", firmware_manifest),
    ("mac-app-release.json", release),
    ("candidate.json", metadata),
):
    with (out / name).open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")
PY

if [[ -n "$SPARKLE_KEY_FILE" ]]; then
  archive="$WORK/Sparkle-${SPARKLE_VERSION}.tar.xz"
  curl -fsSL "$SPARKLE_URL" -o "$archive"
  [[ "$(shasum -a 256 "$archive" | awk '{print $1}')" == "$SPARKLE_SHA256" ]] \
    || die "Sparkle tool archive checksum mismatch"
  tar -xJf "$archive" -C "$WORK"
  update_signature="$(
    "$WORK/bin/sign_update" \
      --ed-key-file "$SPARKLE_KEY_FILE" \
      "$OUTPUT/VibeTV-Control-Center.dmg"
  )"
  python3 - "$OUTPUT/appcast.xml" "$CANDIDATE" "$BUILD" "$update_signature" <<'PY'
import html
import pathlib
import re
import sys

output = pathlib.Path(sys.argv[1])
candidate, build, signature_fragment = sys.argv[2:]
signature = re.fullmatch(
    r'sparkle:edSignature="([A-Za-z0-9+/=]+)" length="([0-9]+)"',
    signature_fragment.strip(),
)
if signature is None:
    raise SystemExit("Sparkle sign_update returned an unexpected signature fragment")

ed_signature, length = map(html.escape, signature.groups())
output.write_text(f'''<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>VibeTV private release candidate</title>
    <item>
      <title>VibeTV Control Center {html.escape(candidate)}</title>
      <sparkle:version>{html.escape(build)}</sparkle:version>
      <sparkle:shortVersionString>{html.escape(candidate)}</sparkle:shortVersionString>
      <enclosure
        url="http://127.0.0.1:47835/VibeTV-Control-Center.dmg"
        sparkle:edSignature="{ed_signature}"
        length="{length}"
        type="application/octet-stream" />
    </item>
  </channel>
</rss>
''', encoding="utf-8")
PY
  "$WORK/bin/sign_update" \
    --ed-key-file "$SPARKLE_KEY_FILE" \
    "$OUTPUT/appcast.xml"
  grep -q 'sparkle:edSignature=' "$OUTPUT/appcast.xml" \
    || die "generated Sparkle appcast has no EdDSA update signature"
  grep -q '<!-- sparkle-signatures:' "$OUTPUT/appcast.xml" \
    || die "generated Sparkle appcast has no signed-feed signature"
else
  cat > "$OUTPUT/appcast.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>VibeTV private release candidate</title>
    <item>
      <title>VibeTV Control Center ${CANDIDATE}</title>
      <sparkle:version>${BUILD}</sparkle:version>
      <sparkle:shortVersionString>${CANDIDATE}</sparkle:shortVersionString>
      <enclosure url="http://127.0.0.1:47835/VibeTV-Control-Center.dmg" type="application/octet-stream" />
    </item>
  </channel>
</rss>
EOF
fi

(
  cd "$OUTPUT"
  shasum -a 256 \
    VibeTV-Control-Center.dmg \
    public-baseline.dmg \
    firmware.bin \
    sparkle-cli.tar.gz \
    virtual-vibetv \
    install-candidate-mac-app.sh \
    firmware-manifest.json \
    mac-app-release.json \
    appcast.xml \
    candidate.json > checksums.txt
)

for required in \
  VibeTV-Control-Center.dmg \
  public-baseline.dmg \
  firmware.bin \
  sparkle-cli.tar.gz \
  virtual-vibetv \
  install-candidate-mac-app.sh \
  firmware-manifest.json \
  mac-app-release.json \
  appcast.xml \
  candidate.json \
  checksums.txt; do
  [[ -f "$OUTPUT/$required" ]] || die "candidate bundle is incomplete: missing $required"
done
(
  cd "$OUTPUT"
  shasum -a 256 -c checksums.txt >/dev/null
) || die "candidate bundle checksum verification failed"

printf 'Candidate bundle ready: %s\n' "$OUTPUT"
printf '  candidate=%s firmware=%s build=%s source=%s\n' "$CANDIDATE" "$CANDIDATE_FIRMWARE" "$BUILD" "$SOURCE_SHA"
printf '  appcast=%s\n' "$([[ -n "$SPARKLE_KEY_FILE" ]] && printf signed || printf unsigned-contract-test)"
