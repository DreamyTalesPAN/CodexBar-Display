#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
READINESS="${ROOT}/scripts/check-control-center-companion-customer-readiness.sh"
TMP_WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-readiness-test.XXXXXX")"

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

run_expect_success() {
  local output
  output="$(
    CONTROL_CENTER_READINESS_CURL="$FAKE_CURL" \
      "$READINESS" \
        --app-url https://app.example.test \
        --expect-catalog-source shopify \
        --expect-theme-id synthwave \
        --expect-all-free-themes-installable \
        --expect-shopify-product-pages \
        --shopify-app-url https://app.example.test \
        --shopify-store-url https://vibetv.example.test \
        2>&1
  )" || {
    printf '%s\n' "$output" >&2
    die "expected catalog-derived Shopify product page check to pass"
  }

  assert_contains "$output" "hosted app theme catalog ok:"
  assert_contains "$output" "app install routes reachable for all free themes: 2"
  assert_contains "$output" "app Shopify product pages reachable and ready: 2"
  assert_contains "$output" "customer-readiness checks passed"
}

run_expect_broken_product_page_failure() {
  local output status
  set +e
  output="$(
    CONTROL_CENTER_READINESS_CURL="$FAKE_CURL" \
      "$READINESS" \
        --shopify-app-url https://app.example.test \
        --shopify-product-page https://vibetv.example.test/products/broken synthwave \
        2>&1
  )"
  status=$?
  set -e

  [[ "$status" -ne 0 ]] || die "expected broken Shopify product page check to fail"
  assert_contains "$output" "missing hosted app link https://app.example.test/install/synthwave"
}

run_expect_local_url_guard_failure() {
  local output status
  set +e
  output="$(
    CONTROL_CENTER_READINESS_CURL="$FAKE_CURL" \
      "$READINESS" \
        --shopify-product-page http://vibetv.local/products/synthwave synthwave \
        2>&1
  )"
  status=$?
  set -e

  [[ "$status" -ne 0 ]] || die "expected local Shopify product page URL to fail"
  assert_contains "$output" "must be a public product page, not localhost or .local"
}

run_expect_missing_free_pack_url_failure() {
  local output status
  set +e
  output="$(
    CONTROL_CENTER_READINESS_CURL="$FAKE_CURL" \
      FAKE_CURL_MODE="missing-free-pack-url" \
      "$READINESS" \
        --app-url https://app.example.test \
        --expect-catalog-source shopify \
        --expect-all-free-themes-installable \
        2>&1
  )"
  status=$?
  set -e

  [[ "$status" -ne 0 ]] || die "expected missing free theme pack URL check to fail"
  assert_contains "$output" "free theme 'missing-pack' packUrl missing"
}

run_expect_invalid_free_pack_url_failure() {
  local output status
  set +e
  output="$(
    CONTROL_CENTER_READINESS_CURL="$FAKE_CURL" \
      FAKE_CURL_MODE="invalid-free-pack-url" \
      "$READINESS" \
        --app-url https://app.example.test \
        --expect-catalog-source shopify \
        --expect-all-free-themes-installable \
        2>&1
  )"
  status=$?
  set -e

  [[ "$status" -ne 0 ]] || die "expected invalid free theme pack URL check to fail"
  assert_contains "$output" "free theme 'invalid-pack' packUrl is not an http(s) URL"
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

write_package_only_release_json() {
  local path
  path="$1"
  cat > "$path" <<'JSON'
{
  "tag_name": "v1.2.3",
  "assets": [
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

run_expect_release_assets_success() {
  local output release_json
  release_json="${TMP_WORK_DIR}/complete-release.json"
  write_complete_release_json "$release_json"

  output="$(
    "$READINESS" \
      --release-json "$release_json" \
      2>&1
  )" || {
    printf '%s\n' "$output" >&2
    die "expected complete release assets check to pass"
  }

  assert_contains "$output" "release assets ok for v1.2.3; support script available"
  assert_contains "$output" "customer-readiness checks passed"
}

run_expect_release_package_only_success() {
  local output release_json
  release_json="${TMP_WORK_DIR}/package-only-release.json"
  write_package_only_release_json "$release_json"

  output="$(
    "$READINESS" \
      --release-json "$release_json" \
      2>&1
  )" || {
    printf '%s\n' "$output" >&2
    die "expected package-only release assets check to pass"
  }

  assert_contains "$output" "release assets ok for v1.2.3; support script omitted"
  assert_contains "$output" "customer-readiness checks passed"
}

