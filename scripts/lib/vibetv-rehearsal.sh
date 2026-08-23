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
REHEARSAL_MAIN=0
REHEARSAL_MAIN_SHA=""
REHEARSAL_PR=""
REHEARSAL_RUN_ID=""
REHEARSAL_DEVICE_TARGET=""
REHEARSAL_ASSUME_YES=0
REHEARSAL_RESTORE=0
REHEARSAL_KEEP_CODEXBAR=0
REHEARSAL_SKIP_FIRMWARE_BASELINE=0
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

  --main                 Rehearse the current main tip against the published
                         release: its release candidate is the candidate
  --pr <number>          Pull request whose merge-gate candidate to install (default: $REHEARSAL_PR)
  --run-id <id>          Use an explicit candidate run instead of resolving one
  --device-target <url>  VibeTV base URL, e.g. http://192.168.178.72 (default: autodetect)
  --companion-override <path>
                         Swap the installed app's companion helper for a locally
                         built one. Use to rehearse a fix that has no signed CI
                         candidate yet. Breaks notarisation, so the app is
                         re-signed ad-hoc and the report records it.
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
      --main) REHEARSAL_MAIN=1; shift ;;
      --pr) [[ -n "${2:-}" ]] || rehearsal::die '--pr needs a value'; REHEARSAL_PR="$2"; shift 2 ;;
      --run-id) [[ -n "${2:-}" ]] || rehearsal::die '--run-id needs a value'; REHEARSAL_RUN_ID="$2"; shift 2 ;;
      --device-target) [[ -n "${2:-}" ]] || rehearsal::die '--device-target needs a value'; REHEARSAL_DEVICE_TARGET="$2"; shift 2 ;;
      --companion-override)
        [[ -n "${2:-}" ]] || rehearsal::die '--companion-override needs a path'
        REHEARSAL_COMPANION_OVERRIDE="$2"; shift 2 ;;
      --keep-codexbar) REHEARSAL_KEEP_CODEXBAR=1; shift ;;
      --skip-firmware-baseline) REHEARSAL_SKIP_FIRMWARE_BASELINE=1; shift ;;
      --restore) REHEARSAL_RESTORE=1; shift ;;
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

