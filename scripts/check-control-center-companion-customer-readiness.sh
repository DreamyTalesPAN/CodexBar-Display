#!/usr/bin/env bash
set -euo pipefail

REPO="DreamyTalesPAN/CodexBar-Display"
GITHUB_API_BASE="${CONTROL_CENTER_GITHUB_API_BASE:-https://api.github.com}"
CURL_BIN="${CONTROL_CENTER_READINESS_CURL:-curl}"
PKG_IDENTIFIER="${VIBETV_READINESS_PKG_IDENTIFIER:-shop.vibetv.companion-api}"
SERVICE_LABEL="${VIBETV_READINESS_SERVICE_LABEL:-com.codexbar-display.companion-api}"
INSTALLED_BIN="${VIBETV_READINESS_INSTALLED_BIN:-/Library/Application Support/VibeTV/bin/codexbar-display}"
INSTALLED_PLIST="${VIBETV_READINESS_INSTALLED_PLIST:-/Library/LaunchAgents/${SERVICE_LABEL}.plist}"
LEGACY_USER_PLIST="${VIBETV_READINESS_LEGACY_USER_PLIST:-${HOME}/Library/LaunchAgents/${SERVICE_LABEL}.plist}"
HOSTED_APP_ORIGIN="https://app.vibetv.shop"
EXPECTED_COMPANION_ADDR="${VIBETV_COMPANION_ADDR:-127.0.0.1:47832}"
SHOPIFY_APP_URL="$HOSTED_APP_ORIGIN"
SHOPIFY_STORE_URL="https://vibetv.shop"
RELEASE_TAG=""
RELEASE_JSON=""
PKG_PATH=""
APP_URL=""
EXPECT_VERSION=""
EXPECT_CATALOG_SOURCE=""
EXPECT_THEME_ID=""
EXPECT_ALL_FREE_THEMES_INSTALLABLE=0
EXPECT_SHOPIFY_PRODUCT_PAGES=0
CHECK_LOCAL=0
CHECK_INSTALLED_PACKAGE=0
REQUIRE_SIGNED=0
REQUIRE_NOTARIZED=0
GITHUB_RELEASE_HEADERS=()
SHOPIFY_PRODUCT_PAGES=()
TMP_WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-readiness.XXXXXX")"

cleanup() {
  rm -rf "$TMP_WORK_DIR"
}

trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

usage() {
  cat <<'EOF'
Usage:
  check-control-center-companion-customer-readiness.sh [options]

Read-only checks for the hosted Control Center customer Companion path.

Options:
  --repo owner/name                 GitHub repo. Default: DreamyTalesPAN/CodexBar-Display
  --release v1.2.3                 Check expected macOS package release asset names.
  --release-json path              Use a local GitHub release JSON fixture instead of GitHub API.
  --pkg path/to/package.pkg         Inspect a macOS Companion .pkg payload.
  --require-signed                 Fail if the package is not signed.
  --require-notarized              Fail if the package is not notarized/stapled.
  --app-url https://app.vibetv.shop Check hosted app HTTP reachability. With --release/--release-json, also check /api/companion/latest package links.
  --expect-catalog-source source     With --app-url, require /api/themes source, for example shopify.
  --expect-theme-id theme_id         With --app-url, require /api/themes to contain an installable free theme and /install/theme_id to be reachable.
  --expect-all-free-themes-installable
                                   With --app-url, require every free /api/themes item to have an installable packUrl.
  --expect-shopify-product-pages   With --app-url, verify every free Shopify /api/themes productUrl, or derive it from handle plus --shopify-store-url.
  --shopify-app-url https://app.vibetv.shop
                                   Expected hosted app origin for Shopify product buttons. Default: https://app.vibetv.shop.
  --shopify-store-url https://vibetv.shop
                                   Public Shopify store origin used to derive product URLs from /api/themes handles. Default: https://vibetv.shop.
  --shopify-product-page url theme_id
                                   Check a public Shopify product page links to /install/theme_id and no longer exposes the legacy terminal command. Repeatable.
  --installed-package              Check installed macOS package receipt, files, and LaunchAgent.
  --local-companion                Check local Companion status on VIBETV_COMPANION_ADDR, default 127.0.0.1:47832.
  --expect-version x.y.z           Require package, installed, and local Companion version where checked.
  -h, --help                       Show this help.

Examples:
  scripts/check-control-center-companion-customer-readiness.sh \
    --release v1.0.32 \
    --pkg dist/companion-pkg/VibeTV-Companion-API-arm64-v1.0.32.pkg \
    --require-signed \
    --require-notarized \
    --app-url https://app.vibetv.shop

  scripts/check-control-center-companion-customer-readiness.sh --local-companion

  scripts/check-control-center-companion-customer-readiness.sh \
    --installed-package \
    --local-companion \
    --expect-version 1.0.32

  scripts/check-control-center-companion-customer-readiness.sh \
    --app-url https://app.vibetv.shop \
    --expect-catalog-source shopify \
    --expect-theme-id my-theme-id \
    --expect-all-free-themes-installable \
    --expect-shopify-product-pages

  scripts/check-control-center-companion-customer-readiness.sh \
    --shopify-product-page https://vibetv.shop/products/synthwave-theme synthwave \
    --shopify-product-page https://vibetv.shop/products/clippy-theme clippy

This script does not install packages, start services, discover devices, or perform
hardware writes. It is safe for preflight and customer-readiness audits.
EOF
}