run_expect_release_missing_package_failure() {
  local output release_json status
  release_json="${TMP_WORK_DIR}/missing-package-release.json"
  write_missing_package_release_json "$release_json"

  set +e
  output="$(
    "$READINESS" \
      --release-json "$release_json" \
      2>&1
  )"
  status=$?
  set -e

  [[ "$status" -ne 0 ]] || die "expected missing release package asset check to fail"
  assert_contains "$output" "missing release package assets: VibeTV-Companion-API-amd64-v1.2.3.pkg"
}

run_expect_app_release_package_only_success() {
  local output release_json
  release_json="${TMP_WORK_DIR}/package-only-release-for-app.json"
  write_package_only_release_json "$release_json"

  output="$(
    CONTROL_CENTER_READINESS_CURL="$FAKE_CURL" \
      FAKE_CURL_MODE="app-release-package-only" \
      "$READINESS" \
        --release-json "$release_json" \
        --app-url https://app.example.test \
        2>&1
  )" || {
    printf '%s\n' "$output" >&2
    die "expected package-only hosted app release API check to pass"
  }

  assert_contains "$output" "hosted app Companion release API ok for v1.2.3"
  assert_contains "$output" "customer-readiness checks passed"
}

run_expect_app_release_missing_package_failure() {
  local output release_json status
  release_json="${TMP_WORK_DIR}/complete-release-for-app.json"
  write_complete_release_json "$release_json"

  set +e
  output="$(
    CONTROL_CENTER_READINESS_CURL="$FAKE_CURL" \
      FAKE_CURL_MODE="app-release-missing-package" \
      "$READINESS" \
        --release-json "$release_json" \
        --app-url https://app.example.test \
        2>&1
  )"
  status=$?
  set -e

  [[ "$status" -ne 0 ]] || die "expected hosted app missing package URL check to fail"
  assert_contains "$output" "packageDownloadUrls.macosAmd64 missing"
  assert_contains "$output" "installerDownloadUrl must stay hidden from the customer API"
}

run_expect_local_companion_success() {
  local output
  output="$(
    CONTROL_CENTER_READINESS_CURL="$FAKE_CURL" \
      "$READINESS" \
        --local-companion \
        --expect-version 1.2.3 \
        2>&1
  )" || {
    printf '%s\n' "$output" >&2
    die "expected local Companion check to pass"
  }

  assert_contains "$output" "local Companion ok: addr 127.0.0.1:47832, version 1.2.3"
  assert_contains "$output" "local Companion hosted-app preflight ok"
  assert_contains "$output" "customer-readiness checks passed"
}

run_expect_local_companion_pna_failure() {
  local output status
  set +e
  output="$(
    CONTROL_CENTER_READINESS_CURL="$FAKE_CURL" \
      FAKE_CURL_MODE="missing-pna-header" \
      "$READINESS" \
        --local-companion \
        --expect-version 1.2.3 \
        2>&1
  )"
  status=$?
  set -e

  [[ "$status" -ne 0 ]] || die "expected local Companion PNA preflight check to fail"
  assert_contains "$output" "local Companion hosted-app preflight missing"
  assert_contains "$output" "Access-Control-Allow-Private-Network"
}

write_installed_package_fixture() {
  local root bin_dir plist_dir fake_bin_dir
  root="$1"
  bin_dir="${root}/Library/Application Support/VibeTV/bin"
  plist_dir="${root}/Library/LaunchAgents"
  fake_bin_dir="${root}/fake-bin"
  mkdir -p "$bin_dir" "$plist_dir" "$fake_bin_dir" "${root}/home/Library/LaunchAgents"
  printf '#!/usr/bin/env bash\nexit 0\n' > "${bin_dir}/codexbar-display"
  chmod +x "${bin_dir}/codexbar-display"
  write_installed_package_plist "${plist_dir}/com.codexbar-display.companion-api.plist" "${bin_dir}/codexbar-display"

  cat > "${fake_bin_dir}/uname" <<'EOF'
#!/usr/bin/env bash
printf 'Darwin\n'
EOF
  cat > "${fake_bin_dir}/pkgutil" <<'EOF'
#!/usr/bin/env bash
if [[ "${1:-}" == "--pkg-info" ]]; then
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
  cat > "${fake_bin_dir}/id" <<'EOF'
#!/usr/bin/env bash
if [[ "${1:-}" == "-u" ]]; then
  printf '501\n'
  exit 0
fi
command id "$@"
EOF
  cat > "${fake_bin_dir}/launchctl" <<EOF
#!/usr/bin/env bash
if [[ "\${1:-}" == "print" ]]; then
  printf 'program = %s\n' "${bin_dir}/codexbar-display"
  exit 0
fi
exit 1
EOF
  chmod +x "${fake_bin_dir}/uname" "${fake_bin_dir}/pkgutil" "${fake_bin_dir}/id" "${fake_bin_dir}/launchctl"
}

