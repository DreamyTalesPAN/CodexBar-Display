#!/usr/bin/env bash
set -euo pipefail

command_name="${1:-}"
shift || true

die() {
  printf 'error: Tart driver: %s\n' "$*" >&2
  exit 1
}

case "$command_name" in
  check)
    [[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]] \
      || die "real macOS guests require an Apple-Silicon Mac"
    command -v tart >/dev/null 2>&1 || die "tart is missing; install it with: brew install cirruslabs/cli/tart"
    ;;
  clone)
    source_image="${1:?source image required}"
    vm_name="${2:?VM name required}"
    tart clone "$source_image" "$vm_name"
    ;;
  run)
    vm_name="${1:?VM name required}"
    share_dir="${2:?share directory required}"
    run_dir="${3:?run directory required}"
    mkdir -p "$run_dir"
    tart run "$vm_name" --no-graphics --dir="codex-rc:${share_dir}" \
      >"$run_dir/tart.log" 2>&1 &
    printf '%s\n' "$!" > "$run_dir/tart.pid"
    deadline=$((SECONDS + 120))
    until tart exec "$vm_name" /usr/bin/true >/dev/null 2>&1; do
      (( SECONDS < deadline )) || die "guest agent did not become ready within 120 seconds"
      sleep 2
    done
    ;;
  exec)
    vm_name="${1:?VM name required}"
    shift
    tart exec "$vm_name" "$@"
    ;;
  stop)
    vm_name="${1:?VM name required}"
    tart stop "$vm_name" >/dev/null 2>&1 || tart stop "$vm_name" --force >/dev/null 2>&1 || true
    ;;
  delete)
    vm_name="${1:?VM name required}"
    tart delete "$vm_name"
    ;;
  *)
    die "unknown command ${command_name:-<empty>}"
    ;;
esac
