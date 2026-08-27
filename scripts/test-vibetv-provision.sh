#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${ROOT_DIR}/scripts/vibetv-provision.sh"

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

smoke_block="$(sed -n '/^  if \[\[ "\$skip_smoke" != "1" \]\]; then$/,/^  fi$/p' "$SCRIPT")"
[[ "$smoke_block" == *'if [[ "$skip_filesystem_ota" == "1" ]]; then'* ]] \
  || die "smoke verification must branch on preserved filesystem data"
[[ "$smoke_block" == *'skip: missing-theme state check because filesystem OTA was skipped'* ]] \
  || die "preserved filesystem runs must explain the skipped missing-theme assertion"
[[ "$smoke_block" == *'check_post_smoke_theme_missing_state "$health_url"'* ]] \
  || die "full filesystem runs must retain the missing-theme assertion"

bash -n "$SCRIPT"
printf 'VibeTV provisioning contract tests passed\n'
