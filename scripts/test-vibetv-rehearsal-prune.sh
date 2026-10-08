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
# Keeps the exit status: bash 3.2 otherwise ends with 0 after an error under set -u.
cleanup() { local status=$?; rm -rf "$tmp_dir"; exit "$status"; }
trap cleanup EXIT

export HOME="$tmp_dir/home"
mkdir -p "$HOME"
unset REHEARSAL_KEEP_RUNS REHEARSAL_KEEP_DAYS REHEARSAL_MIN_FREE_GB
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
  if [[ "$backed" != empty ]]; then
    printf '%s\n' "$HOME/.codexbar" > "$runs/$name/backup/manifest.txt"
  fi
  # A restore moves every stashed entry back and leaves only the manifest.
  if [[ "$backed" == backed ]]; then
    mkdir -p "$runs/$name/backup/.codexbar"
  fi
}

days_ago_stamp() {
  date -u -v-"$1"d +%Y%m%dT%H%M%SZ 2>/dev/null || date -u -d "$1 days ago" +%Y%m%dT%H%M%SZ
}

expect_kept() { [[ -e "$1" ]] || fail "removed, but must stay: ${1#"$REHEARSAL_STATE_DIR"/}"; }
expect_gone() { [[ ! -e "$1" ]] || fail "kept, but should be removed: ${1#"$REHEARSAL_STATE_DIR"/}"; }

[[ "$REHEARSAL_KEEP_RUNS" == 6 ]] || fail "default is $REHEARSAL_KEEP_RUNS runs, expected 6"
[[ "$REHEARSAL_KEEP_DAYS" == 14 ]] || fail "default is $REHEARSAL_KEEP_DAYS days, expected 14"

# --- fewer backed runs than the limit: nothing goes --------------------------
make_run cold-20200928T100000Z backed
make_run warm-20201001T100000Z backed
make_run cold-20201002T100000Z empty
output="$(rehearsal::prune_runs)"
expect_kept "$runs/cold-20200928T100000Z"
expect_kept "$runs/warm-20201001T100000Z"
expect_kept "$runs/cold-20201002T100000Z"
[[ "$output" != *removed* ]] || fail "reported a removal below the limit: $output"

# --- a full chain, limit 2 ---------------------------------------------------
make_run warm-20201003T100000Z backed
make_run cold-20201004T100000Z backed
make_run warm-20201005T100000Z empty
make_run cold-20201006T100000Z backed
ln -sfn "$runs/warm-20201003T100000Z" "$REHEARSAL_STATE_DIR/latest"

# Things that are not run folders of the scripts.
mkdir -p "$runs/manual-pr1-junk-000000/backup" "$runs/notes" \
  "$REHEARSAL_STATE_DIR/manual-pr490-original/backup" "$REHEARSAL_STATE_DIR/candidates/1" "$tmp_dir/outside"
printf 'x\n' > "$runs/manual-pr1-junk-000000/backup/manifest.txt"
printf 'x\n' > "$tmp_dir/outside/precious"
ln -s "$tmp_dir/outside" "$runs/cold-20200901T000000Z"

# Age is read from the name; a restore or a look into a folder changes mtimes.
touch "$runs/warm-20201001T100000Z" "$runs/warm-20201001T100000Z/backup"

output="$(REHEARSAL_KEEP_RUNS=2 rehearsal::prune_runs)"

expect_gone "$runs/warm-20201001T100000Z"
expect_gone "$runs/cold-20201002T100000Z"
expect_kept "$runs/cold-20200928T100000Z"   # the Mac's original state
expect_kept "$runs/warm-20201003T100000Z"   # latest points here
expect_kept "$runs/cold-20201004T100000Z"   # second newest with a backup
expect_kept "$runs/warm-20201005T100000Z"   # no backup, but newer than the cut
expect_kept "$runs/cold-20201006T100000Z"   # newest with a backup
expect_kept "$runs/manual-pr1-junk-000000/backup/manifest.txt"
expect_kept "$runs/notes"
expect_kept "$REHEARSAL_STATE_DIR/manual-pr490-original/backup"
expect_kept "$REHEARSAL_STATE_DIR/candidates/1"
expect_kept "$tmp_dir/outside/precious"
[[ -L "$runs/cold-20200901T000000Z" ]] || fail 'removed a symlink under runs/'

