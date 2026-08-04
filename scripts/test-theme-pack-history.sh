#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK_SCRIPT="${ROOT}/scripts/check-theme-pack-history.sh"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-theme-history-test.XXXXXX")"

cleanup() {
  rm -rf "$TMP_ROOT"
}

trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  printf '%s\n' "$haystack" | grep -F "$needle" >/dev/null \
    || die "expected output to contain: ${needle}"
}

setup_repo() {
  local repo="$1"
  mkdir -p "$repo/scripts" "$repo/dist/theme-packs/render/synthwave"
  cp "$CHECK_SCRIPT" "$repo/scripts/check-theme-pack-history.sh"
  chmod +x "$repo/scripts/check-theme-pack-history.sh"

  git -C "$repo" init -q
  git -C "$repo" config user.email "theme-history@example.test"
  git -C "$repo" config user.name "Theme History Test"
  printf '{"ok":true,"themeId":"synthwave","specPath":"/themes/u/synthwa-1-6b39a3.json"}\n' \
    > "$repo/dist/theme-packs/render/synthwave/synthwa-1-6b39a3.json"
  git -C "$repo" add .
  git -C "$repo" commit -q -m "Initial render revision"
  git -C "$repo" branch -M main
}

run_history_check() {
  local repo="$1"
  (
    cd "$repo"
    THEME_PACK_BASE_REF=main ./scripts/check-theme-pack-history.sh
  ) 2>&1
}

expect_history_success() {
  local repo="$1"
  local output
  output="$(run_history_check "$repo")" || {
    printf '%s\n' "$output" >&2
    die "expected theme-pack history check to pass"
  }
  assert_contains "$output" "theme pack history ok against main"
}

expect_history_failure() {
  local repo="$1"
  local expected_status="$2"
  local output status
  set +e
  output="$(run_history_check "$repo")"
  status=$?
  set -e
  [[ "$status" -ne 0 ]] || {
    printf '%s\n' "$output" >&2
    die "expected theme-pack history check to fail"
  }
  assert_contains "$output" "immutable render revision changed: ${expected_status} dist/theme-packs/render/synthwave/synthwa-1-6b39a3.json"
  assert_contains "$output" "publish a new ThemeSpec revision JSON instead"
}

modified_repo="${TMP_ROOT}/modified"
setup_repo "$modified_repo"
printf '{"ok":true,"themeId":"synthwave","changed":true}\n' \
  > "$modified_repo/dist/theme-packs/render/synthwave/synthwa-1-6b39a3.json"
expect_history_failure "$modified_repo" "M"

deleted_repo="${TMP_ROOT}/deleted"
setup_repo "$deleted_repo"
rm "$deleted_repo/dist/theme-packs/render/synthwave/synthwa-1-6b39a3.json"
expect_history_failure "$deleted_repo" "D"

added_repo="${TMP_ROOT}/added"
setup_repo "$added_repo"
printf '{"ok":true,"themeId":"synthwave","specPath":"/themes/u/synthwa-2-5f8ac7.json"}\n' \
  > "$added_repo/dist/theme-packs/render/synthwave/synthwa-2-5f8ac7.json"
expect_history_success "$added_repo"

printf 'theme pack history tests passed\n'
