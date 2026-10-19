#!/usr/bin/env bash
# Warm start: rehearse the update path an existing customer walks.
#
# Puts this Mac and the connected VibeTV into today's public customer state
# (current public Mac App + the firmware that release ships), then publishes the
# candidate from a pull request so both updates appear in the Updates tab.
#
# You then drive the visible customer flow yourself: update the Mac App through
# Sparkle first, then the firmware.
#
#   scripts/vibetv-rehearse-warm-start.sh --pr 348
#   scripts/vibetv-rehearse-warm-start.sh --restore

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/vibetv-rehearsal.sh
source "$ROOT/scripts/lib/vibetv-rehearsal.sh"

REHEARSAL_MODE=warm
rehearsal::parse_args "$@"

if [[ "$REHEARSAL_RESTORE" == 1 ]]; then
  REHEARSAL_RUN_DIR="$(mktemp -d)"
  rehearsal::restore
  exit 0
fi

rehearsal::require_tools curl python3 gh hdiutil ditto codesign
rehearsal::open_run_dir

rehearsal::step 'Checking the connected VibeTV'
rehearsal::discover_device
DEVICE_ID="$(rehearsal::device_field "$REHEARSAL_DEVICE_TARGET" deviceId)"
DEVICE_FIRMWARE="$(rehearsal::device_field "$REHEARSAL_DEVICE_TARGET" firmware)"
DEVICE_BOARD="$(rehearsal::device_field "$REHEARSAL_DEVICE_TARGET" board)"
rehearsal::info "VibeTV $DEVICE_ID ($DEVICE_BOARD) on firmware $DEVICE_FIRMWARE at $REHEARSAL_DEVICE_TARGET"
rehearsal::record deviceId "$DEVICE_ID"
rehearsal::record deviceTarget "$REHEARSAL_DEVICE_TARGET"
rehearsal::record deviceFirmwareBefore "$DEVICE_FIRMWARE"

PUBLIC_TAG="$(rehearsal::resolve_current_public_release)"
rehearsal::info "current public release is $PUBLIC_TAG"
rehearsal::record publicReleaseTag "$PUBLIC_TAG"

PUBLIC_FIRMWARE_MANIFEST_URL="https://github.com/$REHEARSAL_REPOSITORY/releases/download/$PUBLIC_TAG/firmware-manifest.json"
PUBLIC_FIRMWARE_VERSION="$(curl -fsSL -m 60 "$PUBLIC_FIRMWARE_MANIFEST_URL" | python3 -c "
import json, sys
manifest = json.load(sys.stdin)
for artifact in manifest.get('artifacts', []):
    if artifact.get('board') == '$DEVICE_BOARD':
        print(artifact.get('firmwareVersion') or '')
        break
else:
    print('')
")"
[[ -n "$PUBLIC_FIRMWARE_VERSION" ]] \
  || rehearsal::die "release $PUBLIC_TAG ships no firmware for board $DEVICE_BOARD"
rehearsal::info "customer firmware baseline for this board is $PUBLIC_FIRMWARE_VERSION"
rehearsal::record publicFirmwareVersion "$PUBLIC_FIRMWARE_VERSION"

rehearsal::fetch_candidate

cat <<PLAN

This rehearsal will:
  1. put VibeTV $DEVICE_ID on the public customer firmware $PUBLIC_FIRMWARE_VERSION
  2. move every VibeTV and CodexBar file on this Mac into a restorable backup
  3. install the public customer Mac App $PUBLIC_TAG
  4. publish candidate $CANDIDATE_VERSION (commit ${CANDIDATE_SHA:0:12}) on loopback
     so the Updates tab offers the Mac App update and the firmware update

The VibeTV will be written to. Everything removed from this Mac is restorable
with --restore.
PLAN
rehearsal::confirm 'Proceed?'

# --- 1. device onto the public customer firmware -----------------------------
rehearsal::step "Bringing VibeTV to the customer firmware $PUBLIC_FIRMWARE_VERSION"
rehearsal::capture_device_token
# The Mac is only purged in step 2, so the installed runtime is still polling the
# device here and a direct CLI flash refuses to start beside another device
# writer. Stop it before the baseline flash; purge_mac stops it again anyway.
rehearsal::stop_runtime
if [[ "$REHEARSAL_SKIP_FIRMWARE_BASELINE" == 1 ]]; then
  rehearsal::info 'skipping firmware baseline (--skip-firmware-baseline)'
