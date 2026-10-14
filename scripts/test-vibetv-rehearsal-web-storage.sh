#!/usr/bin/env bash
# The Control Center keeps its localStorage in WebKit's per-bundle folders. A
# cold start that leaves them in place is not a new customer, so the purge has
# to stash them and --restore has to bring them back.
#
# Runs against a fake HOME. Everything that would touch the real Mac (the app,
# launchd, preferences) is replaced before the library functions are called.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp_dir="$(mktemp -d)"
cleanup() { rm -rf "$tmp_dir"; }
trap cleanup EXIT

export HOME="$tmp_dir/home"
mkdir -p "$HOME"
# shellcheck source=lib/vibetv-rehearsal.sh
source "$script_dir/lib/vibetv-rehearsal.sh"
[[ "$REHEARSAL_STATE_DIR" == "$tmp_dir/"* ]] || { echo 'FAIL: not running against the fake HOME' >&2; exit 1; }

REHEARSAL_APP_PATH="$HOME/Applications/VibeTV Control Center.app"
rehearsal::stop_runtime() { :; }
launchctl() { :; }
defaults() { :; }
killall() { :; }

failures=0
fail() { printf 'FAIL: %s\n' "$1" >&2; failures=$((failures + 1)); }

webkit="$HOME/Library/WebKit/$REHEARSAL_BUNDLE_ID"
http_dir="$HOME/Library/HTTPStorages/$REHEARSAL_BUNDLE_ID"
http_cookies="$HOME/Library/HTTPStorages/$REHEARSAL_BUNDLE_ID.binarycookies"
other_app="$HOME/Library/WebKit/com.example.other"
mkdir -p "$webkit/WebsiteData/Default" "$http_dir" "$other_app"
printf 'seen\n' > "$webkit/WebsiteData/Default/localstorage.sqlite3"
printf 'http\n' > "$http_dir/httpstorages.sqlite"
printf 'cookies\n' > "$http_cookies"
printf 'other\n' > "$other_app/keep"

REHEARSAL_RUN_DIR="$REHEARSAL_STATE_DIR/runs/cold-20261008T010000Z"
REHEARSAL_BACKUP_DIR="$REHEARSAL_RUN_DIR/backup"
mkdir -p "$REHEARSAL_BACKUP_DIR"
rehearsal::purge_mac >/dev/null

for path in "$webkit" "$http_dir" "$http_cookies"; do
  [[ ! -e "$path" ]] || fail "purge left ${path#"$HOME"/} in place"
  grep -qxF "$path" "$REHEARSAL_BACKUP_DIR/manifest.txt" 2>/dev/null \
    || fail "manifest does not record ${path#"$HOME"/}"
done
[[ -f "$other_app/keep" ]] || fail "purge touched another app's web storage"

# The candidate writes fresh storage; --restore has to replace it with the old one.
mkdir -p "$webkit/WebsiteData/Default"
printf 'candidate\n' > "$webkit/WebsiteData/Default/localstorage.sqlite3"
rehearsal::restore >/dev/null

[[ "$(cat "$webkit/WebsiteData/Default/localstorage.sqlite3" 2>/dev/null)" == 'seen' ]] \
  || fail 'restore did not bring the previous localStorage back'
[[ "$(cat "$http_dir/httpstorages.sqlite" 2>/dev/null)" == 'http' ]] || fail 'restore did not bring HTTPStorages back'
[[ "$(cat "$http_cookies" 2>/dev/null)" == 'cookies' ]] || fail 'restore did not bring the cookie file back'

if [[ "$failures" -gt 0 ]]; then
  printf '\n%d check(s) failed\n' "$failures" >&2
  exit 1
fi
printf 'rehearsal web storage: all checks passed\n'
