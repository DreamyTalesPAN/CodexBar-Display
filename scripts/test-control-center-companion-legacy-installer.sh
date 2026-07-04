#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="${ROOT}/scripts/install-control-center-companion-release.sh"
TMP_WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-terminal-installer-test.XXXXXX")"

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

  cat > "${fake_bin}/launchctl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${FAKE_LAUNCHCTL_LOG:?}"
exit 0
EOF

  cat > "${fake_bin}/curl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${FAKE_CURL_LOG:?}"
out=""
previous=""
write_status=0
for arg in "$@"; do
  if [[ "$previous" == "-o" ]]; then
    out="$arg"
    previous=""
    continue
  fi
  if [[ "$arg" == "%{http_code}" ]]; then
    write_status=1
  fi
  previous="$arg"
done

respond() {
  local body="$1"
  if [[ -n "$out" ]]; then
    printf '%s\n' "$body" > "$out"
  else
    printf '%s\n' "$body"
  fi
  if [[ "$write_status" == "1" ]]; then
    printf '200'
  fi
}

repair_not_found() {
  if [[ -n "$out" ]]; then
    printf '%s\n' '{"ok":false,"error":{"code":"device_not_found","message":"No VibeTV device was found.","nextAction":"Make sure VibeTV is powered on and run device discovery again."}}' > "$out"
  else
    printf '%s\n' '{"ok":false,"error":{"code":"device_not_found","message":"No VibeTV device was found.","nextAction":"Make sure VibeTV is powered on and run device discovery again."}}'
  fi
  if [[ "$write_status" == "1" ]]; then
    printf '404'
  fi
}

case "$*" in
  *"/control-center"*)
    respond '<html><body>VibeTV Control Center</body></html>'
    ;;
  *"/v1/status"*)
    if [[ -n "${FAKE_STATUS_OLD_ONCE:-}" && "$write_status" == "1" && ! -f "$FAKE_STATUS_OLD_ONCE" ]]; then
      touch "$FAKE_STATUS_OLD_ONCE"
      respond '{"ok":true,"companion":{"status":"ready","version":"9.9.8","update":{"status":"available","release":"v9.9.9"},"features":{"themeInstallEnabled":true}},"device":{"target":"http://192.168.178.72","connected":true,"paired":true}}'
      exit 0
    fi
    if [[ -n "${FAKE_STATUS_DEVICE_DISCONNECTED:-}" ]]; then
      respond '{"ok":true,"companion":{"status":"ready","version":"9.9.9","update":{"status":"available","release":"v9.9.9"},"features":{"themeInstallEnabled":true}},"device":{"target":"http://192.168.178.72","connected":false,"paired":true}}'
      exit 0
    fi
    respond '{"ok":true,"companion":{"status":"ready","version":"9.9.9","update":{"status":"available","release":"v9.9.9"},"features":{"themeInstallEnabled":true}},"device":{"target":"http://192.168.178.72","connected":true,"paired":true}}'
    ;;
  *"/v1/device/repair"*)
    if [[ -n "${FAKE_REPAIR_ALWAYS_FAIL:-}" ]]; then
      repair_not_found
      exit 0
    fi
    if [[ -n "${FAKE_REPAIR_FAIL_COUNT:-}" && -n "${FAKE_REPAIR_COUNTER:-}" ]]; then
      count=0
      if [[ -f "$FAKE_REPAIR_COUNTER" ]]; then
        count="$(cat "$FAKE_REPAIR_COUNTER" 2>/dev/null || printf '0')"
      fi
      if [[ "$count" -lt "$FAKE_REPAIR_FAIL_COUNT" ]]; then
        printf '%s\n' "$((count + 1))" > "$FAKE_REPAIR_COUNTER"
        repair_not_found
        exit 0
      fi
    fi
    if [[ -n "${FAKE_REPAIR_FAIL_ONCE:-}" && ! -f "$FAKE_REPAIR_FAIL_ONCE" ]]; then
      touch "$FAKE_REPAIR_FAIL_ONCE"
      repair_not_found
      exit 0
    fi
    respond '{"ok":true,"device":{"connected":true,"paired":true,"target":"http://192.168.178.72"}}'
    ;;
  *"/v1/device"*)
    respond '{"ok":true,"device":{"connected":true,"paired":true,"target":"http://192.168.178.72","firmware":"9.9.9"}}'
    ;;
  *"/releases/latest"*)
    respond '{"tag_name":"v9.9.9"}'
    ;;
  *"/codexbar-display-darwin-arm64-v9.9.9"*)
    [[ -n "$out" ]] || exit 22
    cat > "$out" <<'BIN'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${FAKE_API_LOG:?}"