write_installed_package_plist() {
  local plist bin
  plist="$1"
  bin="$2"
  cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.codexbar-display.companion-api</string>
    <key>ProgramArguments</key>
    <array>
      <string>${bin}</string>
      <string>api</string>
      <string>--addr</string>
      <string>127.0.0.1:47832</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
  </dict>
</plist>
EOF
}

run_installed_package_check() {
  local root output status
  root="$1"
  shift
  set +e
  output="$(
    PATH="${root}/fake-bin:${PATH}" \
      HOME="${root}/home" \
      VIBETV_READINESS_INSTALLED_BIN="${root}/Library/Application Support/VibeTV/bin/codexbar-display" \
      VIBETV_READINESS_INSTALLED_PLIST="${root}/Library/LaunchAgents/com.codexbar-display.companion-api.plist" \
      "$READINESS" \
        --installed-package \
        --expect-version 1.2.3 \
        "$@" \
        2>&1
  )"
  status=$?
  set -e
  printf '%s\n' "$output"
  return "$status"
}

run_expect_installed_package_success() {
  local root output
  root="${TMP_WORK_DIR}/installed-package-ok"
  write_installed_package_fixture "$root"

  output="$(run_installed_package_check "$root")" || {
    printf '%s\n' "$output" >&2
    die "expected installed package check to pass"
  }
  assert_contains "$output" "installed package ok: version 1.2.3"
  assert_contains "$output" "customer-readiness checks passed"
}

run_expect_installed_package_dev_origin_failure() {
  local root output status plist
  root="${TMP_WORK_DIR}/installed-package-dev-origin"
  write_installed_package_fixture "$root"
  plist="${root}/Library/LaunchAgents/com.codexbar-display.companion-api.plist"
  python3 - "$plist" <<'PY'
import plistlib
import sys

path = sys.argv[1]
with open(path, "rb") as f:
    payload = plistlib.load(f)
payload["ProgramArguments"].extend(["--dev-origin", "http://localhost:3000"])
with open(path, "wb") as f:
    plistlib.dump(payload, f)
PY

  set +e
  output="$(run_installed_package_check "$root")"
  status=$?
  set -e
  [[ "$status" -ne 0 ]] || die "expected installed package dev-origin check to fail"
  assert_contains "$output" "customer package LaunchAgent must use production origin only"
}

run_expect_installed_package_wrong_binary_failure() {
  local root output status plist
  root="${TMP_WORK_DIR}/installed-package-wrong-bin"
  write_installed_package_fixture "$root"
  plist="${root}/Library/LaunchAgents/com.codexbar-display.companion-api.plist"
  write_installed_package_plist "$plist" "${root}/home/Library/Application Support/codexbar-display/bin/codexbar-display"

  set +e
  output="$(run_installed_package_check "$root")"
  status=$?
  set -e
  [[ "$status" -ne 0 ]] || die "expected installed package wrong binary check to fail"
  assert_contains "$output" "installed LaunchAgent plist mismatch"
  assert_contains "$output" "ProgramArguments prefix"
}

run_expect_installed_package_legacy_plist_failure() {
  local root output status legacy
  root="${TMP_WORK_DIR}/installed-package-legacy-plist"
  write_installed_package_fixture "$root"
  legacy="${root}/home/Library/LaunchAgents/com.codexbar-display.companion-api.plist"
  printf '<plist version="1.0"><dict></dict></plist>\n' > "$legacy"

  set +e
  output="$(run_installed_package_check "$root")"
  status=$?
  set -e
  [[ "$status" -ne 0 ]] || die "expected installed package legacy plist check to fail"
  assert_contains "$output" "legacy script LaunchAgent still exists"
}

FAKE_CURL="${TMP_WORK_DIR}/fake-curl"
cat > "$FAKE_CURL" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

url="${@: -1}"
mode="${FAKE_CURL_MODE:-ok}"
headers_file=""
method="GET"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -D)
      headers_file="$2"
      shift 2
      ;;
    -X)
      method="$2"
      shift 2
      ;;
    -o)
      shift 2
      ;;
    -H)
      shift 2
      ;;
    -*)
      shift
      ;;
    *)
      shift
      ;;
  esac
done

