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

assert_gate_runs_ui_review_gate_test() {
  grep -F 'run_step "Control Center UI review gate tests"' "$GATE" >/dev/null \
    || die "customer-ready gate must run the Control Center UI review gate tests"
  grep -F 'test-control-center-ui-review-gate.sh' "$GATE" >/dev/null \
    || die "customer-ready gate must call test-control-center-ui-review-gate.sh"
}

assert_gate_runs_customer_docs_guard() {
  grep -F 'run_step "Control Center customer docs guard"' "$GATE" >/dev/null \
    || die "customer-ready gate must run the Control Center customer docs guard"
  grep -F 'check-control-center-customer-docs.sh' "$GATE" >/dev/null \
    || die "customer-ready gate must call check-control-center-customer-docs.sh"
}

assert_gate_runs_customer_ui_copy_guard() {
  grep -F 'run_step "Control Center customer UI copy guard"' "$GATE" >/dev/null \
    || die "customer-ready gate must run the Control Center customer UI copy guard"
  grep -F 'npm run check:customer-ui-copy' "$GATE" >/dev/null \
    || die "customer-ready gate must call npm run check:customer-ui-copy"
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
  "latestVersion": "${version}"
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
      "name": "codexbar-display-darwin-arm64-v1.2.3",
      "browser_download_url": "https://downloads.example.test/codexbar-display-darwin-arm64-v1.2.3"
    },
    {
      "name": "codexbar-display-darwin-amd64-v1.2.3",
      "browser_download_url": "https://downloads.example.test/codexbar-display-darwin-amd64-v1.2.3"
    },
    {
      "name": "checksums-v1.2.3.txt",
      "browser_download_url": "https://downloads.example.test/checksums-v1.2.3.txt"
    }
  ]
}
JSON
}

write_missing_binary_release_json() {
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
      "name": "codexbar-display-darwin-arm64-v1.2.3",
      "browser_download_url": "https://downloads.example.test/codexbar-display-darwin-arm64-v1.2.3"
    },
    {
      "name": "checksums-v1.2.3.txt",
      "browser_download_url": "https://downloads.example.test/checksums-v1.2.3.txt"
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

run_expect_missing_release_asset_failure() {
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

  [[ "$status" -ne 0 ]] || die "expected missing release asset fixture to fail"
  assert_contains "$output" "missing release assets: codexbar-display-darwin-amd64-v1.2.3"
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
  assert_contains "$output" "customer-like Mac setup has not been confirmed"
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

  assert_contains "$output" "PASS: customer-like Mac setup evidence supplied"
  assert_contains "$output" "PASS: user-approved hardware test evidence supplied"
  assert_contains "$output" "PASS: Control Center customer-ready gate passed"
}

FAKE_CURL="${TMP_WORK_DIR}/curl"
COMPLETE_RELEASE="${TMP_WORK_DIR}/complete-release.json"
MISSING_RELEASE="${TMP_WORK_DIR}/missing-release.json"

write_fake_curl "$FAKE_CURL"
write_complete_release_json "$COMPLETE_RELEASE"
write_missing_binary_release_json "$MISSING_RELEASE"

assert_gate_runs_ui_review_gate_test
assert_gate_runs_release_workflow_test
assert_gate_runs_customer_docs_guard
assert_gate_runs_customer_ui_copy_guard
run_expect_automated_success
run_expect_missing_release_asset_failure
run_expect_manual_gate_failure
run_expect_manual_gate_success

printf 'customer-ready gate tests passed\n'