rehearsal::restore() {
  # A rehearsal on an already-purged Mac stashes nothing, so restore has to walk
  # back to the newest run that actually captured something.
  local backup="" candidate
  for candidate in $(ls -1dt "$REHEARSAL_STATE_DIR"/runs/*/ 2>/dev/null); do
    if [[ -s "${candidate}backup/manifest.txt" ]]; then
      backup="${candidate}backup"
      break
    fi
  done
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

# Downloads the signed candidate for whatever was asked for and resolves its
# artifacts. Both candidate workflows are accepted; see rehearsal::resolve_run_id.
rehearsal::fetch_candidate() {
  rehearsal::step 'Fetching the signed candidate'
  rehearsal::require_tools gh

  rehearsal::resolve_run_id

  local cache="$REHEARSAL_STATE_DIR/candidates/$REHEARSAL_RUN_ID"
  CANDIDATE_DIR="$cache"
  CANDIDATE_MANIFEST="$(rehearsal::candidate_manifest_path "$cache")"

  if [[ -n "$CANDIDATE_MANIFEST" ]]; then
    rehearsal::info "reusing cached candidate $REHEARSAL_RUN_ID"
  else
    # The merge gate builds an open pull request head and suffixes its artifact
    # with the run id. The release candidate builds the exact main SHA and does
    # not suffix it. Only main is releasable, so both have to be rehearsable.
    local artifact
    artifact="$(gh api "repos/$REHEARSAL_REPOSITORY/actions/runs/$REHEARSAL_RUN_ID/artifacts" \
      --jq '.artifacts[].name' 2>/dev/null \
      | grep -Fx -e "CODEX-vibetv-merge-candidate-$REHEARSAL_RUN_ID" -e vibetv-release-candidate \
      | head -n 1)"
    [[ -n "$artifact" ]] || rehearsal::die "run $REHEARSAL_RUN_ID carries no rehearsable candidate artifact"
    mkdir -p "$cache"
    rehearsal::info "downloading $artifact of run $REHEARSAL_RUN_ID (~110 MB)"
    gh run download "$REHEARSAL_RUN_ID" --repo "$REHEARSAL_REPOSITORY" \
      -n "$artifact" -D "$cache" \
      || rehearsal::die "could not download $artifact of run $REHEARSAL_RUN_ID (expired?)"
    CANDIDATE_MANIFEST="$(rehearsal::candidate_manifest_path "$cache")"
    [[ -n "$CANDIDATE_MANIFEST" ]] || rehearsal::die "$artifact carries no candidate-manifest.json"
  fi

  if [[ "$REHEARSAL_MAIN" == 1 ]]; then
    local result="$cache/candidate-result/candidate-result.json"
    if [[ ! -f "$result" ]]; then
      mkdir -p "$(dirname "$result")"
      gh run download "$REHEARSAL_RUN_ID" --repo "$REHEARSAL_REPOSITORY" \
        -n vibetv-release-candidate-result -D "$(dirname "$result")" \
        || rehearsal::die "candidate run $REHEARSAL_RUN_ID has no successful automated result"
    fi
    python3 "$ROOT/scripts/validate-hardware-canary.py" candidate-result \
      --candidate-dir "$cache" --result "$result" >/dev/null \
      || rehearsal::die "candidate run $REHEARSAL_RUN_ID did not pass its automated matrix"
  fi

  CANDIDATE_SHA="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["sourceSha"])' "$CANDIDATE_MANIFEST")"
  CANDIDATE_VERSION="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' "$CANDIDATE_MANIFEST")"

  rehearsal::resolve_candidate_artifacts
  rehearsal::check_candidate_target

  rehearsal::info "candidate version $CANDIDATE_VERSION from commit ${CANDIDATE_SHA:0:12}"
  rehearsal::record candidateRunId "$REHEARSAL_RUN_ID"
  rehearsal::record candidateVersion "$CANDIDATE_VERSION"
  rehearsal::record candidateSha "$CANDIDATE_SHA"
}

# Returns nothing, successfully, when the candidate has not been downloaded yet.
# find exits non-zero on a missing directory and pipefail carries that through
# the pipe, which under set -e would kill the run on its very first download.
rehearsal::candidate_manifest_path() {
  if [[ -d "$1" ]]; then
    find "$1" -maxdepth 3 -name candidate-manifest.json -type f 2>/dev/null | head -n 1 || true
  fi
  return 0
}

# The merge gate and the release candidate lay the same roles out under
# different directories, so the manifest is the only reliable index: it names
# every file and carries its checksum. Resolving through it replaces a
# hard-coded path map and verifies the download in the same pass. The firmware
# binary is taken from the firmware manifest entry for this board, because a
# release candidate publishes one binary per board.
rehearsal::resolve_candidate_artifacts() {
  local resolved
  resolved="$(python3 - "$CANDIDATE_MANIFEST" "$CANDIDATE_DIR" "$REHEARSAL_BOARD" <<'PY'
import hashlib, json, pathlib, shlex, sys

manifest_path, root, board = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3]
manifest = json.loads(manifest_path.read_text())

by_name = {}
for path in root.rglob("*"):
    if path.is_file():
        by_name.setdefault(path.name, []).append(path)

problems = []


def locate(artifact):
    # The release candidate records a path relative to the artifact root, the
    # merge gate records the bare file name.
    path = root / artifact["path"]
    if not path.is_file():
        matches = by_name.get(artifact["name"], [])
        if len(matches) != 1:
            problems.append(f"{artifact['name']}: expected one copy, found {len(matches)}")
            return None
        path = matches[0]
    if hashlib.sha256(path.read_bytes()).hexdigest() != artifact["sha256"]:
        problems.append(f"{artifact['name']}: checksum mismatch")
        return None
    return path


by_role = {}
for artifact in manifest["artifacts"]:
    by_role.setdefault(artifact["role"], []).append(artifact)

resolved, scalars = {}, {}
for role, variable, canonical in (
    ("signed-dmg", "CANDIDATE_DMG", None),
    ("sparkle-appcast", "CANDIDATE_APPCAST", None),
    # A release candidate ships the firmware manifest twice, once stamped with
    # the version. Both are byte-identical; the unstamped one is what a release
    # serves, so that is the one under test.
    ("firmware-manifest", "CANDIDATE_FIRMWARE_MANIFEST", "firmware-manifest.json"),
):
    entries = by_role.get(role, [])
    if canonical is not None:
        entries = [entry for entry in entries if entry["name"] == canonical] or entries
    if len(entries) != 1:
        problems.append(f"{role}: expected one artifact, found {len(entries)}")
        continue
    path = locate(entries[0])
    if path is not None:
        resolved[variable] = path

firmware_manifest = resolved.get("CANDIDATE_FIRMWARE_MANIFEST")
if firmware_manifest is not None:
    entries = json.loads(firmware_manifest.read_text())["artifacts"]
    wanted = [entry for entry in entries if entry.get("board") == board]
    if len(wanted) != 1:
        problems.append(f"firmware manifest lists {len(wanted)} entries for board {board}")
    else:
        asset = pathlib.PurePosixPath(wanted[0].get("asset") or wanted[0]["firmwareUrl"]).name
        binaries = [item for item in by_role.get("firmware", []) if item["name"] == asset]
        if len(binaries) != 1:
            problems.append(f"firmware: {asset} is not in the candidate manifest")
        else:
            path = locate(binaries[0])
            if path is not None:
                resolved["CANDIDATE_FIRMWARE"] = path
                # A release stamps the firmware with its own version, not the
                # release version: 1.0.54 ships firmware 1.0.40. Only merge-gate
                # candidates make the two coincide.
                scalars["CANDIDATE_FIRMWARE_VERSION"] = str(wanted[0]["firmwareVersion"])

if "CANDIDATE_FIRMWARE_VERSION" not in scalars:
    problems.append("firmware: no version resolved for this board")

if problems:
    print("\n".join(f"   {problem}" for problem in problems), file=sys.stderr)
    raise SystemExit(1)

for variable, path in resolved.items():
    print(f"{variable}={shlex.quote(str(path))}")
for variable, value in scalars.items():
    print(f"{variable}={shlex.quote(value)}")
PY
)" || rehearsal::die 'candidate is incomplete or corrupted'
  eval "$resolved"
  rehearsal::info 'candidate checksums verified against the signed manifest'
}

# Resolves which candidate run to rehearse. main is the only releasable state,
# so it gets a first-class path: the release candidate builds the SHA it runs
# on, which makes its head SHA the built SHA. The merge gate cannot serve here
# -- it only ever builds an open pull request head.
rehearsal::resolve_run_id() {
  [[ -z "$REHEARSAL_RUN_ID" ]] || return 0

  if [[ "$REHEARSAL_MAIN" == 1 ]]; then
    rehearsal::main_sha >/dev/null
    rehearsal::info "main is at ${REHEARSAL_MAIN_SHA:0:12}"
    local run_id artifact_names
    while IFS= read -r run_id; do
      [[ -n "$run_id" ]] || continue
      artifact_names="$(gh api \
        "repos/$REHEARSAL_REPOSITORY/actions/runs/$run_id/artifacts" \
        --jq '.artifacts[].name' 2>/dev/null || true)"
      if grep -Fx vibetv-release-candidate <<<"$artifact_names" >/dev/null &&
        grep -Fx vibetv-release-candidate-result <<<"$artifact_names" >/dev/null; then
        REHEARSAL_RUN_ID="$run_id"
        break
      fi
    done < <(gh run list --repo "$REHEARSAL_REPOSITORY" \
      --workflow vibetv-release-candidate.yml --limit 20 \
      --json databaseId,headSha \
      --jq ".[] | select(.headSha == \"$REHEARSAL_MAIN_SHA\") | .databaseId" 2>/dev/null || true)
    [[ -n "$REHEARSAL_RUN_ID" && "$REHEARSAL_RUN_ID" != null ]] || rehearsal::die \
      "no CODEX Prepare and Release VibeTV candidate for main ${REHEARSAL_MAIN_SHA:0:12}; dispatch that workflow for this commit first"
    return 0
  fi

  [[ -n "$REHEARSAL_PR" ]] || rehearsal::die 'nothing to rehearse; pass --main, --pr <number> or --run-id <id>'

  rehearsal::info 'looking for the newest successful CODEX Test VibeTV Merge run'
  REHEARSAL_RUN_ID="$(gh run list --repo "$REHEARSAL_REPOSITORY" \
    --workflow vibetv-merge-gate.yml --status success --limit 1 \
    --json databaseId --jq '.[0].databaseId' 2>/dev/null || true)"
  [[ -n "$REHEARSAL_RUN_ID" ]] || rehearsal::die 'no successful merge-gate run found; pass --run-id'
}

rehearsal::main_sha() {
  if [[ -z "$REHEARSAL_MAIN_SHA" ]]; then
    rehearsal::require_tools git
    REHEARSAL_MAIN_SHA="$(git ls-remote "https://github.com/$REHEARSAL_REPOSITORY" refs/heads/main 2>/dev/null | awk 'NR==1{print $1}')"
    [[ -n "$REHEARSAL_MAIN_SHA" ]] || rehearsal::die 'could not read the main tip'
  fi
  printf '%s\n' "$REHEARSAL_MAIN_SHA"
}

# Guards against rehearsing something other than what was asked for. The merge
# gate is dispatched from main, so every one of its runs reports main as the
# head branch even though it builds a pull request head. Only the candidate
# manifest is truthful, so the comparison happens against that.
rehearsal::check_candidate_target() {
  local label expected
  if [[ "$REHEARSAL_MAIN" == 1 ]]; then
    label=main
    expected="$(rehearsal::main_sha)"
  elif [[ -n "$REHEARSAL_PR" ]]; then
    label="PR #$REHEARSAL_PR"
    expected="$(gh pr view "$REHEARSAL_PR" --repo "$REHEARSAL_REPOSITORY" --json headRefOid --jq .headRefOid 2>/dev/null || true)"
    [[ -n "$expected" ]] || { rehearsal::warn "could not read PR #$REHEARSAL_PR head; skipping match check"; return 0; }
    rehearsal::record prHeadSha "$expected"
  else
    rehearsal::warn "rehearsing ${CANDIDATE_SHA:0:12} without --main or --pr, so what it is stays unverified"
    return 0
  fi

  rehearsal::record candidateTarget "$label"
  if [[ "$expected" != "$CANDIDATE_SHA" ]]; then
    rehearsal::warn "candidate is ${CANDIDATE_SHA:0:12} but $label is ${expected:0:12}"
    rehearsal::confirm "Continue with a candidate that is not $label?"
  else
    rehearsal::info "candidate matches $label exactly (${CANDIDATE_SHA:0:12})"
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
  cp "$CANDIDATE_FIRMWARE_MANIFEST" "$REHEARSAL_SERVE_DIR/firmware-manifest.json"
  # The firmware is resolved through the manifest that names it, so its own file
  # name is the asset name the rewritten URL below will point at. A release
  # candidate names it per version and gzips it, not firmware.bin.
  cp "$CANDIDATE_FIRMWARE" "$REHEARSAL_SERVE_DIR/$(basename "$CANDIDATE_FIRMWARE")"

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

  # The manifest addresses the firmware by a bare asset name (merge gate) or by
  # its published release URL (release candidate, pointing at a release that does
  # not exist yet). Either way the bytes under test are the ones on this loopback
  # server, so the entry for this board is repointed at it. Other boards keep
  # their published URL -- this rehearsal does not flash them.
  python3 - "$REHEARSAL_SERVE_DIR/firmware-manifest.json" "$REHEARSAL_SERVER_URL" \
    "$REHEARSAL_BOARD" "$(basename "$CANDIDATE_FIRMWARE")" <<'PY'
import json, sys

path, base, board, asset = sys.argv[1:]
manifest = json.loads(open(path, encoding="utf-8").read())
patched = 0
for artifact in manifest.get("artifacts", []):
    if artifact.get("board") != board:
        continue
    artifact["firmwareUrl"] = f"{base}/{asset}"
    patched += 1
if patched != 1:
    raise SystemExit(f"expected exactly one firmware entry for board {board}, patched {patched}")
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

# Replaces the installed app's companion helper with a locally built one. This
# is how a fix that has no signed CI candidate yet gets rehearsed on hardware.
rehearsal::apply_companion_override() {
  [[ -n "$REHEARSAL_COMPANION_OVERRIDE" ]] || return 0
  local source="$REHEARSAL_COMPANION_OVERRIDE"
  [[ -x "$source" ]] || rehearsal::die "companion override is not executable: $source"

  local helper="$REHEARSAL_APP_PATH/Contents/Helpers/codexbar-display"
  [[ -f "$helper" ]] || rehearsal::die "no companion helper to replace at $helper"

  rehearsal::step 'Swapping in the locally built companion'
  rehearsal::warn 'this replaces a notarised binary; the app is re-signed ad-hoc'
  cp -f "$source" "$helper"
  codesign --force --deep --sign - "$REHEARSAL_APP_PATH" >/dev/null 2>&1 \
    || rehearsal::die 'could not re-sign the app after the override'

  local version commit
  version="$("$helper" version --json 2>/dev/null | python3 -c '
import json, sys
try:
    print(json.load(sys.stdin).get("version") or "unknown")
except Exception:
    print("unknown")
')"
  commit="$("$helper" version --json 2>/dev/null | python3 -c '
import json, sys
try:
    print(json.load(sys.stdin).get("commit") or "unknown")
except Exception:
    print("unknown")
')"
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
