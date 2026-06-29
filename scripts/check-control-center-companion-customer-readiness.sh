#!/usr/bin/env bash
set -euo pipefail

REPO="DreamyTalesPAN/CodexBar-Display"
GITHUB_API_BASE="${CONTROL_CENTER_GITHUB_API_BASE:-https://api.github.com}"
CURL_BIN="${CONTROL_CENTER_READINESS_CURL:-curl}"
HOSTED_APP_ORIGIN="https://app.vibetv.shop"
EXPECTED_COMPANION_ADDR="${VIBETV_COMPANION_ADDR:-127.0.0.1:47832}"
SHOPIFY_APP_URL="$HOSTED_APP_ORIGIN"
SHOPIFY_STORE_URL="https://vibetv.shop"
RELEASE_TAG=""
RELEASE_JSON=""
APP_URL=""
EXPECT_VERSION=""
EXPECT_CATALOG_SOURCE=""
EXPECT_THEME_ID=""
EXPECT_ALL_FREE_THEMES_INSTALLABLE=0
EXPECT_SHOPIFY_PRODUCT_PAGES=0
CHECK_LOCAL=0
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

Read-only checks for the hosted Control Center customer Mac App path.

Options:
  --repo owner/name                 GitHub repo. Default: DreamyTalesPAN/CodexBar-Display
  --release v1.2.3                 Check expected Mac setup release asset names.
  --release-json path              Use a local GitHub release JSON fixture instead of GitHub API.
  --app-url https://app.vibetv.shop Check hosted app HTTP reachability. With --release/--release-json, also check /api/companion/latest version state.
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
  --local-companion                Check local Mac App status on VIBETV_COMPANION_ADDR, default 127.0.0.1:47832.
  --expect-version x.y.z           Require local Mac App version where checked.
  -h, --help                       Show this help.

Examples:
  scripts/check-control-center-companion-customer-readiness.sh \
    --release v1.0.32 \
    --app-url https://app.vibetv.shop

  scripts/check-control-center-companion-customer-readiness.sh --local-companion

  scripts/check-control-center-companion-customer-readiness.sh \
    --app-url https://app.vibetv.shop \
    --expect-catalog-source shopify \
    --expect-theme-id my-theme-id \
    --expect-all-free-themes-installable \
    --expect-shopify-product-pages

  scripts/check-control-center-companion-customer-readiness.sh \
    --shopify-product-page https://vibetv.shop/products/synthwave-theme synthwave \
    --shopify-product-page https://vibetv.shop/products/clippy-theme clippy

This script does not install apps, start services, discover devices, or perform
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
expected_assets = {
    "install-control-center-companion.sh",
    f"codexbar-display-darwin-arm64-v{version}",
    f"codexbar-display-darwin-amd64-v{version}",
    f"checksums-v{version}.txt",
}
missing = sorted(expected_assets - assets)
if missing:
    print("missing release assets:", ", ".join(missing), file=sys.stderr)
    sys.exit(1)

packages = sorted(str(asset) for asset in assets if str(asset).endswith(".pkg"))
if packages:
    print("unexpected release package assets:", ", ".join(packages), file=sys.stderr)
    sys.exit(1)

print(f"release assets ok for v{version}; terminal setup assets available")
PY
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
import sys

version, response_path = sys.argv[1], sys.argv[2]
with open(response_path, encoding="utf-8") as f:
    payload = json.load(f)

def get_path(root, dotted):
    current = root
    for part in dotted.split("."):
        if not isinstance(current, dict):
            return ""
        current = current.get(part)
    return current if isinstance(current, str) else ""

errors = []
if payload.get("status") != "available":
    errors.append(f"status={payload.get('status')!r}")
if payload.get("latestVersion") != version:
    errors.append(f"latestVersion={payload.get('latestVersion')!r}")

message = str(payload.get("message", ""))
for forbidden in (
    "Companion",
    "latest release",
    "release check",
    "package asset",
    "customer installer",
    "not published",
):
    if forbidden in message:
        errors.append(f"message exposes {forbidden!r}")

installer_url = get_path(payload, "installerDownloadUrl")
if installer_url:
    errors.append("installerDownloadUrl must stay hidden from the customer API")

if isinstance(payload.get("packageDownloadUrls"), dict):
    errors.append("packageDownloadUrls must stay hidden from the customer API")

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

expected_command = (
    f"codexbar-display theme-pack install --theme {theme_id} "
    "--target http://vibetv.local"
)
required_terminal_copy = [
    "Copy install command",
    expected_command,
]
forbidden = [
    f"{app_url.rstrip('/')}/install/{quote(theme_id, safe='')}",
    "app.vibetv.shop/install",
    "Check compatibility in the app",
    "Opens the hosted Control Center",
    "Theme check unavailable",
    "Jetzt installieren",
    "Jetzt Theme installieren",
    "Install now",
    "One-click install",
    "One click install",
]

errors = []
for copy in required_terminal_copy:
    if copy not in html:
        errors.append(f"missing terminal install copy: {copy}")
for needle in forbidden:
    if needle in html:
        errors.append(f"unavailable app install copy still present: {needle}")

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
  check_app_url
  check_app_release_endpoint
  check_app_theme_catalog
  check_app_install_route
  check_app_install_routes_for_free_themes
  check_app_shopify_product_pages
  check_shopify_product_pages
  check_local_companion
  log "customer-readiness checks passed"
}

main "$@"