if [[ "${1:-}" == "install-update" ]]; then
  printf 'Checking device...\n'
  printf 'Checking firmware...\n'
  printf 'Done: firmware 9.9.9 installed\n'
  exit 0
fi
while true; do
  sleep 60
done
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

  cat > "${fake_bin}/xattr" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

  cat > "${fake_bin}/codesign" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

  cat > "${fake_bin}/open" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${FAKE_OPEN_LOG:?}"
exit 0
EOF

  chmod +x \
    "${fake_bin}/codesign" \
    "${fake_bin}/curl" \
    "${fake_bin}/launchctl" \
    "${fake_bin}/open" \
    "${fake_bin}/shasum" \
    "${fake_bin}/uname" \
    "${fake_bin}/xattr"
}

prepare_home() {
  local home bin_path
  home="$1"
  bin_path="${home}/Library/Application Support/codexbar-display/bin/codexbar-display"
  mkdir -p "$(dirname "$bin_path")" \
    "${home}/Library/Application Support/codexbar-display/run" \
    "${home}/Library/LaunchAgents"

  cat > "$bin_path" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${FAKE_API_LOG:?}"
if [[ "${1:-}" == "install-update" ]]; then
  printf 'Checking device...\n'
  printf 'Checking firmware...\n'
  printf 'Done: firmware 9.9.9 installed\n'
  exit 0
fi
while true; do
  sleep 60
done
EOF
  chmod +x "$bin_path"

  printf '<plist version="1.0"><dict></dict></plist>\n' \
    > "${home}/Library/LaunchAgents/com.codexbar-display.companion-api.plist"
  printf '<plist version="1.0"><dict></dict></plist>\n' \
    > "${home}/Library/LaunchAgents/com.codexbar-display.daemon.plist"
}

run_installer() {
  local root output status
  root="$1"
  shift
  set +e
  output="$(
    PATH="${root}/fake-bin:${PATH}" \
      HOME="${root}/home" \
      FAKE_API_LOG="${root}/api.log" \
      FAKE_LAUNCHCTL_LOG="${root}/launchctl.log" \
      FAKE_CURL_LOG="${root}/curl.log" \
      FAKE_OPEN_LOG="${root}/open.log" \
      FAKE_REPAIR_FAIL_ONCE="${FAKE_REPAIR_FAIL_ONCE:-}" \
      FAKE_REPAIR_ALWAYS_FAIL="${FAKE_REPAIR_ALWAYS_FAIL:-}" \
      FAKE_REPAIR_FAIL_COUNT="${FAKE_REPAIR_FAIL_COUNT:-}" \
      FAKE_REPAIR_COUNTER="${FAKE_REPAIR_COUNTER:-}" \
      FAKE_STATUS_OLD_ONCE="${FAKE_STATUS_OLD_ONCE:-}" \
      FAKE_STATUS_DEVICE_DISCONNECTED="${FAKE_STATUS_DEVICE_DISCONNECTED:-}" \
      VIBETV_COMPANION_REPAIR_ATTEMPTS="${VIBETV_COMPANION_REPAIR_ATTEMPTS:-3}" \
      VIBETV_COMPANION_REPAIR_RETRY_DELAY="${VIBETV_COMPANION_REPAIR_RETRY_DELAY:-0}" \
      VIBETV_COMPANION_STABLE_RETRY_DELAY="${VIBETV_COMPANION_STABLE_RETRY_DELAY:-0}" \
      VIBETV_COMPANION_GLOBAL_PLIST="${root}/global/Library/LaunchAgents/com.codexbar-display.companion-api.plist" \
      "$INSTALLER" "$@" \
      2>&1
  )"
  status=$?
  set -e
  printf '%s\n' "$output"
  return "$status"
}

support_log() {
  local root="$1"
  cat "${root}/home/Library/Application Support/codexbar-display/logs/install.log"
}

