#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
READINESS="${ROOT}/scripts/check-control-center-companion-customer-readiness.sh"
APP_DIR="${ROOT}/apps/control-center"
REPO="${CONTROL_CENTER_CUSTOMER_READY_REPO:-DreamyTalesPAN/CodexBar-Display}"
GITHUB_API_BASE="${CONTROL_CENTER_GITHUB_API_BASE:-https://api.github.com}"
APP_URL="https://app.vibetv.shop"
THEME_ID="synthwave"
RELEASE_TAG=""
RELEASE_JSON=""
SKIP_LOCAL=0
SKIP_LIVE=0
SKIP_RELEASE=0
AUTOMATED_ONLY=0
CLEAN_MAC_TESTED=0
HARDWARE_TESTED=0
FAILURES=()
TMP_WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-customer-ready.XXXXXX")"

cleanup() {
  rm -rf "$TMP_WORK_DIR"
}

trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

usage() {
  cat <<'EOF'
Usage:
  check-control-center-customer-ready-gate.sh [options]

Runs the no-write Control Center customer-ready gate.

Default behavior:
  - runs local Control Center checks,
  - checks the hosted customer app and Shopify catalog,
  - checks the latest GitHub release for customer macOS Companion packages,
  - fails until Clean-Mac and approved hardware-test evidence is supplied.

Options:
  --release v1.2.3       Check an exact release tag instead of GitHub latest.
  --release-json path    Use a local GitHub release JSON fixture.
  --app-url URL          Hosted app URL. Default: https://app.vibetv.shop.
  --theme-id ID          Public free theme used for deep-link checks. Default: synthwave.
  --skip-local           Skip local app/UI tests.
  --skip-live            Skip hosted app and Shopify catalog checks.
  --skip-release         Skip release package checks.
  --automated-only       Do not require manual Clean-Mac or hardware evidence.
  --clean-mac-tested     Assert the signed package was validated on a clean Mac.
  --hardware-tested      Assert a user-approved hardware write test passed.
  -h, --help             Show this help.

This script never merges, tags, releases, installs packages, starts services,
discovers devices, or writes to VibeTV hardware.
EOF
}

log() {
  printf 'gate: %s\n' "$*"
}

fail() {
  FAILURES+=("$*")
  printf 'gate: FAIL: %s\n' "$*" >&2
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help)
        usage
        exit 0
        ;;
      --release)
        [[ $# -ge 2 ]] || {
          fail "--release requires a value"
          return
        }
        RELEASE_TAG="$2"
        shift 2
        ;;
      --release=*)
        RELEASE_TAG="${1#*=}"
        shift
        ;;
      --release-json)
        [[ $# -ge 2 ]] || {
          fail "--release-json requires a value"
          return
        }
        RELEASE_JSON="$2"
        shift 2
        ;;
      --release-json=*)
        RELEASE_JSON="${1#*=}"
        shift
        ;;
      --app-url)
        [[ $# -ge 2 ]] || {
          fail "--app-url requires a value"
          return
        }
        APP_URL="$2"
        shift 2
        ;;
      --app-url=*)
        APP_URL="${1#*=}"
        shift
        ;;
      --theme-id)
        [[ $# -ge 2 ]] || {
          fail "--theme-id requires a value"
          return
        }
        THEME_ID="$2"
        shift 2
        ;;
      --theme-id=*)
        THEME_ID="${1#*=}"
        shift
        ;;
      --skip-local)
        SKIP_LOCAL=1
        shift
        ;;
      --skip-live)
        SKIP_LIVE=1
        shift
        ;;
      --skip-release)
        SKIP_RELEASE=1
        shift
        ;;
      --automated-only)
        AUTOMATED_ONLY=1
        shift
        ;;
      --clean-mac-tested)
        CLEAN_MAC_TESTED=1
        shift
        ;;
      --hardware-tested)
        HARDWARE_TESTED=1
        shift
        ;;
      *)
        fail "unknown option: $1"
        shift
        ;;
    esac
  done
}

run_step() {
  local name
  name="$1"
  shift
  printf '\n==> %s\n' "$name"
  if "$@"; then
    log "PASS: ${name}"
  else
    fail "${name}"
  fi
}

run_in_dir() {
  local dir
  dir="$1"
  shift
  (cd "$dir" && "$@")
}

github_headers() {
  local token
  token="${CONTROL_CENTER_GITHUB_TOKEN:-${GITHUB_TOKEN:-}}"
  GITHUB_HEADERS=(
    -H "Accept: application/vnd.github+json"
    -H "X-GitHub-Api-Version: 2022-11-28"
  )
  if [[ -n "$token" ]]; then
    GITHUB_HEADERS+=(-H "Authorization: Bearer ${token}")
  fi
}

