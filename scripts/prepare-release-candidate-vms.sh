#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRIVER="$ROOT/scripts/release-candidate/drivers/tart.sh"
BASE_IMAGE="ghcr.io/cirruslabs/macos-sequoia-base:latest"
FROM_APP=""
LEGACY_APP=""
REPLACE=0

usage() {
  cat <<'EOF'
Usage:
  ./scripts/prepare-release-candidate-vms.sh \
    --from-app <current-public-native-version> \
    --legacy-app <previous-public-or-migration-floor-version> \
    [--base-image image] [--replace]

Creates these reusable Tart source snapshots:
  CODEX-vibetv-clean
  CODEX-vibetv-legacy-<version>
  CODEX-vibetv-native-<version>

Each actual candidate test clones these sources and deletes the clone afterward.
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from-app) FROM_APP="${2#v}"; shift 2 ;;
    --legacy-app) LEGACY_APP="${2#v}"; shift 2 ;;
    --base-image) BASE_IMAGE="$2"; shift 2 ;;
    --replace) REPLACE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

for version in "$FROM_APP" "$LEGACY_APP"; do
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || die "valid versions required"
done
"$DRIVER" check

exists() {
  tart get "$1" >/dev/null 2>&1
}

replace_or_fail() {
  local name="$1"
  if ! exists "$name"; then
    return 0
  fi
  [[ "$REPLACE" == "1" ]] || die "snapshot already exists: $name (use --replace)"
  tart stop "$name" >/dev/null 2>&1 || true
  tart delete "$name"
}

clean="CODEX-vibetv-clean"
replace_or_fail "$clean"
if ! exists "$clean"; then
  tart clone "$BASE_IMAGE" "$clean"
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-vm-prep.XXXXXX")"
ACTIVE=""
cleanup() {
  if [[ -n "$ACTIVE" ]]; then
    "$DRIVER" stop "$ACTIVE" >/dev/null 2>&1 || true
    "$DRIVER" delete "$ACTIVE" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT HUP INT TERM
cp "$ROOT/scripts/release-candidate/prepare-guest-state.sh" "$WORK/prepare-guest-state.sh"
chmod 755 "$WORK/prepare-guest-state.sh"

prepare_state() {
  local state="$1"
  local version="$2"
  local final="CODEX-vibetv-${state}-${version}"
  local temp="CODEX-prep-${state}-${version//[^0-9A-Za-z]/-}-$$"
  replace_or_fail "$final"
  ACTIVE="$temp"
  "$DRIVER" clone "$clean" "$temp"
  "$DRIVER" run "$temp" "$WORK" "$WORK/$state"
  "$DRIVER" exec "$temp" \
    "/Volumes/My Shared Files/codex-rc/prepare-guest-state.sh" \
    --state "$state" \
    --version "$version"
  "$DRIVER" stop "$temp"
  tart clone "$temp" "$final"
  "$DRIVER" delete "$temp"
  ACTIVE=""
  printf 'Prepared snapshot: %s\n' "$final"
}

prepare_state legacy "$LEGACY_APP"
prepare_state native "$FROM_APP"
printf 'Prepared snapshot: %s\n' "$clean"