run_restart_updates_daemon_launchagent() {
  local root output legacy_plist daemon_plist daemon_plist_body launch_log setup_log
  root="${TMP_WORK_DIR}/restart"
  write_fake_commands "${root}/fake-bin"
  prepare_home "${root}/home"
  : > "${root}/launchctl.log"
  : > "${root}/curl.log"
  : > "${root}/api.log"

  output="$(run_installer "$root" --restart)" || {
    printf '%s\n' "$output" >&2
    die "expected restart to pass"
  }

  legacy_plist="${root}/home/Library/LaunchAgents/com.codexbar-display.companion-api.plist"
  daemon_plist="${root}/home/Library/LaunchAgents/com.codexbar-display.daemon.plist"
  daemon_plist_body="$(cat "$daemon_plist")"
  launch_log="$(cat "${root}/launchctl.log")"
  setup_log="$(support_log "$root")"

  assert_contains "$output" "Starting your local Control Center"
  assert_contains "$output" "[2/3] Starting Control Center"
  assert_contains "$output" "Done. Your Control Center is opening now."
  assert_contains "$setup_log" "Mac setup service is running"
  assert_contains "$setup_log" "opening Control Center at http://127.0.0.1:47832/control-center"
  assert_contains "$(cat "${root}/open.log")" "http://127.0.0.1:47832/control-center"
  [[ ! -f "$legacy_plist" ]] || die "legacy LaunchAgent plist should be removed"
  [[ -f "$daemon_plist" ]] || die "daemon LaunchAgent plist should exist"
  assert_contains "$daemon_plist_body" "<string>daemon</string>"
  assert_contains "$daemon_plist_body" "<string>--api-addr</string>"
  assert_contains "$daemon_plist_body" "<string>127.0.0.1:47832</string>"
  assert_contains "$daemon_plist_body" "<key>ThrottleInterval</key>"
  assert_contains "$daemon_plist_body" "${root}/home/Library/Application Support/codexbar-display/logs/daemon.err.log"
  assert_not_contains "$daemon_plist_body" "<string></string>"
  assert_not_contains "$daemon_plist_body" "<string>api</string>"
  assert_contains "$launch_log" "bootout gui/$(id -u)/com.codexbar-display.companion-api"
  assert_contains "$launch_log" "bootout gui/$(id -u)/com.codexbar-display.daemon"
  assert_contains "$launch_log" "bootstrap gui/$(id -u) $daemon_plist"
  assert_contains "$launch_log" "kickstart -k gui/$(id -u)/com.codexbar-display.daemon"
}

run_uninstall_stops_terminal_service_and_legacy_launchagent() {
  local root output pid_file pid plist setup_log
  root="${TMP_WORK_DIR}/uninstall"
  write_fake_commands "${root}/fake-bin"
  prepare_home "${root}/home"
  : > "${root}/launchctl.log"
  : > "${root}/curl.log"
  : > "${root}/api.log"

  pid_file="${root}/home/Library/Application Support/codexbar-display/run/companion-api.pid"
  plist="${root}/home/Library/LaunchAgents/com.codexbar-display.companion-api.plist"
  sleep 60 &
  pid="$!"
  printf '%s\n' "$pid" > "$pid_file"

  output="$(run_installer "$root" --uninstall)" || {
    printf '%s\n' "$output" >&2
    die "expected uninstall to pass"
  }
  setup_log="$(support_log "$root")"

  assert_contains "$output" "Removing your local Control Center"
  assert_contains "$output" "Done. Local Control Center service stopped."
  assert_contains "$setup_log" "Mac setup service stopped"
  [[ ! -f "$pid_file" ]] || die "uninstall did not remove legacy API pid"
  ! kill -0 "$pid" >/dev/null 2>&1 || die "uninstall did not stop legacy API process"
  [[ ! -f "$plist" ]] || die "uninstall did not remove legacy LaunchAgent plist"
  assert_contains "$(cat "${root}/launchctl.log")" "bootout"
}