latest_release_tag() {
  local json
  command -v curl >/dev/null 2>&1 || {
    fail "curl is required to resolve the latest release"
    return 1
  }
  command -v python3 >/dev/null 2>&1 || {
    fail "python3 is required to parse the latest release"
    return 1
  }

  github_headers
  json="${TMP_WORK_DIR}/latest-release.json"
  curl -fsSL "${GITHUB_HEADERS[@]}" \
    "${GITHUB_API_BASE%/}/repos/${REPO}/releases/latest" > "$json"
  python3 - "$json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    payload = json.load(f)

tag = str(payload.get("tag_name", "")).strip()
if not tag:
    raise SystemExit("latest release response did not include tag_name")
print(tag)
PY
}

run_local_checks() {
  [[ "$SKIP_LOCAL" -eq 0 ]] || {
    log "SKIP: local checks"
    return
  }

  run_step "Control Center UI review gate" \
    node "${ROOT}/scripts/check-control-center-ui-review-gate.mjs"
  run_step "Control Center lint" \
    run_in_dir "$APP_DIR" npm run lint
  run_step "Control Center customer-flow tests" \
    run_in_dir "$APP_DIR" npm run test:customer-flows
  run_step "Customer-readiness checker tests" \
    "${ROOT}/scripts/test-control-center-companion-customer-readiness.sh"
  run_step "Control Center release workflow test" \
    "${ROOT}/scripts/test-control-center-release-workflow.sh"
  run_step "Legacy Companion installer guard tests" \
    "${ROOT}/scripts/test-control-center-companion-legacy-installer.sh"
}

run_live_checks() {
  [[ "$SKIP_LIVE" -eq 0 ]] || {
    log "SKIP: hosted app checks"
    return
  }

  run_step "Hosted app, Shopify catalog, and public theme links" \
    "$READINESS" \
      --app-url "$APP_URL" \
      --expect-catalog-source shopify \
      --expect-theme-id "$THEME_ID" \
      --expect-all-free-themes-installable \
      --expect-shopify-product-pages
}

run_release_checks() {
  local tag
  [[ "$SKIP_RELEASE" -eq 0 ]] || {
    log "SKIP: release package checks"
    return
  }

  if [[ -n "$RELEASE_TAG" && -n "$RELEASE_JSON" ]]; then
    fail "Use only one of --release or --release-json"
    return
  fi

  local release_args=()
  if [[ -n "$RELEASE_JSON" ]]; then
    [[ -f "$RELEASE_JSON" ]] || {
      fail "Release JSON does not exist: ${RELEASE_JSON}"
      return
    }
    release_args=(--release-json "$RELEASE_JSON")
    tag="fixture ${RELEASE_JSON}"
  elif [[ -n "$RELEASE_TAG" ]]; then
    tag="$RELEASE_TAG"
    release_args=(--release "$tag")
  else
    if ! tag="$(latest_release_tag)"; then
      fail "Latest GitHub release could not be resolved"
      return
    fi
    release_args=(--release "$tag")
  fi

  log "Release under test: ${tag}"
  run_step "Release exposes customer Companion packages through hosted app" \
    "$READINESS" \
      "${release_args[@]}" \
      --app-url "$APP_URL"
}

run_manual_gate_checks() {
  [[ "$AUTOMATED_ONLY" -eq 0 ]] || {
    log "SKIP: manual evidence gates because --automated-only was used"
    return
  }

  if [[ "$CLEAN_MAC_TESTED" -eq 1 ]]; then
    log "PASS: Clean-Mac package evidence supplied"
  else
    fail "Clean-Mac package install has not been confirmed"
  fi

  if [[ "$HARDWARE_TESTED" -eq 1 ]]; then
    log "PASS: user-approved hardware test evidence supplied"
  else
    fail "user-approved hardware write test has not been confirmed"
  fi
}

print_summary() {
  printf '\n==> Customer-ready gate summary\n'
  if [[ "${#FAILURES[@]}" -eq 0 ]]; then
    log "PASS: Control Center customer-ready gate passed"
    return 0
  fi

  log "BLOCKED: Control Center is not customer-ready yet"
  local item
  for item in "${FAILURES[@]}"; do
    printf 'gate: - %s\n' "$item" >&2
  done
  return 1
}

main() {
  parse_args "$@"
  log "Control Center customer-ready gate"
  log "No merge, release, install, service start, discovery, or hardware write will be performed."

  if [[ "${#FAILURES[@]}" -gt 0 ]]; then
    print_summary
    exit 1
  fi

  run_local_checks
  run_live_checks
  run_release_checks
  run_manual_gate_checks
  print_summary
}

main "$@"
