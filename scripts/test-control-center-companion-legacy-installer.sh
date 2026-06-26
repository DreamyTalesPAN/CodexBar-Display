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
  *"/releases/latest"*)
    printf '{"tag_name":"v9.9.9"}\n'
    ;;
  *"/codexbar-display-darwin-arm64-v9.9.9"*)
    [[ -n "$out" ]] || exit 22
    cat > "$out" <<'BIN'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${FAKE_API_LOG:?}"
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

  chmod +x \
    "${fake_bin}/codesign" \
    "${fake_bin}/curl" \
    "${fake_bin}/launchctl" \
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
      "$INSTALLER" "$@" \
      2>&1
  )"
  status=$?
  set -e
  printf '%s\n' "$output"
  return "$status"
}

run_restart_uses_terminal_started_service() {
  local root output pid_file pid plist api_log
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

  pid_file="${root}/home/Library/Application Support/codexbar-display/run/companion-api.pid"
  plist="${root}/home/Library/LaunchAgents/com.codexbar-display.companion-api.plist"
  api_log="${root}/api.log"

  assert_contains "$output" "Mac setup service is running"
  [[ -f "$pid_file" ]] || die "restart did not write terminal service pid"
  pid="$(cat "$pid_file")"
  kill -0 "$pid" >/dev/null 2>&1 || die "terminal-started service is not running"
  [[ ! -f "$plist" ]] || die "legacy LaunchAgent plist should be removed"
  assert_contains "$(cat "${root}/launchctl.log")" "bootout"
  for _ in $(seq 1 20); do
    if [[ -s "$api_log" ]]; then
      break
    fi
    sleep 0.1
  done
  assert_contains "$(cat "$api_log")" "api --addr 127.0.0.1:47832"
}

run_uninstall_stops_terminal_service_and_legacy_launchagent() {
  local root output pid_file pid plist
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

  assert_contains "$output" "Mac setup service stopped"
  [[ ! -f "$pid_file" ]] || die "uninstall did not remove terminal service pid"
  ! kill -0 "$pid" >/dev/null 2>&1 || die "uninstall did not stop terminal service"
  [[ ! -f "$plist" ]] || die "uninstall did not remove legacy LaunchAgent plist"
  assert_contains "$(cat "${root}/launchctl.log")" "bootout"
}

run_install_refreshes_existing_display_stream() {
  local root output pid_file pid launch_log api_log
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

  pid_file="${root}/home/Library/Application Support/codexbar-display/run/companion-api.pid"
  launch_log="$(cat "${root}/launchctl.log")"
  api_log="${root}/api.log"

  assert_contains "$output" "display stream refreshed"
  assert_contains "$launch_log" "print gui/$(id -u)/com.codexbar-display.daemon"
  assert_contains "$launch_log" "kickstart -k gui/$(id -u)/com.codexbar-display.daemon"
  [[ -f "$pid_file" ]] || die "install did not write terminal service pid"
  pid="$(cat "$pid_file")"
  kill -0 "$pid" >/dev/null 2>&1 || die "terminal-started service is not running"
  for _ in $(seq 1 20); do
    if [[ -s "$api_log" ]]; then
      break
    fi
    sleep 0.1
  done
  assert_contains "$(cat "$api_log")" "api --addr 127.0.0.1:47832"
}

run_install_refreshes_existing_display_stream
run_restart_uses_terminal_started_service
run_uninstall_stops_terminal_service_and_legacy_launchagent

printf 'terminal Mac setup installer tests passed\n'
