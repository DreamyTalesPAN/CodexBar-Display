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
  write_catalog "$repo" 2 '"/themes/u/synthwa-1-6b39a3.json"'
  git -C "$repo" add .
  git -C "$repo" commit -q -m "Initial render revision"
  git -C "$repo" branch -M main
}

# The catalog with Synthwave at this revision, naming these earlier files.
write_catalog() {
  local repo="$1"
  local revision="$2"
  local earlier="$3"
  printf '{"themes":[{"id":"synthwave","themeSpecPath":"/themes/u/synthwa-%s-5f8ac7.json","earlierThemeSpecPaths":[%s]}]}\n' \
    "$revision" "$earlier" > "$repo/dist/theme-packs/vibetv-theme-packs-v2.json"
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

# The catalog moves Synthwave on to revision 3. The file of revision 2, and
# the earlier one the base named, must stay named.
expect_catalog_failure() {
  local repo="${TMP_ROOT}/$1"
  local earlier="$2"
  local missing="$3"
  local output
  setup_repo "$repo"
  write_catalog "$repo" 3 "$earlier"
  if output="$(run_history_check "$repo")"; then
    die "expected theme-pack history check to fail for $1"
  fi
  assert_contains "$output" "synthwave no longer names its earlier revision ${missing}"
}

expect_catalog_failure "previous-unrecorded" \
  '"/themes/u/synthwa-1-6b39a3.json"' "/themes/u/synthwa-2-5f8ac7.json"
expect_catalog_failure "earlier-dropped" \
  '"/themes/u/synthwa-2-5f8ac7.json"' "/themes/u/synthwa-1-6b39a3.json"

moved_on_repo="${TMP_ROOT}/moved-on"
setup_repo "$moved_on_repo"
write_catalog "$moved_on_repo" 3 \
  '"/themes/u/synthwa-1-6b39a3.json","/themes/u/synthwa-2-5f8ac7.json"'
expect_history_success "$moved_on_repo"

printf 'theme pack history tests passed\n'
