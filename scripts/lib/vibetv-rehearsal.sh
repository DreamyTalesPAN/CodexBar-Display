#!/usr/bin/env bash
# Shared engine for the VibeTV customer rehearsal scripts.
#
# Two rehearsals build on this library:
#   scripts/vibetv-rehearse-warm-start.sh  existing customer updates to the candidate
#   scripts/vibetv-rehearse-cold-start.sh  new customer installs the candidate directly
#
# Both put this Mac and the connected VibeTV into a defined starting state and
# then hand control back to the operator, who drives the visible customer flow.
#
# Nothing is ever hard-deleted. Everything the purge removes is moved into a
# timestamped backup directory that `--restore` can put back.

set -euo pipefail

REHEARSAL_APP_PATH="/Applications/VibeTV Control Center.app"
REHEARSAL_BUNDLE_ID="shop.vibetv.control-center"
REHEARSAL_SUPPORT_DIR="$HOME/Library/Application Support/codexbar-display"
REHEARSAL_FIRMWARE_ENV_VAR="CODEXBAR_DISPLAY_FIRMWARE_MANIFEST_URL"
REHEARSAL_MAC_RELEASE_ENV_VAR="CODEXBAR_DISPLAY_MAC_APP_RELEASE_API_URL"
REHEARSAL_REPOSITORY="${REHEARSAL_REPOSITORY:-DreamyTalesPAN/CodexBar-Display}"
REHEARSAL_BOARD="${REHEARSAL_BOARD:-esp8266-smalltv-st7789}"

# Populated by rehearsal::parse_args.
REHEARSAL_MODE=""
REHEARSAL_PR=""
REHEARSAL_RUN_ID=""
REHEARSAL_DEVICE_TARGET=""
REHEARSAL_ASSUME_YES=0
REHEARSAL_RESTORE=0
REHEARSAL_KEEP_CODEXBAR=0
REHEARSAL_SKIP_FIRMWARE_BASELINE=0
REHEARSAL_RESTORE_FROM=""
REHEARSAL_COMPANION_OVERRIDE=""

REHEARSAL_STATE_DIR="$HOME/.vibetv-rehearsal"
REHEARSAL_RUN_DIR=""
REHEARSAL_BACKUP_DIR=""
REHEARSAL_SERVE_DIR=""
REHEARSAL_LOG=""

# ---------------------------------------------------------------- utilities

rehearsal::die() {
  printf '\nerror: %s\n' "$*" >&2
  exit 1
}

rehearsal::step() {
  printf '\n\033[1m== %s\033[0m\n' "$*"
}

rehearsal::info() {
  printf '   %s\n' "$*"
}

rehearsal::warn() {
  printf '   \033[33mwarn:\033[0m %s\n' "$*"
}

rehearsal::confirm() {
  local prompt="$1"
  if [[ "$REHEARSAL_ASSUME_YES" == 1 ]]; then
    rehearsal::info "$prompt -> auto-confirmed (--yes)"
    return 0
  fi
  local reply=""
  read -r -p "$prompt [y/N] " reply
  [[ "$reply" == [yY] ]] || rehearsal::die 'aborted by operator'
}

rehearsal::require_tools() {
  local missing=()
  local tool
  for tool in "$@"; do
    command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
  done
  ((${#missing[@]} == 0)) || rehearsal::die "missing required tools: ${missing[*]}"
}

# Records a machine-readable fact into the run report.
rehearsal::record() {
  local key="$1" value="$2"
  printf '%s\t%s\n' "$key" "$value" >> "$REHEARSAL_RUN_DIR/facts.tsv"
}

# --------------------------------------------------------------- argument parsing

rehearsal::usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]

  --pr <number>          Pull request whose merge-gate candidate to install (default: $REHEARSAL_PR)
  --run-id <id>          Use an explicit CODEX Test VibeTV Merge run instead of the newest for --pr
  --device-target <url>  VibeTV base URL, e.g. http://192.168.178.72 (default: autodetect)
  --restore-from <run>   Restore a named run under ~/.vibetv-rehearsal/runs
                         instead of the newest one with a backup
  --companion-override <path>
                         Swap the installed app's companion helper for a locally
                         built one, for companion- and API-level checks. The
                         ad-hoc re-sign breaks the Developer ID launch
                         constraint SMAppService holds, so the Mac App will not
                         start; build it with --local-preview for UI work. The
                         binary must carry the installed app's version or the
                         swap is refused.
  --keep-codexbar        Do not purge ~/.codexbar (keeps your CodexBar provider config)
  --skip-firmware-baseline
                         Warm start only: trust the firmware already on the device
  --restore              Undo the last rehearsal: restore the backup and clear overrides
  --yes                  Do not ask for confirmation
  -h, --help             Show this help
USAGE
}

rehearsal::parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --pr) [[ -n "${2:-}" ]] || rehearsal::die '--pr needs a value'; REHEARSAL_PR="$2"; shift 2 ;;
      --run-id) [[ -n "${2:-}" ]] || rehearsal::die '--run-id needs a value'; REHEARSAL_RUN_ID="$2"; shift 2 ;;
      --device-target) [[ -n "${2:-}" ]] || rehearsal::die '--device-target needs a value'; REHEARSAL_DEVICE_TARGET="$2"; shift 2 ;;
      --companion-override)
        [[ -n "${2:-}" ]] || rehearsal::die '--companion-override needs a path'
        REHEARSAL_COMPANION_OVERRIDE="$2"; shift 2 ;;
      --keep-codexbar) REHEARSAL_KEEP_CODEXBAR=1; shift ;;
      --skip-firmware-baseline) REHEARSAL_SKIP_FIRMWARE_BASELINE=1; shift ;;
      --restore) REHEARSAL_RESTORE=1; shift ;;
      --restore-from)
        [[ -n "${2:-}" ]] || rehearsal::die '--restore-from needs a run directory name'
        REHEARSAL_RESTORE=1; REHEARSAL_RESTORE_FROM="$2"; shift 2 ;;
      --yes|-y) REHEARSAL_ASSUME_YES=1; shift ;;
      -h|--help) rehearsal::usage; exit 0 ;;
      *) rehearsal::usage >&2; rehearsal::die "unknown argument: $1" ;;
    esac
  done
}

