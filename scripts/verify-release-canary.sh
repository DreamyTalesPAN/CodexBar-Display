#!/usr/bin/env bash
# Post-publish canary: verifies against the real hosted endpoints that an
# installed prerelease build (e.g. 1.0.44-rc.16) is offered the matching
# final release, and that the exact final release stays current.
#
# See https://github.com/DreamyTalesPAN/CodexBar-Display/issues/173
set -euo pipefail

VERSION=""
BASE_URL="https://app.vibetv.shop"
FIRMWARE_CONFIG="release/firmware-versions.json"
TIMEOUT_SECONDS=600
RETRY_SLEEP_SECONDS=30

usage() {
  cat >&2 <<'EOF'
usage: verify-release-canary.sh --version <x.y.z> [options]

options:
  --version <x.y.z>          published Mac App release version (no leading v)
  --base-url <url>           hosted Control Center base URL (default https://app.vibetv.shop)
  --firmware-config <path>   firmware versions config (default release/firmware-versions.json)
  --timeout <seconds>        total retry budget per check (default 600)
EOF
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="${2:-}"; shift 2 ;;
    --base-url) BASE_URL="${2:-}"; shift 2 ;;
    --firmware-config) FIRMWARE_CONFIG="${2:-}"; shift 2 ;;
    --timeout) TIMEOUT_SECONDS="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done

VERSION="${VERSION#v}"
if [[ -z "${VERSION}" ]]; then
  usage
fi
if [[ ! -f "${FIRMWARE_CONFIG}" ]]; then
  echo "error: firmware config not found: ${FIRMWARE_CONFIG}" >&2
  exit 1
fi

# check <description> <url> <python-assertion>
# The assertion runs with the decoded JSON body bound to `body`.
check() {
  local description="$1"
  local url="$2"
  local assertion="$3"
  local deadline=$((SECONDS + TIMEOUT_SECONDS))
  local last_error=""

  while true; do
    local payload
    if payload="$(curl -fsS --max-time 20 "${url}" 2>&1)"; then
      if last_error="$(PAYLOAD="${payload}" ASSERTION="${assertion}" python3 -c "
import json, os
body = json.loads(os.environ['PAYLOAD'])
assertion = os.environ['ASSERTION']
if not eval(assertion):
    raise SystemExit('assertion failed: %s body=%r' % (assertion, body))
" 2>&1)"; then
        echo "ok: ${description}"
        return 0
      fi
    else
      last_error="${payload}"
    fi

    if (( SECONDS >= deadline )); then
      echo "error: ${description}" >&2
      echo "  url: ${url}" >&2
      echo "  ${last_error}" >&2
      return 1
    fi
    echo "retry: ${description} (${last_error})" >&2
    sleep "${RETRY_SLEEP_SECONDS}"
  done
}

echo "Verifying release canary for v${VERSION} against ${BASE_URL}"

check "Mac App RC install is offered v${VERSION}" \
  "${BASE_URL}/api/companion/latest?version=${VERSION}-rc.1" \
  "body['updateAvailable'] is True and body['latestVersion'] == '${VERSION}'"

check "Mac App v${VERSION} stays current" \
  "${BASE_URL}/api/companion/latest?version=${VERSION}" \
  "body['updateAvailable'] is False and body['status'] == 'available'"

while IFS=$'\t' read -r BOARD FW_VERSION; do
  check "firmware ${BOARD} RC install is offered v${FW_VERSION}" \
    "${BASE_URL}/api/firmware/latest?board=${BOARD}&firmware=${FW_VERSION}-rc.1" \
    "body['updateAvailable'] is True and body['latestFirmware'] == '${FW_VERSION}'"

  check "firmware ${BOARD} v${FW_VERSION} stays current" \
    "${BASE_URL}/api/firmware/latest?board=${BOARD}&firmware=${FW_VERSION}" \
    "body['updateAvailable'] is False and body['status'] == 'current'"
done < <(python3 -c "
import json, sys
with open('${FIRMWARE_CONFIG}', encoding='utf-8') as f:
    config = json.load(f)
for artifact in config.get('artifacts', []):
    board = str(artifact.get('board', '')).strip()
    version = str(artifact.get('firmwareVersion', '')).strip().lstrip('v')
    if not board or not version:
        raise SystemExit('firmware artifacts need board and firmwareVersion')
    print(f'{board}\t{version}')
")

echo "Release canary passed for v${VERSION}"
