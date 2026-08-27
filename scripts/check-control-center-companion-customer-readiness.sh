#!/usr/bin/env bash
set -euo pipefail

REPO="DreamyTalesPAN/CodexBar-Display"
GITHUB_API_BASE="${CONTROL_CENTER_GITHUB_API_BASE:-https://api.github.com}"
CURL_BIN="${CONTROL_CENTER_READINESS_CURL:-curl}"
HOSTED_APP_ORIGIN="https://app.vibetv.shop"
EXPECTED_COMPANION_ADDR="${VIBETV_COMPANION_ADDR:-127.0.0.1:47832}"
RELEASE_TAG=""
RELEASE_JSON=""
APP_URL=""
EXPECT_VERSION=""
EXPECT_CATALOG_SOURCE=""
EXPECT_THEME_ID=""
EXPECT_ALL_FREE_THEMES_INSTALLABLE=0
CHECK_LOCAL=0
GITHUB_RELEASE_HEADERS=()
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
    --expect-all-free-themes-installable

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
  check_local_companion
  log "customer-readiness checks passed"
}

main "$@"