# --------------------------------------------------------------- run directory

rehearsal::open_run_dir() {
  local stamp
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  REHEARSAL_RUN_DIR="$REHEARSAL_STATE_DIR/runs/${REHEARSAL_MODE}-${stamp}"
  REHEARSAL_BACKUP_DIR="$REHEARSAL_RUN_DIR/backup"
  REHEARSAL_SERVE_DIR="$REHEARSAL_STATE_DIR/serve"
  REHEARSAL_LOG="$REHEARSAL_RUN_DIR/rehearsal.log"
  mkdir -p "$REHEARSAL_RUN_DIR" "$REHEARSAL_BACKUP_DIR"
  : > "$REHEARSAL_RUN_DIR/facts.tsv"
  # Mirror everything into the log while keeping the terminal readable.
  exec > >(tee -a "$REHEARSAL_LOG") 2>&1
  ln -sfn "$REHEARSAL_RUN_DIR" "$REHEARSAL_STATE_DIR/latest"
  rehearsal::record mode "$REHEARSAL_MODE"
  rehearsal::record startedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}

# --------------------------------------------------------------- device helpers

rehearsal::device_hello() {
  local target="$1" timeout="${2:-8}"
  curl -fsS --connect-timeout "$timeout" -m "$timeout" "${target%/}/hello" 2>/dev/null || return 1
}

# Finds the VibeTV: explicit flag, remembered target, stored config, then a
# parallel sweep of the ARP table. The remembered target survives a purge, which
# is what keeps a second rehearsal from re-scanning the whole subnet.
rehearsal::discover_device() {
  local remembered="$REHEARSAL_STATE_DIR/device-target"

  if [[ -n "$REHEARSAL_DEVICE_TARGET" ]]; then
    rehearsal::device_hello "$REHEARSAL_DEVICE_TARGET" >/dev/null \
      || rehearsal::die "no VibeTV answered at $REHEARSAL_DEVICE_TARGET"
    printf '%s\n' "$REHEARSAL_DEVICE_TARGET" > "$remembered"
    return 0
  fi

  local candidate
  for candidate in \
    "$(cat "$remembered" 2>/dev/null || true)" \
    "$(python3 -c '
import json, sys
try:
    print(json.load(open(sys.argv[1])).get("deviceTarget") or "")
except Exception:
    print("")
' "$REHEARSAL_SUPPORT_DIR/config.json" 2>/dev/null || true)"
  do
    if [[ -n "$candidate" ]] && rehearsal::device_hello "$candidate" 3 >/dev/null; then
      REHEARSAL_DEVICE_TARGET="$candidate"
      printf '%s\n' "$candidate" > "$remembered"
      return 0
    fi
  done

  rehearsal::info 'scanning the local network for a VibeTV...'
  local sweep
  sweep="$(mktemp -d)"
  local ip
  for ip in $(arp -a 2>/dev/null | sed -n 's/.*(\([0-9.]*\)).*/\1/p' | sort -u); do
    (
      if curl -fsS --connect-timeout 2 -m 2 "http://$ip/hello" 2>/dev/null | grep -q '"kind":"hello"'; then
        printf '%s\n' "http://$ip" > "$sweep/hit.$ip"
      fi
    ) &
  done
  wait

  local hit
  hit="$(cat "$sweep"/hit.* 2>/dev/null | head -1)"
  rm -rf "$sweep"
  [[ -n "$hit" ]] || rehearsal::die 'could not find a VibeTV; pass --device-target http://<ip>'
  REHEARSAL_DEVICE_TARGET="$hit"
  printf '%s\n' "$hit" > "$remembered"
}

rehearsal::device_field() {
  local target="$1" field="$2"
  rehearsal::device_hello "$target" | python3 -c "
import json, sys
try:
    print(json.load(sys.stdin).get('$field') or '')
except Exception:
    print('')
" 2>/dev/null || printf ''
}

