#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="${ROOT}/scripts/install.sh"
TMP_WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-install-sh-migration-test.XXXXXX")"

cleanup() {
  if [[ -d "$TMP_WORK_DIR" ]]; then
    while IFS= read -r pid_file; do
      pid="$(cat "$pid_file" 2>/dev/null || true)"
      if [[ -n "${pid:-}" ]]; then
        kill "$pid" >/dev/null 2>&1 || true
      fi
    done < <(find "$TMP_WORK_DIR" -name companion-api.pid -type f 2>/dev/null || true)
    rm -rf "$TMP_WORK_DIR"
  fi
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

assert_not_contains() {
  local haystack needle
  haystack="$1"
  needle="$2"
  if printf '%s\n' "$haystack" | grep -F "$needle" >/dev/null; then
    die "expected output not to contain: ${needle}"
  fi
}

write_fake_commands() {
  local fake_bin
  fake_bin="$1"
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

  cat > "${fake_bin}/curl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${FAKE_CURL_LOG:?}"
out=""
previous=""
for arg in "$@"; do
  if [[ "$previous" == "-o" ]]; then
    out="$arg"
    previous=""
    continue
  fi
  previous="$arg"
done
case "$*" in
  *"/v1/status"*)
    exit 0
    ;;
  *"/codexbar-display-darwin-arm64-v9.9.9"*)
    [[ -n "$out" ]] || exit 22
    cat > "$out" <<'BIN'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  setup)
    bin="${HOME}/Library/Application Support/codexbar-display/bin/codexbar-display"
    mkdir -p "$(dirname "$bin")"
    cat > "$bin" <<'INSTALLED'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${FAKE_CODEXBAR_DISPLAY_LOG:?}"
case "${1:-}" in
  api)
    while true; do
      sleep 60
    done
    ;;
  health)
    printf 'health ok\n'
    ;;
  version)
    if [[ "${2:-}" == "--short" ]]; then
      printf '9.9.9\n'
    else
      printf 'codexbar-display companion 9.9.9\n'
    fi
    ;;
  theme-pack)
    printf 'theme pack ok\n'
    ;;
  *)
    printf 'ok\n'
    ;;
esac
INSTALLED
    chmod +x "$bin"
    ;;
  *)
    printf 'release binary called: %s\n' "$*" >> "${FAKE_CODEXBAR_DISPLAY_LOG:?}"
    ;;
esac
BIN
    ;;
  *"/checksums-v9.9.9.txt"*)
    [[ -n "$out" ]] || exit 22
    printf 'deadbeef  codexbar-display-darwin-arm64-v9.9.9\n' > "$out"
    ;;
  *)
    exit 22
    ;;
esac
EOF

  cat > "${fake_bin}/shasum" <<'EOF'
#!/usr/bin/env bash
printf 'deadbeef  %s\n' "${@: -1}"
EOF

  cat > "${fake_bin}/launchctl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${FAKE_LAUNCHCTL_LOG:?}"
exit 0
EOF

  cat > "${fake_bin}/lsof" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF

  cat > "${fake_bin}/codexbar" <<'EOF'
#!/usr/bin/env bash
printf '{"ok":true}\n'
EOF

  chmod +x \
    "${fake_bin}/codexbar" \
    "${fake_bin}/curl" \
    "${fake_bin}/launchctl" \
    "${fake_bin}/lsof" \
    "${fake_bin}/shasum" \
    "${fake_bin}/uname"
}

run_installer() {
  local root output status
  root="$1"
  shift
  set +e
  output="$(
    PATH="${root}/fake-bin:${root}/global-bin:${PATH}" \
      HOME="${root}/home" \
      CODEXBAR_DISPLAY_GLOBAL_BIN_DIR="${root}/global-bin" \
      CODEXBAR_DISPLAY_WARMUP_ATTEMPTS="${CODEXBAR_DISPLAY_WARMUP_ATTEMPTS:-}" \
      CODEXBAR_DISPLAY_WARMUP_SLEEP_SECS="${CODEXBAR_DISPLAY_WARMUP_SLEEP_SECS:-}" \
      CODEXBAR_DISPLAY_WARMUP_TIMEOUT_SECS="${CODEXBAR_DISPLAY_WARMUP_TIMEOUT_SECS:-}" \
      FAKE_CODEXBAR_DISPLAY_LOG="${root}/codexbar-display.log" \
      FAKE_CURL_LOG="${root}/curl.log" \
      FAKE_LAUNCHCTL_LOG="${root}/launchctl.log" \
      FAKE_LN_LOG="${root}/ln.log" \
      VIBETV_COMPANION_GLOBAL_PLIST="${root}/global/Library/LaunchAgents/com.codexbar-display.companion-api.plist" \
      "$INSTALLER" "$@" \
      2>&1
  )"
  status=$?
  set -e
  printf '%s\n' "$output"
  return "$status"
}

write_existing_install() {
  local home bin
  home="$1"
  bin="${home}/Library/Application Support/codexbar-display/bin/codexbar-display"
  mkdir -p "$(dirname "$bin")"
  cat > "$bin" <<'EOF'
#!/usr/bin/env bash
printf 'existing install\n'
EOF
  chmod +x "$bin"
}

write_failing_codexbar() {
  local fake_bin
  fake_bin="$1"
  cat > "${fake_bin}/codexbar" <<'EOF'
#!/usr/bin/env bash
exit 42
EOF
  chmod +x "${fake_bin}/codexbar"
}