run_install_writes_integrated_daemon_launchagent() {
  local root output launch_log daemon_plist daemon_plist_body curl_log setup_log
  root="${TMP_WORK_DIR}/install"
  write_fake_commands "${root}/fake-bin"
  prepare_home "${root}/home"
  : > "${root}/launchctl.log"
  : > "${root}/curl.log"
  : > "${root}/api.log"

  output="$(run_installer "$root" --version 9.9.9 --terminal-session)" || {
    printf '%s\n' "$output" >&2
    die "expected install to pass"
  }

  launch_log="$(cat "${root}/launchctl.log")"
  curl_log="$(cat "${root}/curl.log")"
  setup_log="$(support_log "$root")"
  daemon_plist="${root}/home/Library/LaunchAgents/com.codexbar-display.daemon.plist"
  daemon_plist_body="$(cat "$daemon_plist")"

  assert_contains "$output" "Installing your local Control Center"
  assert_contains "$output" "[5/7] Finding VibeTV"
  assert_contains "$output" "[6/7] Checking VibeTV update"
  assert_contains "$output" "Done. Your Control Center is opening now."
  assert_not_contains "$output" "Done: firmware 9.9.9 installed"
  assert_contains "$setup_log" "background service installed at ${daemon_plist}"
  assert_contains "$setup_log" "opening Control Center at http://127.0.0.1:47832/control-center"
  assert_contains "$setup_log" "VibeTV is connected at http://192.168.178.72"
  assert_contains "$setup_log" "Done: firmware 9.9.9 installed"
  assert_contains "$setup_log" "VibeTV firmware update complete"
  assert_contains "$curl_log" "/v1/device/repair"
  assert_contains "$curl_log" '{"forcePair":true}'
  assert_contains "$(cat "${root}/api.log")" "install-update --target http://192.168.178.72 --confirm-live-update"
  assert_not_contains "$curl_log" "/v1/updates/install"
  assert_contains "$daemon_plist_body" "<string>daemon</string>"
  assert_contains "$daemon_plist_body" "<string>--api-addr</string>"
  assert_contains "$daemon_plist_body" "<string>127.0.0.1:47832</string>"
  assert_contains "$daemon_plist_body" "<string>--target</string>"
  assert_contains "$daemon_plist_body" "<string>http://192.168.178.72</string>"
  assert_contains "$daemon_plist_body" "<key>ThrottleInterval</key>"
  assert_contains "$daemon_plist_body" "${root}/home/Library/Application Support/codexbar-display/logs/daemon.err.log"
  assert_not_contains "$daemon_plist_body" "<string></string>"
  assert_not_contains "$daemon_plist_body" "<string>api</string>"
  assert_contains "$launch_log" "bootout gui/$(id -u)/com.codexbar-display.companion-api"
  assert_contains "$launch_log" "bootout gui/$(id -u)/com.codexbar-display.daemon"
  assert_contains "$launch_log" "bootstrap gui/$(id -u) $daemon_plist"
  assert_contains "$launch_log" "kickstart -k gui/$(id -u)/com.codexbar-display.daemon"
  assert_contains "$(cat "${root}/open.log")" "http://127.0.0.1:47832/control-center"
}

run_install_can_skip_device_setup_for_mac_app_update() {
  local root output curl_log api_log setup_log
  root="${TMP_WORK_DIR}/mac-app-only"
  write_fake_commands "${root}/fake-bin"
  prepare_home "${root}/home"
  : > "${root}/launchctl.log"
  : > "${root}/curl.log"
  : > "${root}/api.log"

  output="$(run_installer "$root" --version 9.9.9 --terminal-session --skip-device-setup)" || {
    printf '%s\n' "$output" >&2
    die "expected Mac App only install to pass"
  }

  curl_log="$(cat "${root}/curl.log")"
  api_log="$(cat "${root}/api.log")"
  setup_log="$(support_log "$root")"
  assert_contains "$output" "[5/5] Opening Control Center"
  assert_contains "$output" "Done. Your Control Center is opening now."
  assert_contains "$setup_log" "Mac App update verified"
  assert_contains "$setup_log" "background service installed"
  assert_contains "$setup_log" "opening Control Center at http://127.0.0.1:47832/control-center"
  assert_contains "$(cat "${root}/open.log")" "http://127.0.0.1:47832/control-center"
  assert_not_contains "$curl_log" "/v1/device/repair"
  assert_not_contains "$curl_log" "/v1/device\""
  assert_not_contains "$api_log" "install-update"
  assert_not_contains "$output" "VibeTV firmware update complete"
}

