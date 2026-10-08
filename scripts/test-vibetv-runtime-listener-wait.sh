#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Exercise only the validation function, never the destructive guest setup.
eval "$(sed -n '/^validate_installed_runtime() {$/,/^}$/p' "$ROOT/scripts/test-vibetv-hosted-guest.sh")"
die() { echo "$*" >&2; exit 1; }
plutil() { echo 1; }
defaults() { echo '9999.0.1+1'; }
ps() { :; }
sleep() { SECONDS=$((SECONDS + 30)); }
curl() {
  echo '{"ok":true,"companion":{"status":"ready","version":"9999.0.1","installationMode":"dmg","runtime":{"version":"9999.0.1","executable":"/test.app/Contents/Helpers/codexbar-display","listenerOwner":"shop.vibetv.control-center.runtime","pid":42}}}'
}
lsof() {
  [[ "$scenario" != missing ]] || return 1
  echo p42
  case "$scenario" in
    transient)
      if [[ ! -f "$work/observed" ]]; then
        touch "$work/observed"
        echo p43
      fi ;;
    persistent) echo p43 ;;
  esac
}
VERSION=9999.0.1
INSTALL_APP=/test.app
scenario=transient
( validate_installed_runtime "$work/status.json" ) || die 'transient extra listener must settle before validation'
for scenario in persistent missing; do
  if ( validate_installed_runtime "$work/status.json" ) >/dev/null 2>&1; then
    die "$scenario listener must fail validation"
  fi
done
echo 'PASS: runtime listener validation waits for sole ownership and rejects persistent conflicts'
