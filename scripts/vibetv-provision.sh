#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_ENV="esp8266_smalltv_st7789"
DEFAULT_PROJECT_DIR="${ROOT_DIR}/firmware_esp8266"

env_name="$DEFAULT_ENV"
project_dir="$DEFAULT_PROJECT_DIR"
package_dir=""
target=""
manufacturer_update_path="/update"
firmware_update_path="/update/firmware"
filesystem_update_path="/update/filesystem"
health_path="/health"
hello_path="/hello"
assets_path="/assets"
frame_path="/frame"
device_token=""
manufacturer_field="firmware"
firmware_field="firmware"
filesystem_field="filesystem"
expect_board=""
skip_build=0
skip_manufacturer_ota=0
skip_firmware_ota=1
skip_filesystem_ota=0
skip_health=0
skip_asset_check=0
skip_smoke=0
dry_run=0
assume_yes=0
allow_reboot_close=1
poll_timeout_secs=120
poll_interval_secs=3
curl_timeout_secs=30
upload_timeout_secs=90
filesystem_upload_timeout_secs=300
required_assets=("/themes/mini/mini.gif" "/themes/u/mini-cl-1-410a37.json")
current_stage="startup"
last_upload_result=""
failure_reported=0

report_unhandled_failure() {
  local status=$?
  if [[ "$status" -ne 0 && "${failure_reported:-0}" != "1" ]]; then
    printf 'provision: FAIL stage=%s exit=%s\n' "$current_stage" "$status" >&2
  fi
}
trap report_unhandled_failure EXIT

usage() {
  cat <<'EOF'
Usage:
  vibetv-provision.sh build [options]
  vibetv-provision.sh flash [options] --target http://<device-ip>
  vibetv-provision.sh all [options] --target http://<device-ip>

Builds firmware.bin + littlefs.bin, writes an OTA package with SHA-256 checksums,
uploads firmware to the GeekMagic manufacturer updater, waits for VibeTV firmware,
uploads LittleFS to the VibeTV updater, checks /health, /hello, and /assets,
verifies required theme asset bytes plus SHA-256 when exposed, then sends a mini theme test frame.

Commands:
  build                 Build and package artifacts only.
  flash                 Use an existing --package-dir and perform OTA/smoke steps.
  all                   Build package and perform OTA/smoke steps.

Required for flash/all:
  --target URL          Device base URL or IP, for example http://192.168.178.123.
                        Plain IPs are normalized to http://<ip>.

Common options:
  --env NAME            PlatformIO environment. Default: esp8266_smalltv_st7789.
  --project-dir DIR     PlatformIO project dir. Default: firmware_esp8266.
  --package-dir DIR     Package output/input dir. Default for build/all:
                        dist/vibetv-ota/<timestamp>-<env>.
  --expect-board ID     Require this board id substring in /hello.
  --dry-run             Print destructive actions without uploading.
  --yes                 Do not prompt before OTA uploads.

OTA endpoint options:
  --manufacturer-update PATH_OR_URL
                        GeekMagic manufacturer firmware endpoint. Default: /update.
  --firmware-update PATH_OR_URL
                        VibeTV firmware endpoint for app firmware. Default: /update/firmware.
  --filesystem-update PATH_OR_URL
                        VibeTV filesystem endpoint. Default: /update/filesystem.
  --assets-path PATH_OR_URL
                        VibeTV assets inspection endpoint. Default: /assets.
  --device-token TOKEN  Pairing token for protected VibeTV write endpoints.
                        Sent as X-VibeTV-Token and masked in logs.
  --manufacturer-field NAME
                        Multipart field for manufacturer firmware. Default: firmware.
  --firmware-field NAME
                        Multipart field for VibeTV firmware. Default: firmware.
  --filesystem-field NAME
                        Multipart field for VibeTV LittleFS. Default: filesystem.

Flow toggles:
  --skip-build          Reuse --package-dir artifacts.
  --skip-manufacturer-ota
                        Do not upload firmware to manufacturer firmware.
  --upload-firmware-to-vibetv
                        Also upload firmware.bin to the VibeTV updater after boot.
                        Off by default because the normal first pass uses
                        GeekMagic manufacturer OTA for firmware.
  --skip-filesystem     Do not upload littlefs.bin to VibeTV.
  --skip-health         Do not require /health during post-flash polling.
  --skip-asset-check    Do not require theme assets to be visible through /assets.
  --skip-smoke          Do not send the mini test frame.
  --allow-reboot-close  Treat curl exit 52/56 during OTA as a reboot close.
                        This is the default; post-upload checks still decide pass/fail.
  --strict-upload-response
                        Fail immediately on curl exit 52/56 instead of classifying it
                        as a reboot-related connection close.
  --upload-timeout SECS Upload timeout for firmware OTA requests. Default: 90.
  --filesystem-upload-timeout SECS
                        Upload timeout for LittleFS OTA requests. Default: 300.
  --require-asset PATH  Require an asset path in /assets after flashing.
                        Repeatable. Defaults: /themes/mini/mini.gif and
                        /themes/u/mini-cl-1-410a37.json.

Examples:
  ./scripts/vibetv-provision.sh build
  ./scripts/vibetv-provision.sh all --target 192.168.178.123 --yes
  ./scripts/vibetv-provision.sh flash --target http://192.168.178.123 \
    --package-dir dist/vibetv-ota/20260503_153000-esp8266_smalltv_st7789 --yes
  ./scripts/vibetv-provision.sh all --target 192.168.178.123 --dry-run
EOF
}