run_install_disables_global_legacy_launchagent() {
  local root output launch_log global_plist daemon_plist_body curl_log setup_log
  root="${TMP_WORK_DIR}/global-legacy"
  write_fake_commands "${root}/fake-bin"
  prepare_home "${root}/home"
  global_plist="${root}/global/Library/LaunchAgents/com.codexbar-display.companion-api.plist"
  mkdir -p "$(dirname "$global_plist")"
  printf '<plist version="1.0"><dict></dict></plist>\n' > "$global_plist"
  : > "${root}/launchctl.log"
  : > "${root}/curl.log"
  : > "${root}/api.log"

  output="$(run_installer "$root" --version 9.9.9 --terminal-session)" || {
    printf '%s\n' "$output" >&2
    die "expected install with global legacy LaunchAgent to pass"
  }

  launch_log="$(cat "${root}/launchctl.log")"
  curl_log="$(cat "${root}/curl.log")"
  setup_log="$(support_log "$root")"
  daemon_plist_body="$(cat "${root}/home/Library/LaunchAgents/com.codexbar-display.daemon.plist")"

  assert_contains "$output" "Installing your local Control Center"
  assert_not_contains "$output" "Done: firmware 9.9.9 installed"
  assert_contains "$setup_log" "old Mac setup service disabled for this user"
  assert_contains "$setup_log" "Done: firmware 9.9.9 installed"
  assert_contains "$setup_log" "VibeTV firmware update complete"
  assert_contains "$curl_log" "/v1/device/repair"
  assert_contains "$curl_log" '{"forcePair":true}'
  assert_contains "$(cat "${root}/api.log")" "install-update --target http://192.168.178.72 --confirm-live-update"
  assert_not_contains "$curl_log" "/v1/updates/install"
  assert_contains "$launch_log" "bootout gui/$(id -u)/com.codexbar-display.companion-api"
  assert_contains "$launch_log" "disable gui/$(id -u)/com.codexbar-display.companion-api"
  assert_contains "$daemon_plist_body" "<string>--api-addr</string>"
}

run_install_retries_transient_repair_failure() {
  local root output repair_calls setup_log
  root="${TMP_WORK_DIR}/repair-retry"
  write_fake_commands "${root}/fake-bin"
  prepare_home "${root}/home"
  : > "${root}/launchctl.log"
  : > "${root}/curl.log"
  : > "${root}/api.log"

  output="$(FAKE_REPAIR_FAIL_ONCE="${root}/repair-fail-once" run_installer "$root" --version 9.9.9 --terminal-session)" || {
    printf '%s\n' "$output" >&2
    die "expected install to pass after repair retry"
  }

  repair_calls="$(grep -c "/v1/device/repair" "${root}/curl.log")"
  setup_log="$(support_log "$root")"
  [[ "$repair_calls" == "2" ]] || die "expected two repair calls, got ${repair_calls}"
  assert_not_contains "$output" "Mac App API POST /v1/device/repair failed"
  assert_contains "$setup_log" "VibeTV did not answer yet; retrying (1/3)"
  assert_contains "$setup_log" "setup verified; Mac App ready, VibeTV connected, firmware 9.9.9"
}

run_install_waits_for_slow_repair_recovery() {
  local root output repair_calls setup_log
  root="${TMP_WORK_DIR}/slow-repair-recovery"
  write_fake_commands "${root}/fake-bin"
  prepare_home "${root}/home"
  : > "${root}/launchctl.log"
  : > "${root}/curl.log"
  : > "${root}/api.log"

  output="$(
    FAKE_REPAIR_FAIL_COUNT=4 \
      FAKE_REPAIR_COUNTER="${root}/repair-counter" \
      VIBETV_COMPANION_REPAIR_ATTEMPTS=5 \
      run_installer "$root" --version 9.9.9 --terminal-session
  )" || {
    printf '%s\n' "$output" >&2
    die "expected install to pass after slow repair recovery"
  }

  repair_calls="$(grep -c "/v1/device/repair" "${root}/curl.log")"
  setup_log="$(support_log "$root")"
  [[ "$repair_calls" == "5" ]] || die "expected five repair calls, got ${repair_calls}"
  assert_contains "$setup_log" "VibeTV did not answer yet; retrying (4/5)"
  assert_contains "$setup_log" "VibeTV is connected at http://192.168.178.72"
  assert_contains "$setup_log" "setup verified; Mac App ready, VibeTV connected, firmware 9.9.9"
}