elif [[ "$DEVICE_FIRMWARE" == "$PUBLIC_FIRMWARE_VERSION" ]]; then
  rehearsal::info "already on $PUBLIC_FIRMWARE_VERSION, nothing to flash"
else
  rehearsal::flash_firmware "$PUBLIC_FIRMWARE_MANIFEST_URL" "$PUBLIC_FIRMWARE_VERSION" 1 \
    || rehearsal::die 'could not establish the customer firmware baseline'
  rehearsal::wait_for_device_firmware "$PUBLIC_FIRMWARE_VERSION" \
    || rehearsal::die "VibeTV did not come back on $PUBLIC_FIRMWARE_VERSION"
fi

# --- 2 + 3. clean Mac, install the public customer app ----------------------
rehearsal::purge_mac

rehearsal::step "Installing the public customer Mac App $PUBLIC_TAG"
PUBLIC_DMG="$(rehearsal::download_release_dmg "$PUBLIC_TAG")"
rehearsal::install_dmg "$PUBLIC_DMG" baseline
BASELINE_VERSION="$REHEARSAL_INSTALLED_VERSION"

# --- 4. publish the candidate behind the installed app ----------------------
rehearsal::start_artifact_server

# The launch update (#561) exists only in a baseline built after it. The app logs
# this line when it skips that check, so only such a build carries the text.
app_has_launch_update_check() {
  grep -aq 'skipped its launch update check' \
    "$REHEARSAL_APP_PATH/Contents/MacOS/VibeTVControlCenter" 2>/dev/null
}

wait_for_installed_version() {
  local expected="$1" limit="$2" deadline=$((SECONDS + $2))
  while ((SECONDS < deadline)); do
    if [[ "$(rehearsal::installed_app_version)" == "$expected" ]]; then
      return 0
    fi
    sleep 5
  done
  return 1
}

rehearsal::step 'Pointing the installed app at the candidate'
# Sparkle prefers the user default over the Info.plist feed, so the installed
# public app checks our loopback appcast instead of the GitHub release.
defaults write "$REHEARSAL_BUNDLE_ID" SUFeedURL -string "$REHEARSAL_SERVER_URL/appcast.xml"
# Keeps the baseline from checking on its own while it is set up. Removed again
# below for a baseline with the launch update, so that launch can install.
defaults write "$REHEARSAL_BUNDLE_ID" SUEnableAutomaticChecks -bool false
killall cfprefsd >/dev/null 2>&1 || true
rehearsal::info "SUFeedURL -> $REHEARSAL_SERVER_URL/appcast.xml"

# The companion resolves firmware updates from this env var when it is set.
launchctl setenv "$REHEARSAL_FIRMWARE_ENV_VAR" "$REHEARSAL_SERVER_URL/firmware-manifest.json"
rehearsal::info "firmware manifest -> $REHEARSAL_SERVER_URL/firmware-manifest.json"
rehearsal::record firmwareManifestUrl "$REHEARSAL_SERVER_URL/firmware-manifest.json"

# Without this the Mac App card compares against the public release and keeps
# reporting "up to date", even though Sparkle would happily install the candidate.
launchctl setenv "$REHEARSAL_MAC_RELEASE_ENV_VAR" "$REHEARSAL_SERVER_URL/mac-app-release.json"
rehearsal::info "Mac App release feed -> $REHEARSAL_SERVER_URL/mac-app-release.json"
rehearsal::record macAppReleaseUrl "$REHEARSAL_SERVER_URL/mac-app-release.json"

# Overriding the companion rehearses a companion-side fix against the public app.
# It does not survive the Sparkle update, which replaces the whole bundle.
rehearsal::apply_companion_override

# The runtime reads these overrides from its environment at launch, so it has to
# come up after they are set.
rehearsal::stop_runtime
# Same hole as in cold start: the stop bootouts the override's standalone agent
# and open_app only runs `open`.
rehearsal::bootstrap_override_runtime

# The launch update checks the feed as the app starts and installs a found update
# without a dialog, but only while automatic checks are on. A baseline with it
# gets the default removed here, so this launch runs the check against the
# candidate feed. A baseline without it keeps checks off, as before: turning them
# on there would show Sparkle's scheduled dialog instead of the customer path.
LAUNCH_UPDATE_CHECK=off
if app_has_launch_update_check; then
  defaults delete "$REHEARSAL_BUNDLE_ID" SUEnableAutomaticChecks >/dev/null 2>&1 || true
  killall cfprefsd >/dev/null 2>&1 || true
  LAUNCH_UPDATE_CHECK=on
  rehearsal::info 'baseline has the launch update: automatic checks back on for this launch'