log() {
  printf 'check: %s\n' "$*"
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required"
}

require_curl() {
  if [[ "$CURL_BIN" == */* ]]; then
    [[ -x "$CURL_BIN" ]] || die "${CURL_BIN} is required"
    return
  fi
  require_cmd "$CURL_BIN"
}

curl_cmd() {
  "$CURL_BIN" "$@"
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help)
        usage
        exit 0
        ;;
      --repo)
        [[ $# -ge 2 ]] || die "--repo requires a value"
        REPO="$2"
        shift 2
        ;;
      --repo=*)
        REPO="${1#*=}"
        shift
        ;;
      --release)
        [[ $# -ge 2 ]] || die "--release requires a value"
        RELEASE_TAG="$2"
        shift 2
        ;;
      --release=*)
        RELEASE_TAG="${1#*=}"
        shift
        ;;
      --release-json)
        [[ $# -ge 2 ]] || die "--release-json requires a value"
        RELEASE_JSON="$2"
        shift 2
        ;;
      --release-json=*)
        RELEASE_JSON="${1#*=}"
        shift
        ;;
      --pkg)
        [[ $# -ge 2 ]] || die "--pkg requires a value"
        [[ -n "$2" ]] || die "--pkg requires a non-empty value"
        PKG_PATH="$2"
        shift 2
        ;;
      --pkg=*)
        PKG_PATH="${1#*=}"
        [[ -n "$PKG_PATH" ]] || die "--pkg requires a non-empty value"
        shift
        ;;
      --require-signed)
        REQUIRE_SIGNED=1
        shift
        ;;
      --require-notarized)
        REQUIRE_NOTARIZED=1
        shift
        ;;
      --app-url)
        [[ $# -ge 2 ]] || die "--app-url requires a value"
        APP_URL="$2"
        shift 2
        ;;
      --app-url=*)
        APP_URL="${1#*=}"
        shift
        ;;
      --expect-catalog-source)
        [[ $# -ge 2 ]] || die "--expect-catalog-source requires a value"
        EXPECT_CATALOG_SOURCE="$2"
        shift 2
        ;;
      --expect-catalog-source=*)
        EXPECT_CATALOG_SOURCE="${1#*=}"
        shift
        ;;
      --expect-theme-id)
        [[ $# -ge 2 ]] || die "--expect-theme-id requires a value"
        EXPECT_THEME_ID="$2"
        shift 2
        ;;
      --expect-theme-id=*)
        EXPECT_THEME_ID="${1#*=}"
        shift
        ;;
      --expect-all-free-themes-installable)
        EXPECT_ALL_FREE_THEMES_INSTALLABLE=1
        shift
        ;;
      --expect-shopify-product-pages)
        EXPECT_SHOPIFY_PRODUCT_PAGES=1
        shift
        ;;
      --shopify-app-url)
        [[ $# -ge 2 ]] || die "--shopify-app-url requires a value"
        SHOPIFY_APP_URL="$2"
        shift 2
        ;;
      --shopify-app-url=*)
        SHOPIFY_APP_URL="${1#*=}"
        shift
        ;;
      --shopify-store-url)
        [[ $# -ge 2 ]] || die "--shopify-store-url requires a value"
        SHOPIFY_STORE_URL="$2"
        shift 2
        ;;
      --shopify-store-url=*)
        SHOPIFY_STORE_URL="${1#*=}"
        shift
        ;;
      --shopify-product-page)
        [[ $# -ge 3 ]] || die "--shopify-product-page requires a URL and theme_id"
        [[ -n "$2" && -n "$3" ]] || die "--shopify-product-page requires non-empty URL and theme_id"
        SHOPIFY_PRODUCT_PAGES+=("$2|$3")
        shift 3
        ;;
      --shopify-product-page=*)
        parse_shopify_product_page_arg "${1#*=}"
        shift
        ;;
      --installed-package)
        CHECK_INSTALLED_PACKAGE=1
        shift
        ;;
      --local-companion)
        CHECK_LOCAL=1
        shift
        ;;
      --expect-version)
        [[ $# -ge 2 ]] || die "--expect-version requires a value"
        EXPECT_VERSION="${2#v}"
        shift 2
        ;;
      --expect-version=*)
        EXPECT_VERSION="${1#*=}"
        EXPECT_VERSION="${EXPECT_VERSION#v}"
        shift
        ;;
      *)
        die "unknown argument: $1"
        ;;
    esac
  done
}

parse_shopify_product_page_arg() {
  local value url theme_id
  value="$1"
  url="${value%,*}"
  theme_id="${value##*,}"
  [[ "$url" != "$value" && -n "$url" && -n "$theme_id" ]] \
    || die "--shopify-product-page= requires URL,theme_id"
  SHOPIFY_PRODUCT_PAGES+=("$url|$theme_id")
}

validate_http_url() {
  local raw label public_only
  raw="$1"
  label="$2"
  public_only="${3:-0}"
  python3 - "$raw" "$label" "$public_only" <<'PY'
import ipaddress
import sys
from urllib.parse import urlparse

raw, label, public_only = sys.argv[1], sys.argv[2], sys.argv[3] == "1"
parsed = urlparse(raw)
errors = []

if parsed.scheme not in ("http", "https"):
    errors.append("must use http(s)")
if not parsed.hostname:
    errors.append("must include a host")
if parsed.username or parsed.password:
    errors.append("must not include credentials")
if public_only and parsed.hostname:
    host = parsed.hostname.lower()
    if host == "localhost" or host.endswith(".local"):
        errors.append("must be a public product page, not localhost or .local")
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        ip = None
    if ip and (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_unspecified):
        errors.append("must not point to a private, loopback, link-local, or unspecified IP")

if errors:
    print(f"{label} URL invalid: " + "; ".join(errors), file=sys.stderr)
    sys.exit(1)
PY
}

release_json_path() {
  local out
  if [[ -n "$RELEASE_JSON" ]]; then
    [[ -f "$RELEASE_JSON" ]] || die "release JSON does not exist: $RELEASE_JSON"
    printf '%s\n' "$RELEASE_JSON"
    return
  fi

  [[ -n "$RELEASE_TAG" ]] || die "--release or --release-json is required for release checks"
  require_curl
  out="$(mktemp "${TMP_WORK_DIR}/release.XXXXXX")"
  curl_cmd -fsSL "${GITHUB_RELEASE_HEADERS[@]}" \
    "${GITHUB_API_BASE%/}/repos/${REPO}/releases/tags/${RELEASE_TAG}" \
    > "$out"
  printf '%s\n' "$out"
}

github_release_headers() {
  local token
  token="${CONTROL_CENTER_GITHUB_TOKEN:-${GITHUB_TOKEN:-}}"
  GITHUB_RELEASE_HEADERS=(
    -H "Accept: application/vnd.github+json"
    -H "X-GitHub-Api-Version: 2022-11-28"
  )
  if [[ -n "$token" ]]; then
    GITHUB_RELEASE_HEADERS+=(-H "Authorization: Bearer ${token}")
  fi
}

check_release_assets() {
  local json version
  [[ -n "$RELEASE_TAG" || -n "$RELEASE_JSON" ]] || return 0

  require_cmd python3
  json="$(release_json_path)"
  version="${RELEASE_TAG#v}"
  if [[ -z "$version" ]]; then
    version="$(python3 - "$json" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)
print(str(data.get("tag_name", "")).lstrip("v"))
PY
)"
  fi

  [[ -n "$version" ]] || die "could not determine release version"
  python3 - "$json" "$version" <<'PY'
import json
import sys

path, version = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as f:
    data = json.load(f)

assets = {asset.get("name") for asset in data.get("assets", [])}
expected_packages = {
    f"VibeTV-Companion-API-arm64-v{version}.pkg",
    f"VibeTV-Companion-API-amd64-v{version}.pkg",
}
missing = sorted(expected_packages - assets)
if missing:
    print("missing release package assets:", ", ".join(missing), file=sys.stderr)
    sys.exit(1)

if "install-control-center-companion.sh" in assets:
    print(f"release assets ok for v{version}; support script available")
else:
    print(f"release assets ok for v{version}; support script omitted")
PY
}

check_package() {
  local expanded expanded_root package_expected_version signature_output
  [[ -n "$PKG_PATH" ]] || return 0

  [[ "$(uname -s)" == "Darwin" ]] || die "--pkg checks currently require macOS"
  require_cmd pkgutil
  require_cmd python3
  [[ -f "$PKG_PATH" ]] || die "package does not exist: $PKG_PATH"

  package_expected_version="$EXPECT_VERSION"
  if [[ -z "$package_expected_version" && ( -n "$RELEASE_TAG" || -n "$RELEASE_JSON" ) ]]; then
    package_expected_version="$(expected_release_version)"
  fi

  expanded_root="$(mktemp -d "${TMP_WORK_DIR}/pkg-expanded.XXXXXX")"
  expanded="${expanded_root}/expanded"
  pkgutil --expand-full "$PKG_PATH" "$expanded"
  test -f "${expanded}/PackageInfo" \
    || die "package metadata missing PackageInfo"
  test -x "${expanded}/Payload/Library/Application Support/VibeTV/bin/codexbar-display" \
    || die "package payload missing Companion binary"
  test -f "${expanded}/Payload/Library/LaunchAgents/com.codexbar-display.companion-api.plist" \
    || die "package payload missing LaunchAgent plist"
  test -x "${expanded}/Scripts/preinstall" \
    || die "package scripts missing executable preinstall migration hook"
  test -x "${expanded}/Scripts/postinstall" \
    || die "package scripts missing executable postinstall launch hook"
  check_package_install_hooks "$expanded"
  if find "${expanded}/Payload" -name '._*' | grep -q .; then
    die "package payload contains AppleDouble files"
  fi
  check_package_binary_arch "${expanded}/Payload/Library/Application Support/VibeTV/bin/codexbar-display" "$PKG_PATH"
  python3 - "$expanded" "$PKG_IDENTIFIER" "$package_expected_version" "$SERVICE_LABEL" "$INSTALLED_BIN" "$EXPECTED_COMPANION_ADDR" <<'PY'
import plistlib
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

expanded, expected_identifier, expected_version, expected_label, expected_bin, expected_addr = sys.argv[1:]
root = Path(expanded)
errors = []

package_info = root / "PackageInfo"
try:
    package = ET.parse(package_info).getroot()
except Exception as exc:
    errors.append(f"PackageInfo is not readable XML: {exc}")
else:
    identifier = package.attrib.get("identifier", "")
    version = package.attrib.get("version", "")
    install_location = package.attrib.get("install-location", "")
    if identifier != expected_identifier:
        errors.append(f"PackageInfo identifier={identifier!r}, expected {expected_identifier!r}")
    if not version:
        errors.append("PackageInfo version missing")
    elif expected_version and version != expected_version:
        errors.append(f"PackageInfo version={version!r}, expected {expected_version!r}")
    if install_location != "/":
        errors.append(f"PackageInfo install-location={install_location!r}, expected '/'")

plist_path = root / "Payload" / "Library" / "LaunchAgents" / f"{expected_label}.plist"
try:
    with plist_path.open("rb") as f:
        plist = plistlib.load(f)
except Exception as exc:
    errors.append(f"LaunchAgent plist is not readable: {exc}")
else:
    args = plist.get("ProgramArguments")
    expected_args = [expected_bin, "api", "--addr", expected_addr]
    if plist.get("Label") != expected_label:
        errors.append(f"LaunchAgent Label={plist.get('Label')!r}, expected {expected_label!r}")
    if not isinstance(args, list):
        errors.append("LaunchAgent ProgramArguments missing")
    elif args[:4] != expected_args:
        errors.append(f"LaunchAgent ProgramArguments prefix={args[:4]!r}, expected {expected_args!r}")
    elif "--dev-origin" in args:
        errors.append("LaunchAgent contains --dev-origin; customer packages must not use a development origin")
    if plist.get("RunAtLoad") is not True:
        errors.append("LaunchAgent RunAtLoad is not true")
    if plist.get("KeepAlive") is not True:
        errors.append("LaunchAgent KeepAlive is not true")

if errors:
    print("package metadata mismatch: " + "; ".join(errors), file=sys.stderr)
    sys.exit(1)
PY
  rm -rf "$expanded_root"
  log "package metadata, payload and install scripts ok"

  if [[ "$REQUIRE_SIGNED" == 1 ]]; then
    signature_output="$(pkgutil --check-signature "$PKG_PATH" 2>&1 || true)"
    printf '%s\n' "$signature_output" | grep -q "Developer ID Installer" \
      || die "package is not signed with Developer ID Installer"
    log "package signature ok"
  fi

  if [[ "$REQUIRE_NOTARIZED" == 1 ]]; then
    require_cmd xcrun
    xcrun stapler validate "$PKG_PATH" >/dev/null
    log "package notarization staple ok"
  fi
}

check_package_install_hooks() {
  local expanded
  expanded="$1"

  python3 - "$expanded" "$SERVICE_LABEL" <<'PY'
import sys
from pathlib import Path

expanded, service_label = sys.argv[1:]
scripts = Path(expanded) / "Scripts"
preinstall = (scripts / "preinstall").read_text(encoding="utf-8")
postinstall = (scripts / "postinstall").read_text(encoding="utf-8")

checks = [
    ("preinstall", preinstall, "launchctl bootout", "unload an existing user LaunchAgent before package install"),
    ("preinstall", preinstall, "NFSHomeDirectory", "resolve the console user's home directory"),
    ("preinstall", preinstall, "Library/LaunchAgents/${label}.plist", "find the legacy user LaunchAgent plist"),
    ("preinstall", preinstall, "rm -f \"$legacy_plist\"", "remove the legacy user LaunchAgent plist"),
    ("postinstall", postinstall, "launchctl bootout", "unload any already-loaded LaunchAgent before repair/restart"),
    ("postinstall", postinstall, "NFSHomeDirectory", "resolve the console user's home directory"),
    ("postinstall", postinstall, "Library/LaunchAgents/${label}.plist", "find the legacy user LaunchAgent plist"),
    ("postinstall", postinstall, "rm -f \"$legacy_plist\"", "remove the legacy user LaunchAgent plist"),
    ("postinstall", postinstall, 'launchctl bootstrap "gui/${uid}" "$plist"', "load the package LaunchAgent plist"),
    ("postinstall", postinstall, 'launchctl enable "gui/${uid}/${label}"', "enable the package LaunchAgent"),
    ("postinstall", postinstall, 'launchctl kickstart -k "gui/${uid}/${label}"', "start the package LaunchAgent"),
]

errors = [
    f"{name} does not {reason}"
    for name, content, needle, reason in checks
    if needle not in content
]
for name, content in (("preinstall", preinstall), ("postinstall", postinstall)):
    if service_label not in content:
        errors.append(f"{name} does not reference {service_label}")

if errors:
    print("package install hook mismatch: " + "; ".join(errors), file=sys.stderr)
    sys.exit(1)
PY
}

expected_package_arch() {
  local name
  name="$(basename "$1")"
  case "$name" in
    *-arm64-v*.pkg)
      printf '%s\n' "arm64"
      ;;
    *-amd64-v*.pkg)
      printf '%s\n' "amd64"
      ;;
  esac
}

check_package_binary_arch() {
  local binary_path pkg_path expected_arch file_output expected_pattern
  binary_path="$1"
  pkg_path="$2"
  expected_arch="$(expected_package_arch "$pkg_path")"
  [[ -n "$expected_arch" ]] || return 0

  require_cmd file
  file_output="$(file "$binary_path")"
  case "$expected_arch" in
    arm64)
      expected_pattern='arm64'
      ;;
    amd64)
      expected_pattern='x86_64|amd64'
      ;;
    *)
      return 0
      ;;
  esac
  printf '%s\n' "$file_output" | grep -Eiq "Mach-O.*(${expected_pattern})" \
    || die "package binary architecture mismatch for ${expected_arch}: ${file_output}"
  log "package binary architecture ok: ${expected_arch}"
}

check_app_url() {
  [[ -n "$APP_URL" ]] || return 0
  require_curl
  curl_cmd -fsSIL "$APP_URL" >/dev/null
  log "app reachable: $APP_URL"
}

check_app_release_endpoint() {
  local app response_json version
  [[ -n "$APP_URL" ]] || return 0
  [[ -n "$RELEASE_TAG" || -n "$RELEASE_JSON" ]] || return 0

  require_curl
  require_cmd python3
  version="$(expected_release_version)"
  app="${APP_URL%/}"
  response_json="$(mktemp "${TMP_WORK_DIR}/app-release.XXXXXX")"
  curl_cmd -fsS "${app}/api/companion/latest" > "$response_json"
  python3 - "$version" "$response_json" <<'PY'
import json
import posixpath
import sys
from urllib.parse import urlparse

version, response_path = sys.argv[1], sys.argv[2]
with open(response_path, encoding="utf-8") as f:
    payload = json.load(f)

expected_package_assets = {
    "packageDownloadUrls.macosArm64": f"VibeTV-Companion-API-arm64-v{version}.pkg",
    "packageDownloadUrls.macosAmd64": f"VibeTV-Companion-API-amd64-v{version}.pkg",
}


def get_path(root, dotted):
    current = root
    for part in dotted.split("."):
        if not isinstance(current, dict):
            return ""
        current = current.get(part)
    return current if isinstance(current, str) else ""


def asset_name(url):
    path = urlparse(url).path
    return posixpath.basename(path)


errors = []
if payload.get("status") != "available":
    errors.append(f"status={payload.get('status')!r}")
if payload.get("latestVersion") != version:
    errors.append(f"latestVersion={payload.get('latestVersion')!r}")

for field, expected in expected_package_assets.items():
    url = get_path(payload, field)
    if not url:
        errors.append(f"{field} missing")
        continue
    if asset_name(url) != expected:
        errors.append(f"{field} points to {asset_name(url)!r}, expected {expected!r}")

installer_url = get_path(payload, "installerDownloadUrl")
if installer_url:
    errors.append("installerDownloadUrl must stay hidden from the customer API")

if errors:
    print("hosted app Companion release API mismatch:", "; ".join(errors), file=sys.stderr)
    sys.exit(1)

print(f"hosted app Companion release API ok for v{version}")
PY
}

check_app_theme_catalog() {
  local app response_json
  [[ -n "$EXPECT_CATALOG_SOURCE" || -n "$EXPECT_THEME_ID" || "$EXPECT_ALL_FREE_THEMES_INSTALLABLE" == 1 ]] || return 0
  [[ -n "$APP_URL" ]] || die "--expect-catalog-source/--expect-theme-id/--expect-all-free-themes-installable require --app-url"

  require_curl
  require_cmd python3
  app="${APP_URL%/}"
  response_json="$(mktemp "${TMP_WORK_DIR}/app-themes.XXXXXX")"
  curl_cmd -fsS "${app}/api/themes" > "$response_json"
  python3 - "$response_json" "$EXPECT_CATALOG_SOURCE" "$EXPECT_THEME_ID" "$EXPECT_ALL_FREE_THEMES_INSTALLABLE" <<'PY'
import json
import sys
from urllib.parse import urlparse

path, expected_source, expected_theme_id, expect_all_free = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] == "1"
with open(path, encoding="utf-8") as f:
    payload = json.load(f)

def valid_download_url(raw):
    parsed = urlparse(raw)
    return parsed.scheme in ("http", "https") and bool(parsed.netloc) and not parsed.username and not parsed.password

def check_installable_theme(theme, label):
    local_errors = []
    if not theme.get("isFree"):
        local_errors.append(f"{label} is not free")
    pack_url = str(theme.get("packUrl") or "").strip()
    if not pack_url:
        local_errors.append(f"{label} packUrl missing")
    elif not valid_download_url(pack_url):
        local_errors.append(f"{label} packUrl is not an http(s) URL")
    return local_errors

errors = []
source = payload.get("source")
if expected_source and source != expected_source:
    errors.append(f"source={source!r}, expected {expected_source!r}")

themes = payload.get("themes")
if not isinstance(themes, list) or not themes:
    errors.append("themes empty")
    themes = []

if expected_theme_id:
    theme = next((item for item in themes if item.get("themeId") == expected_theme_id), None)
    if not theme:
        errors.append(f"themeId {expected_theme_id!r} missing")
    else:
        errors.extend(check_installable_theme(theme, f"themeId {expected_theme_id!r}"))

if expect_all_free:
    free_themes = [item for item in themes if item.get("isFree")]
    if not free_themes:
        errors.append("free themes empty")
    for index, theme in enumerate(free_themes):
        theme_id = str(theme.get("themeId") or theme.get("id") or f"index {index}").strip()
        if not str(theme.get("themeId") or "").strip():
            errors.append(f"free theme {theme_id!r} themeId missing")
        errors.extend(check_installable_theme(theme, f"free theme {theme_id!r}"))

if errors:
    print("hosted app theme catalog mismatch:", "; ".join(errors), file=sys.stderr)
    sys.exit(1)

detail = f" source={source}" if source else ""
if expect_all_free:
    detail = f"{detail} allFreeThemes={len([item for item in themes if item.get('isFree')])}"
if expected_theme_id:
    print(f"hosted app theme catalog ok:{detail} themeId={expected_theme_id}")
else:
    print(f"hosted app theme catalog ok:{detail}")
PY
}

urlencode_path_segment() {
  require_cmd python3
  python3 - "$1" <<'PY'
import sys
from urllib.parse import quote

value = sys.argv[1].strip()
if not value:
    print("theme id cannot be empty", file=sys.stderr)
    sys.exit(1)
print(quote(value, safe=""))
PY
}

check_app_install_route() {
  local app encoded_theme_id install_url
  [[ -n "$EXPECT_THEME_ID" ]] || return 0
  [[ -n "$APP_URL" ]] || die "--expect-theme-id requires --app-url"

  require_curl
  app="${APP_URL%/}"
  encoded_theme_id="$(urlencode_path_segment "$EXPECT_THEME_ID")"
  install_url="${app}/install/${encoded_theme_id}"
  curl_cmd -fsSIL "$install_url" >/dev/null
  log "app install route reachable: ${install_url}"
}

check_app_install_routes_for_free_themes() {
  local app response_json theme_ids theme_id encoded_theme_id install_url count
  [[ "$EXPECT_ALL_FREE_THEMES_INSTALLABLE" == 1 ]] || return 0
  [[ -n "$APP_URL" ]] || die "--expect-all-free-themes-installable requires --app-url"

  require_curl
  require_cmd python3
  app="${APP_URL%/}"
  response_json="$(mktemp "${TMP_WORK_DIR}/app-free-install-routes.XXXXXX")"
  theme_ids="$(mktemp "${TMP_WORK_DIR}/app-free-theme-ids.XXXXXX")"
  curl_cmd -fsS "${app}/api/themes" > "$response_json"
  python3 - "$response_json" > "$theme_ids" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    payload = json.load(f)

errors = []
for index, theme in enumerate(payload.get("themes") or []):
    if not theme.get("isFree"):
        continue
    theme_id = str(theme.get("themeId") or "").strip()
    if not theme_id:
        errors.append(f"free theme at index {index} has no themeId")
        continue
    print(theme_id)

if errors:
    print("hosted app free theme install route mismatch: " + "; ".join(errors), file=sys.stderr)
    sys.exit(1)
PY

  count=0
  while IFS= read -r theme_id; do
    [[ -n "$theme_id" ]] || continue
    encoded_theme_id="$(urlencode_path_segment "$theme_id")"
    install_url="${app}/install/${encoded_theme_id}"
    curl_cmd -fsSIL "$install_url" >/dev/null
    count=$((count + 1))
  done < "$theme_ids"
  [[ "$count" -gt 0 ]] || die "free theme install routes empty"
  log "app install routes reachable for all free themes: ${count}"
}

check_shopify_product_pages() {
  local entry url theme_id page_count
  [[ "${#SHOPIFY_PRODUCT_PAGES[@]}" -gt 0 ]] || return 0

  require_curl
  require_cmd python3
  validate_http_url "$SHOPIFY_APP_URL" "--shopify-app-url"
  page_count=0
  for entry in "${SHOPIFY_PRODUCT_PAGES[@]}"; do
    url="${entry%%|*}"
    theme_id="${entry#*|}"
    [[ -n "$url" && -n "$theme_id" && "$url" != "$theme_id" ]] \
      || die "invalid Shopify product page check: ${entry}"
    check_shopify_product_page "$url" "$theme_id" "--shopify-product-page"
    page_count=$((page_count + 1))
  done
  log "Shopify product page checks passed: ${page_count}"
}

check_app_shopify_product_pages() {
  local app response_json product_pages entry url theme_id page_count
  [[ "$EXPECT_SHOPIFY_PRODUCT_PAGES" == 1 ]] || return 0
  [[ -n "$APP_URL" ]] || die "--expect-shopify-product-pages requires --app-url"

  require_curl
  require_cmd python3
  validate_http_url "$SHOPIFY_APP_URL" "--shopify-app-url"
  validate_http_url "$SHOPIFY_STORE_URL" "--shopify-store-url" 1
  app="${APP_URL%/}"
  response_json="$(mktemp "${TMP_WORK_DIR}/app-shopify-product-pages.XXXXXX")"
  product_pages="$(mktemp "${TMP_WORK_DIR}/app-shopify-product-page-list.XXXXXX")"
  curl_cmd -fsS "${app}/api/themes" > "$response_json"
  python3 - "$response_json" "$SHOPIFY_STORE_URL" > "$product_pages" <<'PY'
import json
import sys
from urllib.parse import quote
from urllib.parse import urljoin

path, store_url = sys.argv[1], sys.argv[2].rstrip("/") + "/"
with open(path, encoding="utf-8") as f:
    payload = json.load(f)

errors = []
count = 0
for index, theme in enumerate(payload.get("themes") or []):
    if not theme.get("isFree") or theme.get("source") != "shopify":
        continue
    theme_id = str(theme.get("themeId") or "").strip()
    product_url = str(theme.get("productUrl") or "").strip()
    handle = str(theme.get("handle") or "").strip()
    label = theme_id or f"index {index}"
    if not theme_id:
        errors.append(f"free Shopify theme at index {index} has no themeId")
        continue
    if not product_url:
        if handle:
            product_url = urljoin(store_url, "products/" + quote(handle, safe=""))
        else:
            errors.append(f"free Shopify theme {label!r} has no productUrl or handle")
            continue
    print(f"{product_url}|{theme_id}")
    count += 1

if count == 0:
    errors.append("free Shopify product pages empty")

if errors:
    print("hosted app Shopify product page catalog mismatch: " + "; ".join(errors), file=sys.stderr)
    sys.exit(1)
PY

  page_count=0
  while IFS= read -r entry; do
    [[ -n "$entry" ]] || continue
    url="${entry%%|*}"
    theme_id="${entry#*|}"
    check_shopify_product_page "$url" "$theme_id" "catalog productUrl"
    page_count=$((page_count + 1))
  done < "$product_pages"
  log "app Shopify product pages reachable and ready: ${page_count}"
}

check_shopify_product_page() {
  local url theme_id label html
  url="$1"
  theme_id="$2"
  label="$3"
  validate_http_url "$url" "$label" 1

  html="$(mktemp "${TMP_WORK_DIR}/shopify-product.XXXXXX")"
  curl_cmd -fsSL "$url" > "$html"
  python3 - "$html" "$url" "$theme_id" "$SHOPIFY_APP_URL" <<'PY'
import sys
from urllib.parse import quote

html_path, product_url, theme_id, app_url = sys.argv[1:]
with open(html_path, encoding="utf-8", errors="replace") as f:
    html = f.read()

expected = f"{app_url.rstrip('/')}/install/{quote(theme_id, safe='')}"
allowed_readiness_copy = [
    "Check compatibility in the app",
    "Kompatibilität prüfen",
    "In App öffnen",
    "In der App öffnen",
    "Bereitschaft prüfen",
]
forbidden = [
    "codexbar-display theme-pack install",
    "theme-pack install --theme",
    "theme-pack install --target",
    "install.sh | bash",
    "http://vibetv.local",
    "Jetzt installieren",
    "Jetzt Theme installieren",
    "Install now",
    "One-click install",
    "One click install",
]

errors = []
if expected not in html:
    errors.append(f"missing hosted app link {expected}")
if not any(copy in html for copy in allowed_readiness_copy):
    errors.append(
        "missing gated readiness button copy; expected one of: "
        + ", ".join(allowed_readiness_copy)
    )
for needle in forbidden:
    if needle in html:
        errors.append(f"legacy customer copy still present: {needle}")

if errors:
    print(
        "Shopify product page mismatch for "
        + product_url
        + ": "
        + "; ".join(errors),
        file=sys.stderr,
    )
    sys.exit(1)
PY
  log "Shopify product page ok: ${url} -> ${theme_id}"
}

expected_release_version() {
  local json version
  version="${RELEASE_TAG#v}"
  if [[ -n "$version" ]]; then
    printf '%s\n' "$version"
    return
  fi

  json="$(release_json_path)"
  python3 - "$json" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)
print(str(data.get("tag_name", "")).lstrip("v"))
PY
}

check_installed_package() {
  local info receipt_version service service_info
  [[ "$CHECK_INSTALLED_PACKAGE" == 1 ]] || return 0

  [[ "$(uname -s)" == "Darwin" ]] || die "--installed-package checks require macOS"
  require_cmd pkgutil
  require_cmd launchctl
  require_cmd awk
  require_cmd id
  require_cmd python3

  info="$(pkgutil --pkg-info "$PKG_IDENTIFIER" 2>/dev/null || true)"
  [[ -n "$info" ]] || die "package receipt not found: $PKG_IDENTIFIER"
  receipt_version="$(printf '%s\n' "$info" | awk -F': ' '$1 == "version" {print $2; exit}')"
  [[ -n "$receipt_version" ]] || die "package receipt did not report a version"
  if [[ -n "$EXPECT_VERSION" && "$receipt_version" != "$EXPECT_VERSION" ]]; then
    die "expected package receipt version $EXPECT_VERSION, got $receipt_version"
  fi

  [[ -x "$INSTALLED_BIN" ]] || die "installed Companion binary is missing or not executable: $INSTALLED_BIN"
  [[ -f "$INSTALLED_PLIST" ]] || die "installed LaunchAgent plist is missing: $INSTALLED_PLIST"
  check_installed_package_plist
  [[ ! -f "$LEGACY_USER_PLIST" ]] \
    || die "legacy script LaunchAgent still exists and can conflict with the package LaunchAgent: $LEGACY_USER_PLIST"

  service="gui/$(id -u)/${SERVICE_LABEL}"
  service_info="$(launchctl print "$service" 2>/dev/null || true)"
  [[ -n "$service_info" ]] || die "LaunchAgent is not loaded for current user: $service"
  printf '%s\n' "$service_info" | grep -F "$INSTALLED_BIN" >/dev/null \
    || die "loaded LaunchAgent does not point to package binary: $INSTALLED_BIN"
  log "installed package ok: version ${receipt_version}"
}

check_installed_package_plist() {
  python3 - "$INSTALLED_PLIST" "$SERVICE_LABEL" "$INSTALLED_BIN" "$EXPECTED_COMPANION_ADDR" <<'PY'
import plistlib
import sys
from pathlib import Path

plist_path, expected_label, expected_bin, expected_addr = sys.argv[1:]
errors = []

try:
    with Path(plist_path).open("rb") as f:
        plist = plistlib.load(f)
except Exception as exc:
    print(f"installed LaunchAgent plist is not readable: {exc}", file=sys.stderr)
    sys.exit(1)

args = plist.get("ProgramArguments")
expected_args = [expected_bin, "api", "--addr", expected_addr]
if plist.get("Label") != expected_label:
    errors.append(f"Label={plist.get('Label')!r}, expected {expected_label!r}")
if not isinstance(args, list):
    errors.append("ProgramArguments missing")
elif args[:4] != expected_args:
    errors.append(f"ProgramArguments prefix={args[:4]!r}, expected {expected_args!r}")
elif "--dev-origin" in args:
    errors.append("contains --dev-origin; customer package LaunchAgent must use production origin only")
if plist.get("RunAtLoad") is not True:
    errors.append("RunAtLoad is not true")
if plist.get("KeepAlive") is not True:
    errors.append("KeepAlive is not true")

if errors:
    print("installed LaunchAgent plist mismatch: " + "; ".join(errors), file=sys.stderr)
    sys.exit(1)
PY
}

check_local_companion() {
  local response version
  [[ "$CHECK_LOCAL" == 1 ]] || return 0

  require_curl
  require_cmd python3
  response="$(curl_cmd -fsS "http://${EXPECTED_COMPANION_ADDR}/v1/status")"
  version="$(printf '%s' "$response" | python3 -c '
import json
import sys
payload = json.load(sys.stdin)
print(payload.get("companion", {}).get("version", ""))
')"
  [[ -n "$version" ]] || die "local Companion did not report a version"
  if [[ -n "$EXPECT_VERSION" && "$version" != "$EXPECT_VERSION" ]]; then
    die "expected Companion version $EXPECT_VERSION, got $version"
  fi
  log "local Companion ok: addr ${EXPECTED_COMPANION_ADDR}, version ${version}"
  check_local_companion_pna_preflight
}

check_local_companion_pna_preflight() {
  local headers
  headers="$(mktemp "${TMP_WORK_DIR}/local-pna.XXXXXX")"
  curl_cmd -fsS -D "$headers" -o /dev/null \
    -X OPTIONS \
    -H "Origin: ${HOSTED_APP_ORIGIN}" \
    -H "Access-Control-Request-Method: GET" \
    -H "Access-Control-Request-Private-Network: true" \
    "http://${EXPECTED_COMPANION_ADDR}/v1/status"
  python3 - "$headers" "$HOSTED_APP_ORIGIN" <<'PY'
import sys

headers_path, expected_origin = sys.argv[1], sys.argv[2]
headers = {}
with open(headers_path, encoding="iso-8859-1") as f:
    for line in f:
        if ":" not in line:
            continue
        name, value = line.split(":", 1)
        headers[name.strip().lower()] = value.strip()

errors = []
if headers.get("access-control-allow-origin") != expected_origin:
    errors.append("Access-Control-Allow-Origin")
if headers.get("access-control-allow-private-network") != "true":
    errors.append("Access-Control-Allow-Private-Network")
if errors:
    print("local Companion hosted-app preflight missing: " + ", ".join(errors), file=sys.stderr)
    sys.exit(1)
PY
  log "local Companion hosted-app preflight ok"
}

main() {
  parse_args "$@"
  github_release_headers
  check_release_assets
  check_package
  check_app_url
  check_app_release_endpoint
  check_app_theme_catalog
  check_app_install_route
  check_app_install_routes_for_free_themes
  check_app_shopify_product_pages
  check_shopify_product_pages
  check_installed_package
  check_local_companion
  log "customer-readiness checks passed"
}

main "$@"