# Reads the stored pairing token before the purge destroys it.
rehearsal::capture_device_token() {
  [[ -f "$REHEARSAL_SUPPORT_DIR/config.json" ]] || return 0
  python3 -c '
import json, sys
try:
    print(json.load(open(sys.argv[1])).get("deviceToken") or "")
except Exception:
    print("")
' "$REHEARSAL_SUPPORT_DIR/config.json" 2>/dev/null > "$REHEARSAL_RUN_DIR/device-token" || true
  chmod 600 "$REHEARSAL_RUN_DIR/device-token" 2>/dev/null || true
}

# --------------------------------------------------------------- purge / restore

rehearsal::stop_runtime() {
  local label
  for label in $(launchctl list 2>/dev/null | awk '{print $3}' | grep -E "^${REHEARSAL_BUNDLE_ID}" || true); do
    rehearsal::info "stopping launch agent $label"
    launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1 || true
  done
  osascript -e 'tell application "VibeTV Control Center" to quit' >/dev/null 2>&1 || true
  pkill -f "$REHEARSAL_APP_PATH/Contents/MacOS/VibeTVControlCenter" >/dev/null 2>&1 || true
  pkill -f 'codexbar-display daemon' >/dev/null 2>&1 || true
  sleep 2
}

# Moves a path into the backup directory, preserving its layout.
rehearsal::stash() {
  local path="$1"
  [[ -e "$path" ]] || return 0
  local relative="${path#"$HOME"/}"
  local destination="$REHEARSAL_BACKUP_DIR/$relative"
  mkdir -p "$(dirname "$destination")"
  mv "$path" "$destination"
  rehearsal::info "stashed $path"
  printf '%s\n' "$path" >> "$REHEARSAL_BACKUP_DIR/manifest.txt"
}

rehearsal::purge_mac() {
  rehearsal::step 'Purging every VibeTV and CodexBar trace from this Mac'
  rehearsal::stop_runtime

  # Clear any override this or an earlier rehearsal left behind.
  launchctl unsetenv "$REHEARSAL_FIRMWARE_ENV_VAR" >/dev/null 2>&1 || true
  launchctl unsetenv "$REHEARSAL_MAC_RELEASE_ENV_VAR" >/dev/null 2>&1 || true
  defaults delete "$REHEARSAL_BUNDLE_ID" >/dev/null 2>&1 || true

  rehearsal::stash "$REHEARSAL_APP_PATH"
  rehearsal::stash "$REHEARSAL_SUPPORT_DIR"
  rehearsal::stash "$HOME/Library/Preferences/${REHEARSAL_BUNDLE_ID}.plist"
  rehearsal::stash "$HOME/Library/Caches/$REHEARSAL_BUNDLE_ID"
  rehearsal::stash "$HOME/Library/Caches/org.sparkle-project.Sparkle/$REHEARSAL_BUNDLE_ID"

  local agent
  for agent in "$HOME/Library/LaunchAgents/${REHEARSAL_BUNDLE_ID}"*.plist; do
    [[ -e "$agent" ]] && rehearsal::stash "$agent"
  done

  if [[ "$REHEARSAL_KEEP_CODEXBAR" == 1 ]]; then
    rehearsal::info 'keeping ~/.codexbar (--keep-codexbar)'
  else
    rehearsal::stash "$HOME/.codexbar"
  fi

  # cfprefsd caches preferences in memory; without this the old SUFeedURL survives.
  killall cfprefsd >/dev/null 2>&1 || true
  rehearsal::record purgeBackup "$REHEARSAL_BACKUP_DIR"
  rehearsal::info "backup kept at $REHEARSAL_BACKUP_DIR"
}

rehearsal::installed_app_version() {
  /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' \
    "$REHEARSAL_APP_PATH/Contents/Info.plist" 2>/dev/null || true
}