die() {
  failure_reported=1
  printf 'provision: FAIL stage=%s\n' "$current_stage" >&2
  printf 'error: %s\n' "$*" >&2
  exit 1
}

log() {
  printf '%s\n' "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    die "missing required command: $1"
  fi
}

normalize_asset_path() {
  local path="$1"
  [[ -n "$path" ]] || die "asset path must not be empty"
  if [[ "$path" != /* ]]; then
    path="/${path}"
  fi
  printf '%s\n' "$path"
}

normalize_target() {
  local raw="$1"
  raw="${raw%/}"
  if [[ -z "$raw" ]]; then
    die "--target is required for flash/all"
  fi
  if [[ "$raw" != http://* && "$raw" != https://* ]]; then
    raw="http://${raw}"
  fi
  printf '%s\n' "$raw"
}

endpoint_url() {
  local base="$1"
  local path_or_url="$2"
  if [[ "$path_or_url" == http://* || "$path_or_url" == https://* ]]; then
    printf '%s\n' "$path_or_url"
    return
  fi
  if [[ "$path_or_url" != /* ]]; then
    path_or_url="/${path_or_url}"
  fi
  printf '%s%s\n' "$base" "$path_or_url"
}

artifact_path() {
  local name="$1"
  printf '%s/%s\n' "$package_dir" "$name"
}

sha256_file() {
  shasum -a 256 "$1" | awk '{print $1}'
}

json_escape() {
  sed 's/\\/\\\\/g; s/"/\\"/g'
}

lower_ascii() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

redact_token() {
  local value="$1"
  if [[ -n "$device_token" ]]; then
    value="${value//$device_token/<redacted-token>}"
  fi
  printf '%s\n' "$value"
}

build_theme_assets_json() {
  local assets_json="[]"
  local asset normalized rel src bytes sha

  for asset in "${required_assets[@]}"; do
    normalized="$(normalize_asset_path "$asset")"
    rel="${normalized#/}"
    src="${project_dir}/data/${rel}"
    [[ -f "$src" ]] || die "required theme asset not found in data dir: ${src}"
    bytes="$(wc -c <"$src" | tr -d ' ')"
    [[ "$bytes" -gt 0 ]] || die "required theme asset is empty: ${src}"
    sha="$(sha256_file "$src")"
    assets_json="$(jq -c \
      --arg path "$normalized" \
      --arg file "data/${rel}" \
      --arg sha "$sha" \
      --argjson bytes "$bytes" \
      '. + [{"path":$path,"file":$file,"bytes":$bytes,"sha256":$sha,"required":true}] | unique_by(.path)' \
      <<<"$assets_json")"
  done

  printf '%s\n' "$assets_json"
}

confirm_destructive() {
  if [[ "$dry_run" == "1" || "$assume_yes" == "1" ]]; then
    return
  fi
  if [[ ! -t 0 ]]; then
    die "OTA upload requires --yes in non-interactive mode"
  fi
  printf 'This will upload OTA images to %s. Type FLASH to continue: ' "$target" >&2
  local answer
  read -r answer
  if [[ "$answer" != "FLASH" ]]; then
    die "confirmation failed"
  fi
}

run_or_print() {
  if [[ "$dry_run" == "1" ]]; then
    printf 'dry-run:'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

is_reboot_close_status() {
  local status="$1"
  [[ "$status" -eq 52 || "$status" -eq 56 ]]
}

ensure_package_dir() {
  if [[ -n "$package_dir" ]]; then
    return
  fi
  package_dir="${ROOT_DIR}/dist/vibetv-ota/$(date +%Y%m%d_%H%M%S)-${env_name}"
}

build_package() {
  current_stage="build package"
  require_cmd pio
  require_cmd shasum
  require_cmd jq
  ensure_package_dir

  [[ -d "$project_dir" ]] || die "project dir not found: $project_dir"
  mkdir -p "$package_dir"

  log "build: env=${env_name} project=${project_dir}"
  pio run -d "$project_dir" -e "$env_name"
  pio run -d "$project_dir" -e "$env_name" -t buildfs

  local build_dir="${project_dir}/.pio/build/${env_name}"
  local firmware_src="${build_dir}/firmware.bin"
  local littlefs_src="${build_dir}/littlefs.bin"
  [[ -f "$firmware_src" ]] || die "firmware artifact not found: $firmware_src"
  [[ -f "$littlefs_src" ]] || die "LittleFS artifact not found: $littlefs_src"

  cp "$firmware_src" "$(artifact_path firmware.bin)"
  cp "$littlefs_src" "$(artifact_path littlefs.bin)"

  local firmware_sha littlefs_sha manifest_sha git_commit created_utc theme_assets_json required_asset_paths_json
  firmware_sha="$(sha256_file "$(artifact_path firmware.bin)")"
  littlefs_sha="$(sha256_file "$(artifact_path littlefs.bin)")"
  git_commit="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || printf 'unknown')"
  created_utc="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  theme_assets_json="$(build_theme_assets_json)"
  required_asset_paths_json="$(jq -c '[.[].path]' <<<"$theme_assets_json")"

  local escaped_env escaped_commit escaped_created
  escaped_env="$(printf '%s' "$env_name" | json_escape)"
  escaped_commit="$(printf '%s' "$git_commit" | json_escape)"
  escaped_created="$(printf '%s' "$created_utc" | json_escape)"
  {
    printf '{\n'
    printf '  "kind": "vibetv-ota-package",\n'
    printf '  "createdAt": "%s",\n' "$escaped_created"
    printf '  "gitCommit": "%s",\n' "$escaped_commit"
    printf '  "environment": "%s",\n' "$escaped_env"
    printf '  "artifacts": {\n'
    printf '    "firmware": {"file": "firmware.bin", "sha256": "%s", "bytes": %s},\n' \
      "$firmware_sha" "$(wc -c <"$(artifact_path firmware.bin)" | tr -d ' ')"
    printf '    "filesystem": {"file": "littlefs.bin", "sha256": "%s", "bytes": %s}\n' \
      "$littlefs_sha" "$(wc -c <"$(artifact_path littlefs.bin)" | tr -d ' ')"
    printf '  },\n'
    printf '  "themeAssets": %s,\n' "$theme_assets_json"
    printf '  "themePacks": [\n'
    printf '    {"id": "mini-classic", "requiredAssets": %s}\n' "$required_asset_paths_json"
    printf '  ]\n'
    printf '}\n'
  } >"$(artifact_path manifest.json)"

  manifest_sha="$(sha256_file "$(artifact_path manifest.json)")"
  {
    printf '%s  firmware.bin\n' "$firmware_sha"
    printf '%s  littlefs.bin\n' "$littlefs_sha"
    printf '%s  manifest.json\n' "$manifest_sha"
  } >"$(artifact_path SHA256SUMS)"

  log "package: ${package_dir}"
  log "checksums:"
  sed 's/^/  /' "$(artifact_path SHA256SUMS)"
}

verify_package() {
  current_stage="verify package"
  require_cmd shasum
  require_cmd jq
  [[ -n "$package_dir" ]] || die "--package-dir is required with flash or --skip-build"
  [[ -f "$(artifact_path firmware.bin)" ]] || die "missing package artifact: $(artifact_path firmware.bin)"
  [[ -f "$(artifact_path littlefs.bin)" ]] || die "missing package artifact: $(artifact_path littlefs.bin)"
  [[ -f "$(artifact_path SHA256SUMS)" ]] || die "missing package checksum file: $(artifact_path SHA256SUMS)"
  [[ -f "$(artifact_path manifest.json)" ]] || die "missing package manifest: $(artifact_path manifest.json)"
  (cd "$package_dir" && shasum -a 256 -c SHA256SUMS)
  jq -e '.kind == "vibetv-ota-package" and (.themeAssets | type == "array") and (.themeAssets | length > 0)' \
    "$(artifact_path manifest.json)" >/dev/null ||
    die "package manifest does not contain themeAssets metadata"
}

curl_get() {
  local url="$1"
  curl -fsS --connect-timeout 5 --max-time "$curl_timeout_secs" "$url"
}

http_status() {
  local url="$1"
  local body_file="/tmp/vibetv-provision-status-body.$$"
  local status
  status="$(curl -sS -o "$body_file" -w '%{http_code}' --connect-timeout 5 --max-time "$curl_timeout_secs" "$url" 2>/dev/null || true)"
  rm -f "$body_file"
  if [[ -z "$status" ]]; then
    status="000"
  fi
  printf '%s\n' "$status"
}

probe_target_before_flash() {
  local update_url="$1"
  local hello_url="$2"
  local hello_file="/tmp/vibetv-provision-preflight-hello.$$"
  local update_status hello_status

  if [[ "$dry_run" == "1" ]]; then
    log "dry-run: would preflight ${target}"
    return 0
  fi

  update_status="$(http_status "$update_url")"
  hello_status="$(http_status "$hello_url")"

  if [[ "$hello_status" == "200" ]]; then
    curl_get "$hello_url" >"$hello_file" || true
    if grep -F '"kind":"hello"' "$hello_file" >/dev/null 2>&1 &&
      grep -F '"active":"wifi"' "$hello_file" >/dev/null 2>&1 &&
      [[ "$update_status" == "404" ]]; then
      log "preflight: target already runs VibeTV firmware, but OTA update endpoints are not available" >&2
      log "preflight: /hello is present; /update returned 404" >&2
      rm -f "$hello_file"
      die "target firmware cannot be updated over WiFi; use a physical recovery or factory web console path, then rerun provisioning"
    fi
    rm -f "$hello_file"
  fi
}

wait_for_endpoint() {
  local label="$1"
  local url="$2"
  local deadline=$((SECONDS + poll_timeout_secs))
  local last_status=1

  if [[ "$dry_run" == "1" ]]; then
    log "dry-run: would poll ${label} ${url}"
    return 0
  fi

  log "poll: waiting for ${label} ${url}"
  while (( SECONDS < deadline )); do
    if curl_get "$url" >/tmp/vibetv-provision-response.$$ 2>/tmp/vibetv-provision-error.$$; then
      rm -f /tmp/vibetv-provision-response.$$ /tmp/vibetv-provision-error.$$
      log "poll: ${label} ok"
      return 0
    fi
    last_status=$?
    sleep "$poll_interval_secs"
  done

  log "poll: ${label} failed after ${poll_timeout_secs}s (last curl status ${last_status})" >&2
  if [[ -s /tmp/vibetv-provision-error.$$ ]]; then
    sed 's/^/  /' /tmp/vibetv-provision-error.$$ >&2 || true
  fi
  rm -f /tmp/vibetv-provision-response.$$ /tmp/vibetv-provision-error.$$
  return 1
}

check_hello() {
  local url="$1"
  local body_file="/tmp/vibetv-provision-hello.$$"
  if [[ "$dry_run" == "1" ]]; then
    log "dry-run: would read hello ${url}"
    return 0
  fi
  curl_get "$url" >"$body_file" || {
    rm -f "$body_file"
    die "hello check request failed"
  }
  if [[ -n "$expect_board" ]] && ! grep -F "$expect_board" "$body_file" >/dev/null 2>&1; then
    log "hello response:" >&2
    sed 's/^/  /' "$body_file" >&2
    rm -f "$body_file"
    die "hello did not contain expected board id: $expect_board"
  fi
  log "hello:"
  sed 's/^/  /' "$body_file"
  rm -f "$body_file"
}

check_assets() {
  local url="$1"
  local require_runtime_assets="${2:-1}"
  local body_file="/tmp/vibetv-provision-assets.$$"
  local expected_file="/tmp/vibetv-provision-expected-assets.$$"
  local sorted_expected_file="/tmp/vibetv-provision-expected-assets-sorted.$$"
  if [[ "$skip_asset_check" == "1" ]]; then
    log "skip: asset check"
    return 0
  fi
  if [[ "$dry_run" == "1" ]]; then
    log "dry-run: would read assets ${url}"
    return 0
  fi

  local fetch_attempt fetch_ok=0
  for fetch_attempt in 1 2 3; do
    if curl_get "$url" >"$body_file"; then
      fetch_ok=1
      break
    fi
    if [[ "$fetch_attempt" != "3" ]]; then
      log "assets: retry ${fetch_attempt}/3 after transient read failure"
      sleep 2
    fi
  done
  if [[ "$fetch_ok" != "1" ]]; then
    rm -f "$body_file"
    die "asset verification request failed"
  fi
  if [[ "$require_runtime_assets" != "1" ]]; then
    log "assets endpoint:"
    sed 's/^/  /' "$body_file"
    rm -f "$body_file"
    return 0
  fi

  if ! jq -e '.filesystem.mounted == true' "$body_file" >/dev/null 2>&1; then
    log "assets response:" >&2
    sed 's/^/  /' "$body_file" >&2
    rm -f "$body_file"
    die "filesystem is not mounted according to /assets"
  fi

  : >"$expected_file"
  jq -r '.themeAssets[] | select(.required != false) | [.path, (.bytes | tostring), (.sha256 // "")] | @tsv' \
    "$(artifact_path manifest.json)" >>"$expected_file"

  local asset normalized
  for asset in "${required_assets[@]}"; do
    if [[ -z "$asset" ]]; then
      continue
    fi
    normalized="$(normalize_asset_path "$asset")"
    printf '%s\t\t\n' "$normalized" >>"$expected_file"
  done
  sort -u "$expected_file" >"$sorted_expected_file"

  local expected_path expected_bytes expected_sha asset_metadata actual_bytes actual_sha
  while IFS=$'\t' read -r expected_path expected_bytes expected_sha; do
    if [[ -z "$expected_path" ]]; then
      continue
    fi
    if ! asset_metadata="$(jq -er --arg path "$expected_path" \
      'first(.assets[]? | select(.path == $path) | [(.sizeBytes // -1), (.sha256 // "")] | @tsv) // empty' \
      "$body_file" 2>/dev/null)"; then
      log "assets response:" >&2
      sed 's/^/  /' "$body_file" >&2
      rm -f "$body_file" "$expected_file" "$sorted_expected_file"
      die "required asset missing from /assets: ${expected_path}"
    fi
    IFS=$'\t' read -r actual_bytes actual_sha <<<"$asset_metadata"
    if [[ ! "$actual_bytes" =~ ^[0-9]+$ || "$actual_bytes" -le 0 ]]; then
      log "assets response:" >&2
      sed 's/^/  /' "$body_file" >&2
      rm -f "$body_file" "$expected_file" "$sorted_expected_file"
      die "required asset has invalid or zero size: ${expected_path}"
    fi
    if [[ -n "$expected_bytes" && "$actual_bytes" != "$expected_bytes" ]]; then
      log "assets response:" >&2
      sed 's/^/  /' "$body_file" >&2
      rm -f "$body_file" "$expected_file" "$sorted_expected_file"
      die "required asset size mismatch: ${expected_path} expected=${expected_bytes} actual=${actual_bytes}"
    fi
    if [[ -n "$expected_sha" ]]; then
      if [[ -z "$actual_sha" || "$actual_sha" == "null" ]]; then
        log "asset sha256 metadata unavailable; verified size only: ${expected_path}"
      elif [[ "$(lower_ascii "$actual_sha")" != "$(lower_ascii "$expected_sha")" ]]; then
        log "assets response:" >&2
        sed 's/^/  /' "$body_file" >&2
        rm -f "$body_file" "$expected_file" "$sorted_expected_file"
        die "required asset sha256 mismatch: ${expected_path} expected=${expected_sha} actual=${actual_sha}"
      fi
    fi
  done <"$sorted_expected_file"

  log "assets:"
  sed 's/^/  /' "$body_file"
  rm -f "$body_file" "$expected_file" "$sorted_expected_file"
}

upload_multipart() {
  local label="$1"
  local url="$2"
  local field="$3"
  local file="$4"
  local timeout_secs="${5:-$upload_timeout_secs}"
  local response_file="/tmp/vibetv-provision-upload-response.$$"
  local error_file="/tmp/vibetv-provision-upload-error.$$"
  local auth_args=()
  [[ -f "$file" ]] || die "${label} file not found: $file"
  current_stage="upload: ${label}"
  last_upload_result=""
  if [[ -n "$device_token" ]]; then
    auth_args=(-H "X-VibeTV-Token:${device_token}")
  fi

  log "upload: ${label} -> $(redact_token "$url") field=${field} file=${file}"
  if [[ "$dry_run" == "1" ]]; then
    if [[ -n "$device_token" ]]; then
      printf 'dry-run: curl -fsS --connect-timeout 5 --max-time %q -H %q -X POST -F %q %q\n' \
        "$timeout_secs" "X-VibeTV-Token:<redacted-token>" "${field}=@${file}" "$(redact_token "$url")"
    else
      printf 'dry-run: curl -fsS --connect-timeout 5 --max-time %q -X POST -F %q %q\n' \
        "$timeout_secs" "${field}=@${file}" "$url"
    fi
    last_upload_result="dry-run"
    return 0
  fi

  set +e
  curl -fsS --connect-timeout 5 --max-time "$timeout_secs" \
    "${auth_args[@]}" \
    -X POST -F "${field}=@${file};filename=$(basename "$file")" "$url" \
    >"$response_file" 2>"$error_file"
  local status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    last_upload_result="http-response"
    if [[ -s "$response_file" ]]; then
      log "upload: ${label} HTTP response:"
      sed 's/^/  /' "$response_file"
    fi
    rm -f "$response_file" "$error_file"
    log "upload: ${label} HTTP response received; continuing with post-upload checks"
    return 0
  fi
  if [[ "$allow_reboot_close" == "1" ]] && is_reboot_close_status "$status"; then
    last_upload_result="reboot-close"
    log "upload: ${label} curl status ${status}; classified as reboot-related connection close"
    if [[ -s "$error_file" ]]; then
      sed 's/^/  /' "$error_file" >&2 || true
    fi
    rm -f "$response_file" "$error_file"
    log "upload: ${label} response was interrupted by reboot; continuing with post-upload checks"
    return 0
  fi
  if [[ -s "$error_file" ]]; then
    log "upload error:" >&2
    sed 's/^/  /' "$error_file" >&2 || true
  fi
  rm -f "$response_file" "$error_file"
  die "${label} upload failed with curl status ${status}"
}

post_upload_checks() {
  local phase="$1"
  local health_url="$2"
  local hello_url="$3"
  local assets_url="$4"
  local asset_mode="${5:-required}"
  local require_runtime_assets=1

  log "verify: ${phase}: post-upload checks start (upload=${last_upload_result:-unknown})"
  if [[ "$skip_health" != "1" ]]; then
    current_stage="reboot wait: ${phase} health"
    wait_for_endpoint "${phase} health check" "$health_url" ||
      die "reboot wait/health check failed for ${phase}"
  else
    log "skip: health check for ${phase}"
  fi

  current_stage="health check: ${phase} hello"
  wait_for_endpoint "${phase} hello check" "$hello_url" ||
    die "hello check failed for ${phase}"
  check_hello "$hello_url"

  if [[ "$asset_mode" == "endpoint" ]]; then
    require_runtime_assets=0
  fi
  current_stage="asset verification: ${phase}"
  wait_for_endpoint "${phase} assets check" "$assets_url" ||
    die "asset verification failed for ${phase}"
  check_assets "$assets_url" "$require_runtime_assets"

  log "verify: ${phase}: post-upload checks passed"
}

send_frame() {
  local label="$1"
  local url="$2"
  local payload="$3"
  local response_file="/tmp/vibetv-provision-frame.$$"
  local auth_args=()
  local attempt
  log "smoke: sending ${label} frame"
  if [[ -n "$device_token" ]]; then
    auth_args=(-H "X-VibeTV-Token:${device_token}")
  fi
  if [[ "$dry_run" == "1" ]]; then
    if [[ -n "$device_token" ]]; then
      run_or_print curl -fsS --connect-timeout 5 --max-time "$curl_timeout_secs" \
        -H "Content-Type: application/json" -H "X-VibeTV-Token:<redacted-token>" --data-binary "$payload" "$(redact_token "$url")"
    else
      run_or_print curl -fsS --connect-timeout 5 --max-time "$curl_timeout_secs" \
        -H "Content-Type: application/json" --data-binary "$payload" "$url"
    fi
    return 0
  fi

  for attempt in 1 2 3; do
    if curl -fsS --connect-timeout 5 --max-time "$curl_timeout_secs" \
      -H "Content-Type: application/json" "${auth_args[@]}" --data-binary "$payload" "$url" >"$response_file"; then
      if [[ "$(tr -d '\r\n' <"$response_file")" == "ok" ]]; then
        rm -f "$response_file"
        log "smoke: ${label} accepted"
        return 0
      fi
      log "frame response:" >&2
      sed 's/^/  /' "$response_file" >&2
      rm -f "$response_file"
      die "${label} smoke frame was not accepted"
    fi
    rm -f "$response_file"
    if [[ "$attempt" != "3" ]]; then
      log "smoke: ${label} retry ${attempt}/3"
      sleep 2
    fi
  done

  die "${label} smoke frame failed after retries"
}

send_smoke_frames() {
  local frame_url="$1"
  send_frame "mini" "$frame_url" \
    '{"v":2,"provider":"vibetv","label":"Vibe TV","session":23,"weekly":64,"resetSecs":12000,"sessionTokens":203211,"weekTokens":9231002,"totalTokens":1087628607,"theme":"mini"}'
}

check_post_smoke_gif_state() {
  local health_url="$1"
  local body_file="/tmp/vibetv-provision-gif-health.$$"
  local attempt stage error_path

  if [[ "$skip_health" == "1" ]]; then
    log "skip: post-smoke GIF state check because health checks are disabled"
    return 0
  fi
  if [[ "$dry_run" == "1" ]]; then
    log "dry-run: would verify mini GIF state via ${health_url}"
    return 0
  fi

  current_stage="post-smoke GIF state"
  for attempt in 1 2 3 4 5 6 7 8; do
    if curl_get "$health_url" >"$body_file"; then
      if jq -e '.display.activeTheme == "mini-classic" and .display.themeSpec.active == true and .display.themeSpec.path == "/themes/u/mini-cl-1-410a37.json" and .display.themeSpec.renderOk == true and .display.gif.activePath == "/themes/mini/mini.gif" and .display.gif.filePresent == true and .display.gif.decoderOpen == true and .display.gif.lastError == null' "$body_file" >/dev/null 2>&1; then
        log "smoke: mini-classic ThemeSpec GIF decoder healthy"
        rm -f "$body_file"
        return 0
      fi
      if jq -e '.display.gif.lastError != null' "$body_file" >/dev/null 2>&1; then
        stage="$(jq -r '.display.gif.lastError.stage // "unknown"' "$body_file")"
        error_path="$(jq -r '.display.gif.lastError.path // ""' "$body_file")"
        log "health response:" >&2
        sed 's/^/  /' "$body_file" >&2
        rm -f "$body_file"
        die "mini GIF renderer reported error stage=${stage} path=${error_path}"
      fi
    fi
    if [[ "$attempt" != "8" ]]; then
      sleep 1
    fi
  done

  log "health response:" >&2
  if [[ -f "$body_file" ]]; then
    sed 's/^/  /' "$body_file" >&2
  fi
  rm -f "$body_file"
  die "mini-classic ThemeSpec GIF decoder did not report healthy state after smoke frame"
}

flash_package() {
  current_stage="flash package"
  require_cmd curl
  verify_package
  target="$(normalize_target "$target")"

  local manufacturer_url firmware_url filesystem_url health_url hello_url assets_url frame_url
  manufacturer_url="$(endpoint_url "$target" "$manufacturer_update_path")"
  firmware_url="$(endpoint_url "$target" "$firmware_update_path")"
  filesystem_url="$(endpoint_url "$target" "$filesystem_update_path")"
  health_url="$(endpoint_url "$target" "$health_path")"
  hello_url="$(endpoint_url "$target" "$hello_path")"
  assets_url="$(endpoint_url "$target" "$assets_path")"
  frame_url="$(endpoint_url "$target" "$frame_path")"

  probe_target_before_flash "$manufacturer_url" "$hello_url"
  confirm_destructive

  if [[ "$skip_manufacturer_ota" != "1" ]]; then
    upload_multipart "manufacturer firmware OTA" "$manufacturer_url" "$manufacturer_field" "$(artifact_path firmware.bin)" "$upload_timeout_secs"
    post_upload_checks "manufacturer firmware OTA" "$health_url" "$hello_url" "$assets_url" "endpoint"
  else
    log "skip: manufacturer firmware OTA"
  fi

  if [[ "$skip_firmware_ota" != "1" ]]; then
    upload_multipart "VibeTV firmware OTA" "$firmware_url" "$firmware_field" "$(artifact_path firmware.bin)" "$upload_timeout_secs"
    post_upload_checks "VibeTV firmware OTA" "$health_url" "$hello_url" "$assets_url" "endpoint"
  fi

  if [[ "$skip_filesystem_ota" != "1" ]]; then
    upload_multipart "VibeTV filesystem OTA" "$filesystem_url" "$filesystem_field" "$(artifact_path littlefs.bin)" "$filesystem_upload_timeout_secs"
    post_upload_checks "VibeTV filesystem OTA" "$health_url" "$hello_url" "$assets_url" "required"
  else
    log "skip: filesystem OTA"
    post_upload_checks "final runtime verification" "$health_url" "$hello_url" "$assets_url" "required"
  fi

  if [[ "$skip_smoke" != "1" ]]; then
    current_stage="smoke frame"
    send_smoke_frames "$frame_url"
    check_post_smoke_gif_state "$health_url"
  else
    log "skip: smoke frames"
  fi
}

if [[ "$#" -eq 0 ]]; then
  usage
  exit 2
fi

if [[ "$1" == "--help" || "$1" == "-h" ]]; then
  usage
  exit 0
fi

command="$1"
shift

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --env)
      env_name="${2:-}"
      shift 2
      ;;
    --project-dir)
      project_dir="${2:-}"
      shift 2
      ;;
    --package-dir)
      package_dir="${2:-}"
      shift 2
      ;;
    --target|--ip)
      target="${2:-}"
      shift 2
      ;;
    --manufacturer-update)
      manufacturer_update_path="${2:-}"
      shift 2
      ;;
    --firmware-update)
      firmware_update_path="${2:-}"
      shift 2
      ;;
    --filesystem-update)
      filesystem_update_path="${2:-}"
      shift 2
      ;;
    --health-path)
      health_path="${2:-}"
      shift 2
      ;;
    --hello-path)
      hello_path="${2:-}"
      shift 2
      ;;
    --assets-path)
      assets_path="${2:-}"
      shift 2
      ;;
    --device-token)
      device_token="${2:-}"
      shift 2
      ;;
    --frame-path)
      frame_path="${2:-}"
      shift 2
      ;;
    --manufacturer-field)
      manufacturer_field="${2:-}"
      shift 2
      ;;
    --firmware-field)
      firmware_field="${2:-}"
      shift 2
      ;;
    --filesystem-field)
      filesystem_field="${2:-}"
      shift 2
      ;;
    --expect-board)
      expect_board="${2:-}"
      shift 2
      ;;
    --poll-timeout)
      poll_timeout_secs="${2:-}"
      shift 2
      ;;
    --poll-interval)
      poll_interval_secs="${2:-}"
      shift 2
      ;;
    --curl-timeout)
      curl_timeout_secs="${2:-}"
      shift 2
      ;;
    --upload-timeout)
      upload_timeout_secs="${2:-}"
      shift 2
      ;;
    --filesystem-upload-timeout)
      filesystem_upload_timeout_secs="${2:-}"
      shift 2
      ;;
    --skip-build)
      skip_build=1
      shift
      ;;
    --skip-manufacturer-ota)
      skip_manufacturer_ota=1
      shift
      ;;
    --upload-firmware-to-vibetv)
      skip_firmware_ota=0
      shift
      ;;
    --skip-filesystem)
      skip_filesystem_ota=1
      shift
      ;;
    --skip-health)
      skip_health=1
      shift
      ;;
    --skip-asset-check)
      skip_asset_check=1
      shift
      ;;
    --skip-smoke)
      skip_smoke=1
      shift
      ;;
    --require-asset)
      required_assets+=("${2:-}")
      shift 2
      ;;
    --allow-reboot-close)
      allow_reboot_close=1
      shift
      ;;
    --strict-upload-response)
      allow_reboot_close=0
      shift
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    --yes|-y)
      assume_yes=1
      shift
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

case "$command" in
  build)
    build_package
    ;;
  flash)
    flash_package
    ;;
  all)
    if [[ "$skip_build" != "1" ]]; then
      build_package
    fi
    flash_package
    ;;
  *)
    die "unknown command: $command"
    ;;
esac

current_stage="complete"
log "provision: PASS command=${command}"