fi
rehearsal::record launchUpdateCheck "$LAUNCH_UPDATE_CHECK"
rehearsal::open_app

MAC_APP_LAUNCH_UPDATE=baseline-predates-launch-update
if [[ "$LAUNCH_UPDATE_CHECK" == on ]]; then
  rehearsal::step "Waiting for the launch update to install $CANDIDATE_VERSION"
  if wait_for_installed_version "$CANDIDATE_VERSION" 300; then
    MAC_APP_LAUNCH_UPDATE=installed
    rehearsal::info "the launch update installed $CANDIDATE_VERSION without a dialog"
  else
    MAC_APP_LAUNCH_UPDATE=not-installed
    rehearsal::warn "the launch update did not install $CANDIDATE_VERSION within 300 s"
  fi
fi
rehearsal::record macAppLaunchUpdate "$MAC_APP_LAUNCH_UPDATE"
rehearsal::record macAppVersionAfterLaunch "$(rehearsal::installed_app_version)"

# A Mac App that did not update at launch falls back to the Sparkle "Install
# Update" click. That dialog is native macOS and cannot be scripted, and a click
# driven from the CLI would record the update as done without ever showing the
# customer-visible flow, which is the only thing a warm start is evidence for.
rehearsal::write_report staged

# The firmware carries its own version and often does not change between two
# releases. Telling the operator to update it when the candidate ships the
# firmware the customer already has points at an action the Updates tab will not
# offer -- exactly the kind of instruction this rehearsal exists to catch.
if [[ "$CANDIDATE_FIRMWARE_VERSION" == "$PUBLIC_FIRMWARE_VERSION" ]]; then
  FIRMWARE_STEP="   3. Updates tab: no firmware update is offered. The candidate ships
      firmware $CANDIDATE_FIRMWARE_VERSION, which this VibeTV already runs."
  FIRMWARE_EXPECTATION="Expected afterwards: Mac App reports $CANDIDATE_VERSION, firmware stays on
 $CANDIDATE_FIRMWARE_VERSION,"
else
  FIRMWARE_STEP="   3. Updates tab: update the VibeTV firmware to $CANDIDATE_FIRMWARE_VERSION."
  FIRMWARE_EXPECTATION="Expected afterwards: Mac App reports $CANDIDATE_VERSION and firmware
 $CANDIDATE_FIRMWARE_VERSION,"
fi

case "$MAC_APP_LAUNCH_UPDATE" in
  installed)
    MAC_APP_STATUS="installed at launch, no dialog"
    MAC_APP_STEP="   2. Mac App: nothing to click. It installed $CANDIDATE_VERSION by itself
      at launch and reopened; check the version in the app."
    ;;
  not-installed)
    MAC_APP_STATUS="not installed at launch (see report)"
    MAC_APP_STEP="   2. Updates tab: the launch update did not install $CANDIDATE_VERSION. Update
      the Mac App yourself: Sparkle downloads it, replaces the app and relaunches.
      Click \"Install Update\" yourself."
    ;;
  *)
    MAC_APP_STATUS="staged (yours to click)"
    MAC_APP_STEP="   2. Updates tab: update the Mac App. Sparkle downloads $CANDIDATE_VERSION,
      replaces the app and relaunches it. Click \"Install Update\" yourself --
      that dialog is the step this rehearsal exists to exercise."
    ;;
esac

if rehearsal::rehearsal_evidence_possible; then
cat <<NEXT

────────────────────────────────────────────────────────────────────────
 WARM START READY
────────────────────────────────────────────────────────────────────────
 Mac App installed   $BASELINE_VERSION
 VibeTV firmware     $PUBLIC_FIRMWARE_VERSION   (public customer build)
 Candidate offered   $CANDIDATE_VERSION   (commit ${CANDIDATE_SHA:0:12})

 Mac App update       $MAC_APP_STATUS

 Now drive the customer flow yourself:
   1. Pair the VibeTV in the app as a customer would.
$MAC_APP_STEP
$FIRMWARE_STEP

 $FIRMWARE_EXPECTATION
 and the preview matches what the VibeTV shows.

 Report   $REHEARSAL_RUN_DIR/report.json
 Log      $REHEARSAL_LOG
 Undo     scripts/vibetv-rehearse-warm-start.sh --restore
────────────────────────────────────────────────────────────────────────
NEXT
fi
