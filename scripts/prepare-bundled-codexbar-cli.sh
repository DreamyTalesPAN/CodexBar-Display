#!/usr/bin/env bash
set -euo pipefail

CODEXBAR_VERSION="0.37.2"
CODEXBAR_TAG="v${CODEXBAR_VERSION}"
CODEXBAR_RELEASE_BASE="https://github.com/steipete/CodexBar/releases/download/${CODEXBAR_TAG}"
ARM64_ARCHIVE="CodexBarCLI-${CODEXBAR_TAG}-macos-arm64.tar.gz"
X86_64_ARCHIVE="CodexBarCLI-${CODEXBAR_TAG}-macos-x86_64.tar.gz"
ARM64_SHA256="282acfc4b99aafe9d3b7b093f2ee6abbda3e2725b8512217f10c41784cba59df"
X86_64_SHA256="da24ab1bd9ec5ba51026bb2d97d9634b642e0fc9c6a5f2198854c20fb76ca34a"
OUTPUT_DIR=""
WORK_DIR=""

usage() {
  cat <<EOF
Usage:
  prepare-bundled-codexbar-cli.sh --output-dir path

Downloads the pinned CodexBarCLI ${CODEXBAR_VERSION} macOS release binaries,
verifies their SHA-256 digests, and creates one universal binary for the VibeTV
Control Center app bundle.
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$WORK_DIR" && -d "$WORK_DIR" ]]; then
    rm -rf "$WORK_DIR"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir)
      [[ -n "${2:-}" ]] || die "--output-dir needs a value"
      OUTPUT_DIR="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

[[ -n "$OUTPUT_DIR" ]] || die "--output-dir is required"
for command in curl file lipo shasum tar; do
  command -v "$command" >/dev/null 2>&1 || die "required command is unavailable: $command"
done

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-codexbar-cli.XXXXXX")"
trap cleanup EXIT
mkdir -p "$WORK_DIR/arm64" "$WORK_DIR/x86_64" "$OUTPUT_DIR"

curl -fsSL --retry 3 \
  "${CODEXBAR_RELEASE_BASE}/${ARM64_ARCHIVE}" \
  -o "$WORK_DIR/$ARM64_ARCHIVE"
curl -fsSL --retry 3 \
  "${CODEXBAR_RELEASE_BASE}/${X86_64_ARCHIVE}" \
  -o "$WORK_DIR/$X86_64_ARCHIVE"

printf '%s  %s\n' "$ARM64_SHA256" "$WORK_DIR/$ARM64_ARCHIVE" | shasum -a 256 -c -
printf '%s  %s\n' "$X86_64_SHA256" "$WORK_DIR/$X86_64_ARCHIVE" | shasum -a 256 -c -

tar -xzf "$WORK_DIR/$ARM64_ARCHIVE" -C "$WORK_DIR/arm64"
tar -xzf "$WORK_DIR/$X86_64_ARCHIVE" -C "$WORK_DIR/x86_64"

for arch in arm64 x86_64; do
  binary="$WORK_DIR/$arch/CodexBarCLI"
  version_file="$WORK_DIR/$arch/VERSION"
  [[ -x "$binary" ]] || die "${arch} archive does not contain an executable CodexBarCLI"
  [[ -f "$version_file" ]] || die "${arch} archive does not contain VERSION"
  [[ "$(tr -d '[:space:]' < "$version_file")" == "$CODEXBAR_VERSION" ]] \
    || die "${arch} VERSION does not match ${CODEXBAR_VERSION}"
done

lipo -create \
  -output "$OUTPUT_DIR/CodexBarCLI" \
  "$WORK_DIR/arm64/CodexBarCLI" \
  "$WORK_DIR/x86_64/CodexBarCLI"
chmod 755 "$OUTPUT_DIR/CodexBarCLI"
printf '%s\n' "$CODEXBAR_VERSION" > "$OUTPUT_DIR/VERSION"

lipo "$OUTPUT_DIR/CodexBarCLI" -verify_arch arm64 x86_64
version_output="$("$OUTPUT_DIR/CodexBarCLI" --version)"
[[ "$version_output" == *"${CODEXBAR_VERSION}"* ]] \
  || die "universal CodexBarCLI reported unexpected version: ${version_output}"

printf 'prepared bundled CodexBarCLI %s: %s\n' \
  "$CODEXBAR_VERSION" "$OUTPUT_DIR/CodexBarCLI"