run_install_sh_enables_control_center_in_daemon() {
  local root output launch_log app_log
  root="${TMP_WORK_DIR}/install-sh"
  write_fake_commands "${root}/fake-bin"
  mkdir -p "${root}/home" "${root}/global-bin" "${root}/global/Library/LaunchAgents"
  write_existing_install "${root}/home"
  printf '<plist version="1.0"><dict></dict></plist>\n' \
    > "${root}/global/Library/LaunchAgents/com.codexbar-display.companion-api.plist"
  : > "${root}/codexbar-display.log"
  : > "${root}/curl.log"
  : > "${root}/launchctl.log"

  output="$(run_installer "$root" --version 9.9.9 -- --target http://vibetv.local)" || {
    printf '%s\n' "$output" >&2
    die "expected install.sh migration path to pass"
  }

  app_log="${root}/codexbar-display.log"
  launch_log="$(cat "${root}/launchctl.log")"

  assert_contains "$output" "preparing Control Center Mac App service"
  assert_contains "$output" "Control Center Mac App service is running"
  assert_contains "$output" "open https://app.vibetv.shop"
  assert_contains "$output" "default theme pack skipped for existing install"
  assert_not_contains "$(cat "$app_log")" "theme-pack install"
  assert_contains "$launch_log" "bootout gui/$(id -u)/com.codexbar-display.companion-api"
  assert_contains "$launch_log" "disable gui/$(id -u)/com.codexbar-display.companion-api"
  assert_not_contains "$(cat "$app_log")" "api --addr 127.0.0.1:47832"
}

run_fresh_install_keeps_default_theme_pack() {
  local root output app_log
  root="${TMP_WORK_DIR}/fresh-install"
  write_fake_commands "${root}/fake-bin"
  mkdir -p "${root}/home" "${root}/global-bin" "${root}/global/Library/LaunchAgents"
  : > "${root}/codexbar-display.log"
  : > "${root}/curl.log"
  : > "${root}/launchctl.log"

  output="$(run_installer "$root" --version 9.9.9 -- --target http://vibetv.local)" || {
    printf '%s\n' "$output" >&2
    die "expected fresh install path to pass"
  }

  app_log="$(cat "${root}/codexbar-display.log")"
  assert_contains "$app_log" "theme-pack install --theme mini-classic --skip-firmware-update"
  assert_not_contains "$output" "default theme pack skipped for existing install"
}

run_install_sh_does_not_block_when_codexbar_usage_is_missing() {
  local root output
  root="${TMP_WORK_DIR}/missing-codexbar-usage"
  write_fake_commands "${root}/fake-bin"
  write_failing_codexbar "${root}/fake-bin"
  mkdir -p "${root}/home" "${root}/global-bin" "${root}/global/Library/LaunchAgents"
  write_existing_install "${root}/home"
  : > "${root}/codexbar-display.log"
  : > "${root}/curl.log"
  : > "${root}/launchctl.log"

  output="$(
    CODEXBAR_DISPLAY_WARMUP_ATTEMPTS=1 \
      CODEXBAR_DISPLAY_WARMUP_SLEEP_SECS=0 \
      CODEXBAR_DISPLAY_WARMUP_TIMEOUT_SECS=1 \
      run_installer "$root" --version 9.9.9 -- --target http://vibetv.local
  )" || {
    printf '%s\n' "$output" >&2
    die "expected install.sh to continue when CodexBar usage is not ready"
  }

  assert_contains "$output" "warning: CodexBar provider data is not ready yet"
  assert_contains "$output" "Control Center Mac App service is running"
  assert_not_contains "$output" "CodexBar is returning provider data"
}

run_existing_global_symlink_does_not_require_relink() {
  local root output global_link app_bin
  root="${TMP_WORK_DIR}/existing-global-symlink"
  write_fake_commands "${root}/fake-bin"
  mkdir -p "${root}/home" "${root}/global-bin" "${root}/global/Library/LaunchAgents"
  write_existing_install "${root}/home"
  app_bin="${root}/home/Library/Application Support/codexbar-display/bin/codexbar-display"
  global_link="${root}/global-bin/codexbar-display"
  ln -s "$app_bin" "$global_link"
  : > "${root}/codexbar-display.log"
  : > "${root}/curl.log"
  : > "${root}/launchctl.log"
  : > "${root}/ln.log"

  cat > "${root}/fake-bin/ln" <<'EOF'
#!/usr/bin/env bash
printf 'ln called: %s\n' "$*" >> "${FAKE_LN_LOG:?}"
exit 55
EOF
  chmod +x "${root}/fake-bin/ln"

  output="$(run_installer "$root" --version 9.9.9 -- --target http://vibetv.local)" || {
    printf '%s\n' "$output" >&2
    die "expected install.sh to keep the existing global command symlink"
  }

  assert_contains "$output" "Terminal command ready: codexbar-display"
  assert_not_contains "$(cat "${root}/ln.log")" "ln called"
}

run_install_sh_enables_control_center_in_daemon
run_fresh_install_keeps_default_theme_pack
run_install_sh_does_not_block_when_codexbar_usage_is_missing
run_existing_global_symlink_does_not_require_relink

printf 'install.sh Control Center migration test passed\n'