rehearsal::restore() {
  # A rehearsal on an already-purged Mac stashes nothing, so restore has to walk
  # back to the newest run that actually captured something. After cold+warm
  # that newest run holds the candidate state, not the pre-session Mac, so
  # --restore-from names the run that does.
  local backup="" candidate
  if [[ -n "$REHEARSAL_RESTORE_FROM" ]]; then
    candidate="$REHEARSAL_STATE_DIR/runs/$REHEARSAL_RESTORE_FROM"
    [[ -s "$candidate/backup/manifest.txt" ]] \
      || rehearsal::die "run $REHEARSAL_RESTORE_FROM has no restorable backup"
    backup="$candidate/backup"
  fi
  if [[ -z "$backup" ]]; then
    for candidate in $(ls -1dt "$REHEARSAL_STATE_DIR"/runs/*/ 2>/dev/null); do
      if [[ -s "${candidate}backup/manifest.txt" ]]; then
        backup="${candidate}backup"
        break
      fi
    done
  fi
  [[ -n "$backup" ]] \
    || rehearsal::die "no rehearsal with a restorable backup found under $REHEARSAL_STATE_DIR/runs"

  rehearsal::step "Restoring the state captured in $(dirname "$backup")"
  rehearsal::stop_runtime
  rehearsal::stop_artifact_server
  launchctl unsetenv "$REHEARSAL_FIRMWARE_ENV_VAR" >/dev/null 2>&1 || true
  launchctl unsetenv "$REHEARSAL_MAC_RELEASE_ENV_VAR" >/dev/null 2>&1 || true
  defaults delete "$REHEARSAL_BUNDLE_ID" SUFeedURL >/dev/null 2>&1 || true
  killall cfprefsd >/dev/null 2>&1 || true

  local path relative source
  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    relative="${path#"$HOME"/}"
    source="$backup/$relative"
    [[ -e "$source" ]] || continue
    rm -rf "$path"
    mkdir -p "$(dirname "$path")"
    mv "$source" "$path"
    rehearsal::info "restored $path"
  done < "$backup/manifest.txt"

  rehearsal::info 'restore complete; open VibeTV Control Center to bring the runtime back'
}

# --------------------------------------------------------------- candidate artifacts

# Resolves the newest successful merge-gate run and downloads its signed candidate.
rehearsal::fetch_candidate() {
  rehearsal::step 'Fetching the signed merge-gate candidate'
  rehearsal::require_tools gh

  if [[ -z "$REHEARSAL_RUN_ID" ]]; then
    # A merge gate that ends red still uploads its candidate: the guest tests
    # run after sign-and-package. Insisting on --status success sends a
    # rehearsal off to build an older PR's code, which is worse than useless.
    rehearsal::info 'looking for the newest CODEX Test VibeTV Merge run with a candidate'
    local run_id
    for run_id in $(gh run list --repo "$REHEARSAL_REPOSITORY" \
      --workflow vibetv-merge-gate.yml --limit 12 \
      --json databaseId --jq '.[].databaseId' 2>/dev/null || true); do
      if gh api "repos/$REHEARSAL_REPOSITORY/actions/runs/$run_id/artifacts" \
        --jq '.artifacts[].name' 2>/dev/null \
        | grep -qx "CODEX-vibetv-merge-candidate-$run_id"; then
        REHEARSAL_RUN_ID="$run_id"
        break
      fi
    done
  fi
  [[ -n "$REHEARSAL_RUN_ID" ]] || rehearsal::die 'no merge-gate run with a candidate found; pass --run-id'

  local cache="$REHEARSAL_STATE_DIR/candidates/$REHEARSAL_RUN_ID"
  if [[ -f "$cache/dist/macos/candidate-manifest.json" ]]; then
    rehearsal::info "reusing cached candidate $REHEARSAL_RUN_ID"
  else
    mkdir -p "$cache"
    rehearsal::info "downloading candidate artifacts of run $REHEARSAL_RUN_ID (~110 MB)"
    gh run download "$REHEARSAL_RUN_ID" --repo "$REHEARSAL_REPOSITORY" \
      -n "CODEX-vibetv-merge-candidate-$REHEARSAL_RUN_ID" -D "$cache" \
      || rehearsal::die "could not download candidate artifacts of run $REHEARSAL_RUN_ID (expired?)"
  fi

  CANDIDATE_DIR="$cache"
  CANDIDATE_MANIFEST="$cache/dist/macos/candidate-manifest.json"
  CANDIDATE_DMG="$cache/dist/macos/VibeTV-Control-Center.dmg"
  CANDIDATE_APPCAST="$cache/dist/macos/appcast.xml"
  CANDIDATE_FIRMWARE="$cache/tmp/vibetv-merge/firmware.bin"
  CANDIDATE_FIRMWARE_MANIFEST="$cache/tmp/vibetv-merge/firmware-manifest.json"

  local file
  for file in "$CANDIDATE_MANIFEST" "$CANDIDATE_DMG" "$CANDIDATE_APPCAST" \
              "$CANDIDATE_FIRMWARE" "$CANDIDATE_FIRMWARE_MANIFEST"; do
    [[ -f "$file" ]] || rehearsal::die "candidate is incomplete, missing $(basename "$file")"
  done

  CANDIDATE_SHA="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["sourceSha"])' "$CANDIDATE_MANIFEST")"
  CANDIDATE_VERSION="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' "$CANDIDATE_MANIFEST")"

  rehearsal::verify_candidate_checksums
  rehearsal::check_candidate_matches_pr

  rehearsal::info "candidate version $CANDIDATE_VERSION from commit ${CANDIDATE_SHA:0:12}"
  rehearsal::record candidateRunId "$REHEARSAL_RUN_ID"
  rehearsal::record candidateVersion "$CANDIDATE_VERSION"
  rehearsal::record candidateSha "$CANDIDATE_SHA"
}

# The manifest carries a sha256 per artifact; a mismatch means a corrupted download.
rehearsal::verify_candidate_checksums() {
  python3 - "$CANDIDATE_MANIFEST" "$CANDIDATE_DIR" <<'PY' || rehearsal::die 'candidate checksum verification failed'
import hashlib, json, pathlib, sys

manifest_path, root = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
manifest = json.loads(manifest_path.read_text())
locations = {
    "signed-dmg": "dist/macos/VibeTV-Control-Center.dmg",
    "sparkle-appcast": "dist/macos/appcast.xml",
    "companion": "tmp/vibetv-merge/codexbar-display",
    "firmware": "tmp/vibetv-merge/firmware.bin",
    "firmware-manifest": "tmp/vibetv-merge/firmware-manifest.json",
    "virtual-vibetv": "tmp/vibetv-merge/virtual-vibetv",
}
failed = False
for artifact in manifest["artifacts"]:
    relative = locations.get(artifact["role"])
    if relative is None:
        continue
    path = root / relative
    if not path.exists():
        print(f"   missing {relative}")
        failed = True
        continue
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != artifact["sha256"]:
        print(f"   checksum mismatch for {relative}")
        failed = True
raise SystemExit(1 if failed else 0)
PY
  rehearsal::info 'candidate checksums verified against the signed manifest'
}

# Guards against rehearsing a candidate that no longer matches the PR head.
rehearsal::check_candidate_matches_pr() {
  [[ -n "$REHEARSAL_PR" ]] || return 0
  local head
  head="$(gh pr view "$REHEARSAL_PR" --repo "$REHEARSAL_REPOSITORY" --json headRefOid --jq .headRefOid 2>/dev/null || true)"
  [[ -n "$head" ]] || { rehearsal::warn "could not read PR #$REHEARSAL_PR head; skipping match check"; return 0; }
  rehearsal::record prHeadSha "$head"
  if [[ "$head" != "$CANDIDATE_SHA" ]]; then
    rehearsal::warn "candidate is ${CANDIDATE_SHA:0:12} but PR #$REHEARSAL_PR head is ${head:0:12}"
    rehearsal::warn 're-run the merge gate for this PR to rehearse the exact head'
    rehearsal::confirm 'Continue with the older candidate anyway?'
  else
    rehearsal::info "candidate matches PR #$REHEARSAL_PR head exactly"
  fi
}

# --------------------------------------------------------------- artifact server

# Serves the candidate DMG, appcast and firmware on loopback so the installed
# app can update itself exactly the way it would from the real release.
rehearsal::start_artifact_server() {
  rehearsal::step 'Publishing the candidate on a local server'
  rehearsal::stop_artifact_server

  rm -rf "$REHEARSAL_SERVE_DIR"
  mkdir -p "$REHEARSAL_SERVE_DIR"
  cp "$CANDIDATE_DMG" "$REHEARSAL_SERVE_DIR/VibeTV-Control-Center.dmg"
  cp "$CANDIDATE_APPCAST" "$REHEARSAL_SERVE_DIR/appcast.xml"
  cp "$CANDIDATE_FIRMWARE" "$REHEARSAL_SERVE_DIR/firmware.bin"
  cp "$CANDIDATE_FIRMWARE_MANIFEST" "$REHEARSAL_SERVE_DIR/firmware-manifest.json"

  # The Updates tab reads the available Mac App version from the GitHub releases
  # API, not from the Sparkle appcast, so the candidate has to be announced here
  # as well or the card keeps claiming the app is up to date.
  printf '{"tag_name": "v%s"}\n' "$CANDIDATE_VERSION" > "$REHEARSAL_SERVE_DIR/mac-app-release.json"

  python3 - "$REHEARSAL_SERVE_DIR" <<'PY' > "$REHEARSAL_RUN_DIR/artifact-server.log" 2>&1 &
import http.server, os, pathlib, socketserver, sys

root = pathlib.Path(sys.argv[1])
os.chdir(root)

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(fmt % args, flush=True)

with socketserver.TCPServer(("127.0.0.1", 0), Handler) as server:
    (root / "port").write_text(str(server.server_address[1]), encoding="utf-8")
    server.serve_forever()
PY
  local server_pid=$!
  printf '%s\n' "$server_pid" > "$REHEARSAL_STATE_DIR/artifact-server.pid"
  disown "$server_pid" 2>/dev/null || true

  local attempt
  for attempt in $(seq 1 30); do
    [[ -s "$REHEARSAL_SERVE_DIR/port" ]] && break
    sleep 1
  done
  [[ -s "$REHEARSAL_SERVE_DIR/port" ]] || rehearsal::die 'local artifact server did not start'

  REHEARSAL_SERVER_URL="http://127.0.0.1:$(cat "$REHEARSAL_SERVE_DIR/port")"

  # The EdDSA signature covers the DMG bytes, not the URL, so pointing the
  # enclosure at loopback keeps the appcast signature valid.
  python3 - "$REHEARSAL_SERVE_DIR/appcast.xml" "$REHEARSAL_SERVER_URL/VibeTV-Control-Center.dmg" <<'PY'
import re, sys

path, url = sys.argv[1:]
data = open(path, encoding="utf-8").read()
patched, count = re.subn(r'(<enclosure[^>]*\burl=")[^"]+(")', lambda m: m.group(1) + url + m.group(2), data)
if count != 1:
    raise SystemExit(f"expected exactly one enclosure url, patched {count}")
open(path, "w", encoding="utf-8").write(patched)
PY

  # The candidate ships a manifest template whose firmwareUrl is the bare asset
  # name. The companion does not resolve it against the manifest URL, so it has
  # to be made absolute here or the download fails with "unsupported protocol
  # scheme".
  python3 - "$REHEARSAL_SERVE_DIR/firmware-manifest.json" "$REHEARSAL_SERVER_URL" <<'PY'
import json, sys, urllib.parse

path, base = sys.argv[1:]
manifest = json.loads(open(path, encoding="utf-8").read())
patched = 0
for artifact in manifest.get("artifacts", []):
    url = str(artifact.get("firmwareUrl") or "")
    if not urllib.parse.urlparse(url).scheme:
        artifact["firmwareUrl"] = f"{base}/{url.lstrip('/')}"
        patched += 1
if patched == 0:
    raise SystemExit("expected at least one relative firmwareUrl to rewrite")
with open(path, "w", encoding="utf-8") as destination:
    json.dump(manifest, destination, indent=2)
    destination.write("\n")
PY

  curl -fsS -m 5 "$REHEARSAL_SERVER_URL/appcast.xml" >/dev/null \
    || rehearsal::die 'local artifact server is not answering'
  rehearsal::info "serving candidate at $REHEARSAL_SERVER_URL (pid $server_pid)"
  rehearsal::record artifactServer "$REHEARSAL_SERVER_URL"
}

rehearsal::stop_artifact_server() {
  local pid_file="$REHEARSAL_STATE_DIR/artifact-server.pid"
  [[ -f "$pid_file" ]] || return 0
  local pid
  pid="$(cat "$pid_file")"
  if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
    kill "$pid" >/dev/null 2>&1 || true
  fi
  rm -f "$pid_file"
}

# --------------------------------------------------------------- app installation

# Installs an app bundle from a DMG, verifying the notarised signature first.
rehearsal::install_dmg() {
  local dmg="$1" label="$2"

  rehearsal::info "verifying the $label DMG signature"
  spctl --assess --type open --context context:primary-signature "$dmg" >/dev/null 2>&1 \
    || rehearsal::warn "$label DMG is not notarised for open assessment"

  # These images carry a GPT partition table, where -mountpoint is ignored, so
  # the real mount point has to come out of hdiutil's own plist.
  local attach_plist mount
  attach_plist="$(hdiutil attach -readonly -nobrowse -plist "$dmg" 2>/dev/null)" \
    || rehearsal::die "could not mount the $label DMG"
  mount="$(printf '%s' "$attach_plist" | python3 -c '
import plistlib, sys
entities = plistlib.loads(sys.stdin.buffer.read()).get("system-entities", [])
for entity in entities:
    if entity.get("mount-point"):
        print(entity["mount-point"])
        break
')"
  [[ -n "$mount" && -d "$mount" ]] || rehearsal::die "the $label DMG did not mount"

  local source="$mount/VibeTV Control Center.app"
  if [[ ! -d "$source" ]]; then
    hdiutil detach "$mount" >/dev/null 2>&1 || true
    rehearsal::die "the $label DMG contains no VibeTV Control Center.app"
  fi

  rm -rf "$REHEARSAL_APP_PATH"
  ditto "$source" "$REHEARSAL_APP_PATH"
  hdiutil detach "$mount" >/dev/null 2>&1 || true

  codesign --verify --deep --strict "$REHEARSAL_APP_PATH" >/dev/null 2>&1 \
    || rehearsal::warn 'installed app failed codesign verification'

  local version
  version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' \
    "$REHEARSAL_APP_PATH/Contents/Info.plist" 2>/dev/null || echo unknown)"
  rehearsal::info "installed $label VibeTV Control Center $version"
  rehearsal::record "${label}AppVersion" "$version"
  REHEARSAL_INSTALLED_VERSION="$version"
}

# Reads one field from a companion binary's `version --json`.
rehearsal::companion_field() {
  "$1" version --json 2>/dev/null | python3 -c '
import json, sys
try:
    print(json.load(sys.stdin).get(sys.argv[1]) or "unknown")
except Exception:
    print("unknown")
' "$2"
}

# rehearsal::stop_runtime bootouts every agent under the bundle id, and the
# override's standalone agent is one of them. The app's own bundled agent never
# starts after an override, so without this the Mac is left with no runtime and
# the app opens on "VibeTV couldn't start". Safe to call when no override is in
# play: there is no user plist then.
rehearsal::bootstrap_override_runtime() {
  local user_plist="$HOME/Library/LaunchAgents/${REHEARSAL_BUNDLE_ID}.runtime.plist"
  [[ -f "$user_plist" ]] || return 0
  launchctl bootout "gui/$(id -u)/${REHEARSAL_BUNDLE_ID}.runtime" >/dev/null 2>&1 || true
  local bootstrap_error
  if bootstrap_error="$(launchctl bootstrap "gui/$(id -u)" "$user_plist" 2>&1)"; then
    rehearsal::info 'restarted the overridden runtime agent'
    return 0
  fi
  rehearsal::die "launchd rejected the runtime agent at $user_plist: ${bootstrap_error:-unknown error}"
}

# Replaces the installed app's companion helper with a locally built one, for
# companion- and API-level checks. The Mac App itself will not come up
# afterwards: see the ad-hoc warning below.
rehearsal::apply_companion_override() {
  [[ -n "$REHEARSAL_COMPANION_OVERRIDE" ]] || return 0
  local source="$REHEARSAL_COMPANION_OVERRIDE"
  [[ -x "$source" ]] || rehearsal::die "companion override is not executable: $source"

  local helper="$REHEARSAL_APP_PATH/Contents/Helpers/codexbar-display"
  [[ -f "$helper" ]] || rehearsal::die "no companion helper to replace at $helper"

  local version commit app_version
  version="$(rehearsal::companion_field "$source" version)"
  commit="$(rehearsal::companion_field "$source" commit)"
  app_version="$(rehearsal::installed_app_version)"

  # The app starts only once its Companion reports the bundle's own version, and
  # an unstamped `go build` leaves that at 1.0.0. Worse, the app then blames a
  # port conflict on whatever owns 47832 -- including its own runtime -- so the
  # run dead-ends pointing at the wrong problem. Refuse before the bundle is
  # touched rather than after the flash.
  if [[ "$version" != "$app_version" ]]; then
    rehearsal::die "companion override reports version $version but the installed app is $app_version.
   Build it with the version the app expects:
     (cd apps/control-center && npm ci && npm run build:local)
     rm -rf companion/internal/companionapi/controlcenter_static
     mkdir -p companion/internal/companionapi/controlcenter_static
     cp -R apps/control-center/out-local/. companion/internal/companionapi/controlcenter_static/
     (cd companion && CGO_ENABLED=0 go build -o '$source' \\
       -ldflags '-X github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/buildinfo.Version=$app_version' \\
       ./cmd/codexbar-display)"
  fi

  rehearsal::step 'Swapping in the locally built companion'
  rehearsal::warn 'this replaces a notarised binary; the app is re-signed ad-hoc'
  # Proven on the bench 2026-08-20: SMAppService keeps the Developer ID launch
  # constraint from the production install, so after the ad-hoc re-sign the
  # app's own runtime registration fails and the Mac App stops at "VibeTV's
  # background service couldn't start" -- with a healthy, correctly versioned
  # runtime still listening on 47832. The user-owned agent below keeps the
  # Companion serving for API-level checks; it cannot rescue the app. Build the
  # app with --local-preview to drive a local build through the real UI.
  rehearsal::warn 'the Mac App will not start against an ad-hoc signature; use build-macos-control-center-app.sh --local-preview for UI work'
  cp -f "$source" "$helper"
  codesign --force --deep --sign - "$REHEARSAL_APP_PATH" >/dev/null 2>&1 \
    || rehearsal::die 'could not re-sign the app after the override'
  # The app's own agent lives inside the bundle and never starts after an
  # override, so the same agent is registered from a user-owned path.
  local agent_plist="$REHEARSAL_APP_PATH/Contents/Library/LaunchAgents/${REHEARSAL_BUNDLE_ID}.runtime.plist"
  if [[ -f "$agent_plist" ]]; then
    local user_plist="$HOME/Library/LaunchAgents/${REHEARSAL_BUNDLE_ID}.runtime.plist"
    mkdir -p "$HOME/Library/LaunchAgents"
    python3 - "$agent_plist" "$user_plist" "$helper" <<'PY'
import plistlib, sys

source, destination, helper = sys.argv[1:]
with open(source, "rb") as handle:
    agent = plistlib.load(handle)
# The bundled agent relies on the app resolving a bare program name; a
# standalone agent needs the absolute path. BundleProgram is only valid for an
# agent hosted by an app bundle -- leaving it beside Program makes launchd
# reject the whole plist with "Bootstrap failed: 5: Input/output error".
agent.pop("BundleProgram", None)
agent["Program"] = helper
arguments = list(agent.get("ProgramArguments") or [])
if arguments:
    arguments[0] = helper
agent["ProgramArguments"] = arguments
with open(destination, "wb") as handle:
    plistlib.dump(agent, handle)
PY
    launchctl bootout "gui/$(id -u)/${REHEARSAL_BUNDLE_ID}.runtime" >/dev/null 2>&1 || true
    local bootstrap_error
    if bootstrap_error="$(launchctl bootstrap "gui/$(id -u)" "$user_plist" 2>&1)"; then
      rehearsal::info 'registered the runtime agent from a user-owned path'
      rehearsal::record runtimeAgentSource "$user_plist"
    else
      # Do not fall back to running the runtime detached: it would take port
      # 47832 and the app itself then refuses to start with "VibeTV couldn't
      # start".
      rehearsal::die "launchd rejected the runtime agent at $user_plist: ${bootstrap_error:-unknown error}"
    fi
  fi

  rehearsal::info "companion is now $version from commit ${commit:0:12}"
  rehearsal::record companionOverride "$source"
  rehearsal::record companionOverrideCommit "$commit"
  rehearsal::record notarisationIntact false
}

rehearsal::download_release_dmg() {
  local tag="$1"
  local cache="$REHEARSAL_STATE_DIR/releases/$tag"
  mkdir -p "$cache"
  if [[ ! -f "$cache/VibeTV-Control-Center.dmg" ]]; then
    rehearsal::info "downloading the public $tag DMG"
    curl -fsSL -m 900 -o "$cache/VibeTV-Control-Center.dmg" \
      "https://github.com/$REHEARSAL_REPOSITORY/releases/download/$tag/VibeTV-Control-Center.dmg" \
      || rehearsal::die "could not download the $tag DMG"
  fi
  printf '%s\n' "$cache/VibeTV-Control-Center.dmg"
}

# Resolves the newest public release tag, which is what customers run today.
rehearsal::resolve_current_public_release() {
  local tag
  tag="$(gh release list --repo "$REHEARSAL_REPOSITORY" --limit 20 \
    --json tagName,isDraft,isPrerelease \
    --jq '[.[] | select(.isDraft == false and .isPrerelease == false) | .tagName] | .[0]' 2>/dev/null || true)"
  [[ -n "$tag" ]] || rehearsal::die 'could not resolve the current public release'
  printf '%s\n' "$tag"
}

# --------------------------------------------------------------- firmware

# Runs the same install-update path the Updates tab uses.
rehearsal::flash_firmware() {
  local manifest_url="$1" expected_version="$2" force="${3:-0}"
  # An override is the companion under test, so it also drives the flashes that
  # happen before the app is installed.
  local helper="${REHEARSAL_COMPANION_OVERRIDE:-$REHEARSAL_APP_PATH/Contents/Helpers/codexbar-display}"
  [[ -x "$helper" ]] || rehearsal::die "companion helper missing at $helper"

  local args=(install-update --target "$REHEARSAL_DEVICE_TARGET" --confirm-live-update
              --manifest-url "$manifest_url" --verbose)
  [[ "$force" == 1 ]] && args+=(--force)

  # The single-writer rule: the streaming runtime must not talk to the device
  # while the OTA runs, so we deliberately do NOT pass --skip-launchagent-pause.
  rehearsal::info "flashing firmware $expected_version (this takes a few minutes)"
  if "$helper" "${args[@]}" > "$REHEARSAL_RUN_DIR/firmware-${expected_version}.log" 2>&1; then
    rehearsal::info "firmware $expected_version installed"
    rehearsal::record "firmware_${expected_version}" installed
    return 0
  fi

  rehearsal::warn "firmware flash to $expected_version failed"
  rehearsal::warn "see $REHEARSAL_RUN_DIR/firmware-${expected_version}.log"
  tail -n 6 "$REHEARSAL_RUN_DIR/firmware-${expected_version}.log" | sed 's/^/      /'
  rehearsal::record "firmware_${expected_version}" failed
  return 1
}

rehearsal::wait_for_device_firmware() {
  local expected="$1" deadline=$((SECONDS + 180))
  while ((SECONDS < deadline)); do
    local actual
    actual="$(rehearsal::device_field "$REHEARSAL_DEVICE_TARGET" firmware)"
    [[ "$actual" == "$expected" ]] && return 0
    sleep 5
  done
  return 1
}

# --------------------------------------------------------------- reporting

rehearsal::write_report() {
  local outcome="$1"
  rehearsal::record finishedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  rehearsal::record outcome "$outcome"

  python3 - "$REHEARSAL_RUN_DIR/facts.tsv" "$REHEARSAL_RUN_DIR/report.json" <<'PY'
import json, sys

facts_path, output_path = sys.argv[1:]
facts = {}
with open(facts_path, encoding="utf-8") as source:
    for line in source:
        key, _, value = line.rstrip("\n").partition("\t")
        if key:
            facts[key] = value
with open(output_path, "w", encoding="utf-8") as destination:
    json.dump(facts, destination, indent=2, sort_keys=True)
    destination.write("\n")
PY
  rehearsal::info "report written to $REHEARSAL_RUN_DIR/report.json"
}

# Single writer: exactly one app instance and one runtime may ever be live.
# Never use `open -n` here -- it forces a second instance, and two instances
# fight over port 47832 and over the device.
rehearsal::open_app() {
  local running
  running="$({ pgrep -f "$REHEARSAL_APP_PATH/Contents/MacOS/VibeTVControlCenter" || true; } | grep -c . || true)"
  if [[ "$running" != 0 ]]; then
    rehearsal::warn "$running VibeTV Control Center instance(s) already running; not starting another"
    return 0
  fi
  open -a "$REHEARSAL_APP_PATH" >/dev/null 2>&1 || true
  sleep 3

  running="$({ pgrep -f "$REHEARSAL_APP_PATH/Contents/MacOS/VibeTVControlCenter" || true; } | grep -c . || true)"
  rehearsal::record appInstances "$running"
  [[ "$running" -le 1 ]] \
    || rehearsal::die "single-writer violation: $running app instances are running"
}
