#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATE="${ROOT}/scripts/check-control-center-customer-ready-gate.sh"
TMP_WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-ready-gate-test.XXXXXX")"

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

assert_gate_runs_release_workflow_test() {
  grep -F 'run_step "Control Center release workflow test"' "$GATE" >/dev/null \
    || die "customer-ready gate must run the Control Center release workflow test"
  grep -F 'test-control-center-release-workflow.sh' "$GATE" >/dev/null \
    || die "customer-ready gate must call test-control-center-release-workflow.sh"
}

assert_gate_runs_package_smoke_test() {
  grep -F 'run_step "Companion package smoke test"' "$GATE" >/dev/null \
    || die "customer-ready gate must run the Companion package smoke test on macOS"
  grep -F 'test-control-center-companion-pkg-build.sh' "$GATE" >/dev/null \
    || die "customer-ready gate must call test-control-center-companion-pkg-build.sh"
}

assert_gate_runs_customer_docs_guard() {
  grep -F 'run_step "Control Center customer docs guard"' "$GATE" >/dev/null \
    || die "customer-ready gate must run the Control Center customer docs guard"
  grep -F 'check-control-center-customer-docs.sh' "$GATE" >/dev/null \
    || die "customer-ready gate must call check-control-center-customer-docs.sh"
}

write_fake_curl() {
  local path
  path="$1"
  cat > "$path" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

version="${FAKE_RELEASE_VERSION:-1.2.3}"
url="${@: -1}"

case "$url" in
  https://app.example.test)
    exit 0
    ;;
  https://app.example.test/api/companion/latest)
    cat <<JSON
{
  "status": "available",
  "latestVersion": "${version}",
  "packageDownloadUrls": {
    "macosArm64": "https://downloads.example.test/VibeTV-Companion-API-arm64-v${version}.pkg",
    "macosAmd64": "https://downloads.example.test/VibeTV-Companion-API-amd64-v${version}.pkg"
  }
}
JSON
    ;;
  *)
    echo "unexpected fake curl URL: ${url}" >&2
    exit 22
    ;;
esac
EOF
  chmod +x "$path"
}

write_complete_release_json() {
  local path
  path="$1"
  cat > "$path" <<'JSON'
{
  "tag_name": "v1.2.3",
  "assets": [
    {
      "name": "install-control-center-companion.sh",
      "browser_download_url": "https://downloads.example.test/install-control-center-companion.sh"
    },
    {
      "name": "VibeTV-Companion-API-arm64-v1.2.3.pkg",
      "browser_download_url": "https://downloads.example.test/VibeTV-Companion-API-arm64-v1.2.3.pkg"
    },
    {
      "name": "VibeTV-Companion-API-amd64-v1.2.3.pkg",
      "browser_download_url": "https://downloads.example.test/VibeTV-Companion-API-amd64-v1.2.3.pkg"
    }
  ]
}
JSON
}

write_missing_package_release_json() {
  local path
  path="$1"
  cat > "$path" <<'JSON'
{
  "tag_name": "v1.2.3",
  "assets": [
    {
      "name": "install-control-center-companion.sh",
      "browser_download_url": "https://downloads.example.test/install-control-center-companion.sh"
    },
    {
      "name": "VibeTV-Companion-API-arm64-v1.2.3.pkg",
      "browser_download_url": "https://downloads.example.test/VibeTV-Companion-API-arm64-v1.2.3.pkg"
    }
  ]
}
JSON
}

run_expect_automated_success() {
  local output
  output="$(
    CONTROL_CENTER_READINESS_CURL="$FAKE_CURL" \
      "$GATE" \
        --skip-local \
        --skip-live \
        --release-json "$COMPLETE_RELEASE" \
        --app-url https://app.example.test \
        --automated-only \
        2>&1
  )" || {
    printf '%s\n' "$output" >&2
    die "expected automated customer-ready gate fixture to pass"
  }

  assert_contains "$output" "hosted app Companion release API ok for v1.2.3"
  assert_contains "$output" "PASS: Control Center customer-ready gate passed"
}

run_expect_missing_release_failure() {
  local output status
  set +e
  output="$(
    CONTROL_CENTER_READINESS_CURL="$FAKE_CURL" \
      "$GATE" \
        --skip-local \
        --skip-live \
        --release-json "$MISSING_RELEASE" \
        --app-url https://app.example.test \
        --automated-only \
        2>&1
  )"
  status=$?
  set -e

  [[ "$status" -ne 0 ]] || die "expected missing release package fixture to fail"
  assert_contains "$output" "missing release package assets: VibeTV-Companion-API-amd64-v1.2.3.pkg"
  assert_contains "$output" "BLOCKED: Control Center is not customer-ready yet"
}

run_expect_manual_gate_failure() {
  local output status
  set +e
  output="$(
    CONTROL_CENTER_READINESS_CURL="$FAKE_CURL" \
      "$GATE" \
        --skip-local \
        --skip-live \
        --release-json "$COMPLETE_RELEASE" \
        --app-url https://app.example.test \
        2>&1
  )"
  status=$?
  set -e

  [[ "$status" -ne 0 ]] || die "expected missing manual evidence gates to fail"
  assert_contains "$output" "Clean-Mac package install has not been confirmed"
  assert_contains "$output" "user-approved hardware write test has not been confirmed"
}

run_expect_manual_gate_success() {
  local output
  output="$(
    CONTROL_CENTER_READINESS_CURL="$FAKE_CURL" \
      "$GATE" \
        --skip-local \
        --skip-live \
        --release-json "$COMPLETE_RELEASE" \
        --app-url https://app.example.test \
        --clean-mac-tested \
        --hardware-tested \
        2>&1
  )" || {
    printf '%s\n' "$output" >&2
    die "expected customer-ready gate to pass when all fixture gates are satisfied"
  }

  assert_contains "$output" "PASS: Clean-Mac package evidence supplied"
  assert_contains "$output" "PASS: user-approved hardware test evidence supplied"
  assert_contains "$output" "PASS: Control Center customer-ready gate passed"
}

FAKE_CURL="${TMP_WORK_DIR}/curl"
COMPLETE_RELEASE="${TMP_WORK_DIR}/complete-release.json"
MISSING_RELEASE="${TMP_WORK_DIR}/missing-release.json"

write_fake_curl "$FAKE_CURL"
write_complete_release_json "$COMPLETE_RELEASE"
write_missing_package_release_json "$MISSING_RELEASE"

assert_gate_runs_release_workflow_test
assert_gate_runs_package_smoke_test
assert_gate_runs_customer_docs_guard
run_expect_automated_success
run_expect_missing_release_failure
run_expect_manual_gate_failure
run_expect_manual_gate_success

printf 'customer-ready gate tests passed\n'
