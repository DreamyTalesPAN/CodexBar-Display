#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${ROOT}/apps/control-center"
TMP_WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-local-static-companion.XXXXXX")"
SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_WORK_DIR"
}

trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

free_port() {
  python3 - <<'PY'
import socket

with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    print(sock.getsockname()[1])
PY
}

wait_for_http() {
  local url="$1"
  for _ in $(seq 1 80); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  printf 'error: timed out waiting for %s\n' "$url" >&2
  return 1
}

extract_next_asset_path() {
  python3 - "$1" <<'PY'
import re
import sys

html = open(sys.argv[1], encoding="utf-8", errors="replace").read()
match = re.search(r'["\'](/_next/static/[^"\']+)["\']', html)
if not match:
    raise SystemExit("no _next static asset found")
print(match.group(1))
PY
}

expect_http_status() {
  local expected="$1"
  local method="$2"
  local url="$3"
  local actual
  actual="$(curl -sS -o /dev/null -w '%{http_code}' -X "$method" "$url")"
  [[ "$actual" == "$expected" ]] \
    || {
      printf 'error: expected %s %s to return %s, got %s\n' "$method" "$url" "$expected" "$actual" >&2
      exit 1
    }
}

main() {
  local companion_copy static_dir port base_url index_file asset_path

  (cd "$APP_DIR" && npm run build:local)

  companion_copy="${TMP_WORK_DIR}/companion"
  cp -R "${ROOT}/companion" "$companion_copy"
  static_dir="${companion_copy}/internal/companionapi/controlcenter_static"
  rm -rf "$static_dir"
  mkdir -p "$static_dir"
  cp -R "${APP_DIR}/out-local/." "$static_dir/"

  (
    cd "$companion_copy"
    go build -o "${TMP_WORK_DIR}/codexbar-display" ./cmd/codexbar-display
  )

  port="$(free_port)"
  base_url="http://127.0.0.1:${port}"
  "${TMP_WORK_DIR}/codexbar-display" api --addr "127.0.0.1:${port}" \
    >"${TMP_WORK_DIR}/server.out" 2>"${TMP_WORK_DIR}/server.err" &
  SERVER_PID="$!"

  wait_for_http "${base_url}/control-center"

  index_file="${TMP_WORK_DIR}/index.html"
  curl -fsS "${base_url}/control-center" > "$index_file"
  grep -F "_next/static" "$index_file" >/dev/null \
    || {
      printf 'error: local Control Center HTML does not reference Next static assets\n' >&2
      exit 1
    }

  asset_path="$(extract_next_asset_path "$index_file")"
  curl -fsS "${base_url}${asset_path}" >/dev/null
  curl -fsS "${base_url}/theme-packs/vibetv-theme-packs.json" >/dev/null
  curl -fsS "${base_url}/theme-packs/render/mini-classic.json" \
    | grep -F '"spec"' >/dev/null \
    || {
      printf 'error: local Theme Studio render pack is unavailable\n' >&2
      exit 1
    }
  expect_http_status 404 POST "${base_url}/api/ai-theme"
  expect_http_status 404 POST "${base_url}/api/custom-theme-pack"

  printf 'local static Control Center Companion test passed\n'
}

main "$@"
