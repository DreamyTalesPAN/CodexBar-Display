#!/usr/bin/env bash
# Every run keeps a backup of the purged Mac state (283 MB), and runs are also
# restore points. Pruning therefore has to be narrow: only old cold-/warm-
# run folders, never the original state, never what `latest` points to, never
# anything else under ~/.vibetv-rehearsal.
#
# Runs against a fake HOME, never against the real ~/.vibetv-rehearsal.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp_dir="$(mktemp -d)"
cleanup() { rm -rf "$tmp_dir"; }
trap cleanup EXIT

export HOME="$tmp_dir/home"
mkdir -p "$HOME"
unset REHEARSAL_KEEP_RUNS REHEARSAL_MIN_FREE_GB
# shellcheck source=lib/vibetv-rehearsal.sh
source "$script_dir/lib/vibetv-rehearsal.sh"
[[ "$REHEARSAL_STATE_DIR" == "$tmp_dir/"* ]] || { echo 'FAIL: not running against the fake HOME' >&2; exit 1; }

failures=0
fail() { printf 'FAIL: %s\n' "$1" >&2; failures=$((failures + 1)); }

runs="$REHEARSAL_STATE_DIR/runs"

make_run() {
  local name="$1" backed="$2"
  mkdir -p "$runs/$name/backup"
  printf 'log\n' > "$runs/$name/rehearsal.log"
  if [[ "$backed" == backed ]]; then
    printf '%s\n' "$HOME/.codexbar" > "$runs/$name/backup/manifest.txt"
  fi
}

expect_kept() { [[ -e "$1" ]] || fail "removed, but must stay: ${1#"$REHEARSAL_STATE_DIR"/}"; }
expect_gone() { [[ ! -e "$1" ]] || fail "kept, but should be removed: ${1#"$REHEARSAL_STATE_DIR"/}"; }

[[ "$REHEARSAL_KEEP_RUNS" == 6 ]] || fail "default is $REHEARSAL_KEEP_RUNS runs, expected 6"

# --- fewer backed runs than the limit: nothing goes --------------------------
make_run cold-20260928T100000Z backed
make_run warm-20261001T100000Z backed
make_run cold-20261002T100000Z empty
output="$(rehearsal::prune_runs)"
expect_kept "$runs/cold-20260928T100000Z"
expect_kept "$runs/warm-20261001T100000Z"
expect_kept "$runs/cold-20261002T100000Z"
[[ "$output" != *removed* ]] || fail "reported a removal below the limit: $output"

# --- a full chain, limit 2 ---------------------------------------------------
make_run warm-20261003T100000Z backed
make_run cold-20261004T100000Z backed
make_run warm-20261005T100000Z empty
make_run cold-20261006T100000Z backed
ln -sfn "$runs/warm-20261003T100000Z" "$REHEARSAL_STATE_DIR/latest"

# Things that are not run folders of the scripts.
mkdir -p "$runs/manual-pr1-junk-000000/backup" "$runs/notes" \
  "$REHEARSAL_STATE_DIR/manual-pr490-original/backup" "$REHEARSAL_STATE_DIR/candidates/1" "$tmp_dir/outside"
printf 'x\n' > "$runs/manual-pr1-junk-000000/backup/manifest.txt"
printf 'x\n' > "$tmp_dir/outside/precious"
ln -s "$tmp_dir/outside" "$runs/cold-20260901T000000Z"

# Age is read from the name; a restore or a look into a folder changes mtimes.
touch "$runs/warm-20261001T100000Z" "$runs/warm-20261001T100000Z/backup"

output="$(REHEARSAL_KEEP_RUNS=2 rehearsal::prune_runs)"

expect_gone "$runs/warm-20261001T100000Z"
expect_gone "$runs/cold-20261002T100000Z"
expect_kept "$runs/cold-20260928T100000Z"   # the Mac's original state
expect_kept "$runs/warm-20261003T100000Z"   # latest points here
expect_kept "$runs/cold-20261004T100000Z"   # second newest with a backup
expect_kept "$runs/warm-20261005T100000Z"   # no backup, but newer than the cut
expect_kept "$runs/cold-20261006T100000Z"   # newest with a backup
expect_kept "$runs/manual-pr1-junk-000000/backup/manifest.txt"
expect_kept "$runs/notes"
expect_kept "$REHEARSAL_STATE_DIR/manual-pr490-original/backup"
expect_kept "$REHEARSAL_STATE_DIR/candidates/1"
expect_kept "$tmp_dir/outside/precious"
[[ -L "$runs/cold-20260901T000000Z" ]] || fail 'removed a symlink under runs/'

removed_lines="$(printf '%s\n' "$output" | grep -c 'removed ' || true)"
[[ "$removed_lines" == 2 ]] || fail "expected one line per removed run (2), got $removed_lines: $output"
[[ "$output" == *'removed warm-20261001T100000Z'* ]] || fail "removal not named: $output"
[[ "$output" == *'.vibetv-rehearsal now holds '* ]] || fail "size afterwards not printed: $output"

# --- a second pass removes nothing more --------------------------------------
output="$(REHEARSAL_KEEP_RUNS=2 rehearsal::prune_runs)"
[[ "$output" != *removed* ]] || fail "second pass removed something: $output"

# --- a broken limit removes nothing ------------------------------------------
for bad in 0 -1 abc ''; do
  before="$(ls "$runs" | wc -l)"
  if (REHEARSAL_KEEP_RUNS="$bad" rehearsal::prune_runs) >/dev/null 2>&1; then
    fail "limit '$bad' was accepted"
  fi
  [[ "$(ls "$runs" | wc -l)" == "$before" ]] || fail "limit '$bad' removed runs"
done

# --- a nearly full disk stops the run before it writes anything ---------------
rehearsal::free_disk_kb() { printf '%s\n' "$fake_free_kb"; }
fake_free_kb=$((3 * 1024 * 1024 - 1))
if message="$( (rehearsal::require_free_disk) 2>&1 )"; then
  fail 'started with less than 3 GB free'
fi
[[ "$message" == *'3 GB'* ]] || fail "refusal does not name the limit: $message"
fake_free_kb=$((3 * 1024 * 1024))
(rehearsal::require_free_disk) >/dev/null 2>&1 || fail 'refused to start with 3 GB free'

if [[ "$failures" -gt 0 ]]; then
  printf '\n%d check(s) failed\n' "$failures" >&2
  exit 1
fi
printf 'rehearsal run pruning: all checks passed\n'