removed_lines="$(printf '%s\n' "$output" | grep -c 'removed ' || true)"
[[ "$removed_lines" == 2 ]] || fail "expected one line per removed run (2), got $removed_lines: $output"
[[ "$output" == *'removed warm-20201001T100000Z'* ]] || fail "removal not named: $output"
[[ "$output" == *'.vibetv-rehearsal now holds '* ]] || fail "size afterwards not printed: $output"
[[ "$output" == *'candidates'* ]] || fail "size of candidates/ not named: $output"

# --- a second pass removes nothing more --------------------------------------
output="$(REHEARSAL_KEEP_RUNS=2 rehearsal::prune_runs)"
[[ "$output" != *removed* ]] || fail "second pass removed something: $output"

# --- a session of the last two weeks stays, whatever the count ----------------
# stash MOVES files, so the run that opened a session is the only copy of the
# Mac's real state. Three pull requests with cold+warm are seven runs.
session_start="cold-$(days_ago_stamp 13)"
make_run "$session_start" backed
for day in 6 5 4 3 2 1; do
  make_run "warm-$(days_ago_stamp "$day")" backed
done
output="$(REHEARSAL_KEEP_RUNS=2 rehearsal::prune_runs)"
expect_kept "$runs/$session_start"
# The three old runs beyond the count go; nothing of the last two weeks does.
expect_gone "$runs/cold-20201004T100000Z"
expect_gone "$runs/warm-20201005T100000Z"
expect_gone "$runs/cold-20201006T100000Z"
[[ "$(printf '%s\n' "$output" | grep -c 'removed ' || true)" == 3 ]] || fail "recent runs were removed: $output"
expect_kept "$runs/cold-20200928T100000Z"   # still the oldest with a backup
expect_kept "$runs/warm-20201003T100000Z"   # latest still points here

# The same session goes once it is older than the limit in days.
output="$(REHEARSAL_KEEP_RUNS=2 REHEARSAL_KEEP_DAYS=10 rehearsal::prune_runs)"
expect_gone "$runs/$session_start"
[[ "$(printf '%s\n' "$output" | grep -c 'removed ' || true)" == 1 ]] || fail "expected only the 13-day-old run to go: $output"

# --- a run emptied by --restore is not a restore point ------------------------
rm -rf "$runs"
mkdir -p "$runs"
rm -f "$REHEARSAL_STATE_DIR/latest"
make_run cold-20190101T100000Z restored    # oldest by name, but holds nothing
make_run cold-20200101T100000Z backed      # the oldest that still holds a state
make_run warm-20200102T100000Z backed
make_run warm-20200103T100000Z restored    # must not count towards the limit
make_run cold-20200104T100000Z backed
output="$(REHEARSAL_KEEP_RUNS=2 rehearsal::prune_runs)"
expect_gone "$runs/cold-20190101T100000Z"
expect_kept "$runs/cold-20200101T100000Z"
expect_kept "$runs/warm-20200102T100000Z"
expect_kept "$runs/warm-20200103T100000Z"
expect_kept "$runs/cold-20200104T100000Z"

# --- a broken limit removes nothing ------------------------------------------
make_run cold-20180101T100000Z backed
make_run cold-20180102T100000Z backed
for bad in 0 -1 abc '' 2.5; do
  before="$(ls "$runs" | wc -l)"
  if (REHEARSAL_KEEP_RUNS="$bad" rehearsal::prune_runs) >/dev/null 2>&1; then
    fail "run limit '$bad' was accepted"
  fi
  [[ "$(ls "$runs" | wc -l)" == "$before" ]] || fail "run limit '$bad' removed runs"
done
for bad in -1 abc '' 2.5; do
  before="$(ls "$runs" | wc -l)"
  if (REHEARSAL_KEEP_RUNS=1 REHEARSAL_KEEP_DAYS="$bad" rehearsal::prune_runs) >/dev/null 2>&1; then
    fail "day limit '$bad' was accepted"
  fi
  [[ "$(ls "$runs" | wc -l)" == "$before" ]] || fail "day limit '$bad' removed runs"
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

# A limit that is not a whole number must stop the run, not wave it through.
fake_free_kb=1024
for bad in 2.5 abc '' -3; do
  if message="$( (REHEARSAL_MIN_FREE_GB="$bad" rehearsal::require_free_disk) 2>&1 )"; then
    fail "free-space limit '$bad' let a run start with 1 MB free"
  fi
  [[ "$message" == *'REHEARSAL_MIN_FREE_GB'* ]] || fail "refusal for '$bad' does not name the variable: $message"
done

if [[ "$failures" -gt 0 ]]; then
  printf '\n%d check(s) failed\n' "$failures" >&2
  exit 1
fi
printf 'rehearsal run pruning: all checks passed\n'