run_install_uses_connected_status_after_repair_timeout() {
  local root output repair_calls setup_log
  root="${TMP_WORK_DIR}/repair-timeout-connected-status"
  write_fake_commands "${root}/fake-bin"
  prepare_home "${root}/home"
  : > "${root}/launchctl.log"
  : > "${root}/curl.log"
  : > "${root}/api.log"

  output="$(FAKE_REPAIR_ALWAYS_FAIL=1 run_installer "$root" --version 9.9.9 --terminal-session)" || {
    printf '%s\n' "$output" >&2
    die "expected install to continue when status is already connected"
  }

  repair_calls="$(grep -c "/v1/device/repair" "${root}/curl.log")"
  setup_log="$(support_log "$root")"
  [[ "$repair_calls" == "3" ]] || die "expected three repair calls, got ${repair_calls}"
  assert_contains "$setup_log" "VibeTV is already connected at http://192.168.178.72"
  assert_contains "$setup_log" "setup verified; Mac App ready, VibeTV connected, firmware 9.9.9"
}

run_install_prints_repair_failure_details() {
  local root output status repair_calls setup_log
  root="${TMP_WORK_DIR}/repair-fail"
  write_fake_commands "${root}/fake-bin"
  prepare_home "${root}/home"
  : > "${root}/launchctl.log"
  : > "${root}/curl.log"
  : > "${root}/api.log"

  set +e
  output="$(FAKE_REPAIR_ALWAYS_FAIL=1 FAKE_STATUS_DEVICE_DISCONNECTED=1 run_installer "$root" --version 9.9.9 --terminal-session)"
  status=$?
  set -e
  [[ "$status" != "0" ]] || die "expected install to fail when repair never succeeds"

  repair_calls="$(grep -c "/v1/device/repair" "${root}/curl.log")"
  setup_log="$(support_log "$root")"
  [[ "$repair_calls" == "3" ]] || die "expected three repair calls, got ${repair_calls}"
  assert_contains "$output" "VIBETV setup needs attention."
  assert_contains "$output" "VibeTV could not connect. Keep VibeTV powered on and on the same WiFi, then rerun setup."
  assert_contains "$output" "Support log:"
  assert_contains "$output" "For full details, rerun with --verbose."
  assert_not_contains "$output" "error code: device_not_found"
  assert_contains "$setup_log" "Mac App API POST /v1/device/repair failed"
  assert_contains "$setup_log" "api status=404"
  assert_contains "$setup_log" "api code=device_not_found"
  assert_contains "$setup_log" "api detail=No VibeTV device was found."
  assert_contains "$setup_log" "api next step=Make sure VibeTV is powered on and run device discovery again."
}

run_install_restarts_when_old_api_version_answers() {
  local root output kickstarts setup_log
  root="${TMP_WORK_DIR}/old-api-version"
  write_fake_commands "${root}/fake-bin"
  prepare_home "${root}/home"
  : > "${root}/launchctl.log"
  : > "${root}/curl.log"
  : > "${root}/api.log"

  output="$(FAKE_STATUS_OLD_ONCE="${root}/status-old-once" run_installer "$root" --version 9.9.9 --terminal-session)" || {
    printf '%s\n' "$output" >&2
    die "expected install to pass after old API restart"
  }

  setup_log="$(support_log "$root")"
  assert_contains "$setup_log" "Mac App answered with version 9.9.8; restarting once"
  assert_contains "$setup_log" "setup verified; Mac App ready, VibeTV connected, firmware 9.9.9"
  kickstarts="$(grep -c "kickstart -k gui/$(id -u)/com.codexbar-display.daemon" "${root}/launchctl.log")"
  [[ "$kickstarts" == "3" ]] || die "expected initial start, version restart, and target restart, got ${kickstarts}"
}

run_install_writes_integrated_daemon_launchagent
run_install_can_skip_device_setup_for_mac_app_update
run_install_disables_global_legacy_launchagent
run_install_retries_transient_repair_failure
run_install_waits_for_slow_repair_recovery
run_install_uses_connected_status_after_repair_timeout
run_install_prints_repair_failure_details
run_install_restarts_when_old_api_version_answers
run_restart_updates_daemon_launchagent
run_uninstall_stops_terminal_service_and_legacy_launchagent

printf 'daemon Mac setup installer tests passed\n'