case "$url" in
  http://127.0.0.1:47832/v1/status)
    if [[ "$method" == "OPTIONS" ]]; then
      [[ -n "$headers_file" ]] || {
        printf 'fake curl missing -D header target\n' >&2
        exit 22
      }
      {
        printf 'HTTP/1.1 204 No Content\r\n'
        printf 'Access-Control-Allow-Origin: https://app.vibetv.shop\r\n'
        if [[ "$mode" != "missing-pna-header" ]]; then
          printf 'Access-Control-Allow-Private-Network: true\r\n'
        fi
        printf '\r\n'
      } > "$headers_file"
      exit 0
    fi
    cat <<'JSON'
{
  "ok": true,
  "companion": {
    "version": "1.2.3",
    "features": {
      "themeInstallEnabled": false
    }
  }
}
JSON
    ;;
  https://app.example.test/api/companion/latest)
    if [[ "$mode" == "app-release-package-only" ]]; then
      cat <<'JSON'
{
  "status": "available",
  "latestVersion": "1.2.3",
  "packageDownloadUrls": {
    "macosArm64": "https://downloads.example.test/VibeTV-Companion-API-arm64-v1.2.3.pkg",
    "macosAmd64": "https://downloads.example.test/VibeTV-Companion-API-amd64-v1.2.3.pkg"
  }
}
JSON
      exit 0
    fi
    if [[ "$mode" == "app-release-missing-package" ]]; then
      cat <<'JSON'
{
  "status": "available",
  "latestVersion": "1.2.3",
  "installerDownloadUrl": "https://downloads.example.test/install-control-center-companion.sh",
  "packageDownloadUrls": {
    "macosArm64": "https://downloads.example.test/VibeTV-Companion-API-arm64-v1.2.3.pkg"
  }
}
JSON
      exit 0
    fi
    cat <<'JSON'
{
  "status": "available",
  "latestVersion": "1.2.3",
  "packageDownloadUrls": {
    "macosArm64": "https://downloads.example.test/VibeTV-Companion-API-arm64-v1.2.3.pkg",
    "macosAmd64": "https://downloads.example.test/VibeTV-Companion-API-amd64-v1.2.3.pkg"
  }
}
JSON
    ;;
  https://app.example.test|https://app.example.test/install/synthwave|https://app.example.test/install/clippy)
    exit 0
    ;;
  https://app.example.test/api/themes)
    if [[ "$mode" == "missing-free-pack-url" ]]; then
      cat <<'JSON'
{
  "source": "shopify",
  "themes": [
    {
      "themeId": "missing-pack",
      "source": "shopify",
      "isFree": true,
      "handle": "missing-pack-theme"
    }
  ]
}
JSON
      exit 0
    fi
    if [[ "$mode" == "invalid-free-pack-url" ]]; then
      cat <<'JSON'
{
  "source": "shopify",
  "themes": [
    {
      "themeId": "invalid-pack",
      "source": "shopify",
      "isFree": true,
      "packUrl": "file:///tmp/theme.vibetv-theme",
      "handle": "invalid-pack-theme"
    }
  ]
}
JSON
      exit 0
    fi
    cat <<'JSON'
{
  "source": "shopify",
  "themes": [
    {
      "themeId": "synthwave",
      "source": "shopify",
      "isFree": true,
      "packUrl": "https://cdn.example.test/synthwave.vibetv-theme",
      "productUrl": "https://vibetv.example.test/products/synthwave-theme"
    },
    {
      "themeId": "clippy",
      "source": "shopify",
      "isFree": true,
      "packUrl": "https://cdn.example.test/clippy.vibetv-theme",
      "handle": "clippy-theme"
    },
    {
      "themeId": "paid-theme",
      "source": "shopify",
      "isFree": false,
      "packUrl": "https://cdn.example.test/paid.vibetv-theme",
      "handle": "paid-theme"
    }
  ]
}
JSON
    ;;
  https://vibetv.example.test/products/synthwave-theme)
    cat <<'HTML'
<!doctype html>
<a href="https://app.example.test/install/synthwave">Kompatibilität prüfen</a>
HTML
    ;;
  https://vibetv.example.test/products/clippy-theme)
    cat <<'HTML'
<!doctype html>
<a href="https://app.example.test/install/clippy">In App öffnen</a>
HTML
    ;;
  https://vibetv.example.test/products/broken)
    cat <<'HTML'
<!doctype html>
<button>Check compatibility in the app</button>
HTML
    ;;
  *)
    printf 'unexpected fake curl URL: %s\n' "$url" >&2
    exit 22
    ;;
esac
EOF
chmod +x "$FAKE_CURL"

run_expect_success
run_expect_broken_product_page_failure
run_expect_local_url_guard_failure
run_expect_missing_free_pack_url_failure
run_expect_invalid_free_pack_url_failure
run_expect_release_assets_success
run_expect_release_package_only_success
run_expect_release_missing_package_failure
run_expect_app_release_package_only_success
run_expect_app_release_missing_package_failure
run_expect_local_companion_success
run_expect_local_companion_pna_failure
run_expect_installed_package_success
run_expect_installed_package_dev_origin_failure
run_expect_installed_package_wrong_binary_failure
run_expect_installed_package_legacy_plist_failure

printf 'customer-readiness checker tests passed\n'
