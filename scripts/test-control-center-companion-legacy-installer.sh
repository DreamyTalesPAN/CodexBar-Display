#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="${ROOT}/scripts/install-control-center-companion-release.sh"
TMP_WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-legacy-installer-test.XXXXXX")"

cleanup() {
  rm -rf "$TMP_WORK_DIR"
}

trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

assert_contains() {
  local haystack needle
  haystack="$1"
  needle="$2"
  printf '%s\n' "$haystack" | grep -F "$needle" >/dev/null \
    || die "expected output to contain: ${needle}"
}

write_fake_commands() {
  local fake_bin pkg_mode
  fake_bin="$1"
  pkg_mode="$2"
  mkdir -p "$fake_bin"

  cat > "${fake_bin}/uname" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
  -s)
    printf 'Darwin\n'
    ;;
  -m)
    printf 'arm64\n'
    ;;
  *)
    printf 'Darwin\n'
    ;;
esac
EOF

  cat > "${fake_bin}/pkgutil" <<EOF
#!/usr/bin/env bash
if [[ "\${1:-}" == "--pkg-info" && "${pkg_mode}" == "installed" ]]; then
  cat <<'INFO'
package-id: shop.vibetv.companion-api
version: 1.2.3
volume: /
location: /
install-time: 1780000000
INFO
  exit 0
fi
exit 1
EOF

  cat > "${fake_bin}/launchctl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${FAKE_LAUNCHCTL_LOG:?}"
exit 0
EOF

  cat > "${fake_bin}/curl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${FAKE_CURL_LOG:?}"
exit 22
EOF

  cat > "${fake_bin}/codesign" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

  cat > "${fake_bin}/xattr" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

  chmod +x "${fake_bin}/uname" "${fake_bin}/pkgutil" "${fake_bin}/launchctl" "${fake_bin}/curl" "${fake_bin}/codesign" "${fake_bin}/xattr"
}

prepare_home() {
  local home
  home="$1"
  mkdir -p "${home}/Library/LaunchAgents"
  printf '<plist version="1.0"><dict></dict></plist>\n' \
    > "${home}/Library/LaunchAgents/com.codexbar-display.companion-api.plist"
}

run_installer() {
  local root output status
  root="$1"
  shift
  set +e
  output="$(
    PATH="${root}/fake-bin:${PATH}" \
      HOME="${root}/home" \
      FAKE_LAUNCHCTL_LOG="${root}/launchctl.log" \
      FAKE_CURL_LOG="${root}/curl.log" \
      "$INSTALLER" "$@" \
      2>&1
  )"
  status=$?
  set -e
  printf '%s\n' "$output"
  return "$status"
}

run_guard_blocks_mode() {
  local mode root output status plist
  mode="$1"
  root="${TMP_WORK_DIR}/guard-${mode}"
  write_fake_commands "${root}/fake-bin" installed
  prepare_home "${root}/home"
  : > "${root}/launchctl.log"
  : > "${root}/curl.log"
  plist="${root}/home/Library/LaunchAgents/com.codexbar-display.companion-api.plist"

  set +e
  output="$(run_installer "$root" "--${mode}")"
  status=$?
  set -e

  [[ "$status" -ne 0 ]] || die "expected legacy installer --${mode} to stop when package receipt exists"
  assert_contains "$output" "VibeTV Mac App package 1.2.3 is already installed"
  [[ -f "$plist" ]] || die "legacy plist was removed despite package guard"
  [[ ! -s "${root}/launchctl.log" ]] || die "launchctl was called despite package guard"
  [[ ! -s "${root}/curl.log" ]] || die "curl was called despite package guard"
}

run_force_uninstall_allows_legacy_cleanup() {
  local root output plist
  root="${TMP_WORK_DIR}/force-uninstall"
  write_fake_commands "${root}/fake-bin" installed
  prepare_home "${root}/home"
  : > "${root}/launchctl.log"
  : > "${root}/curl.log"
  plist="${root}/home/Library/LaunchAgents/com.codexbar-display.companion-api.plist"

  output="$(run_installer "$root" --force-legacy-script --uninstall)" || {
    printf '%s\n' "$output" >&2
    die "expected forced legacy uninstall to pass"
  }

  assert_contains "$output" "Companion API LaunchAgent removed"
  [[ ! -f "$plist" ]] || die "forced legacy uninstall did not remove the user LaunchAgent"
  assert_contains "$(cat "${root}/launchctl.log")" "bootout"
  [[ ! -s "${root}/curl.log" ]] || die "forced legacy uninstall should not call curl"
}

run_guard_blocks_mode restart
run_guard_blocks_mode uninstall
run_force_uninstall_allows_legacy_cleanup

printf 'legacy Mac App support script guard tests passed\n'
