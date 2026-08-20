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

rehearsal::step 'Pointing the installed app at the candidate'
# Sparkle prefers the user default over the Info.plist feed, so the installed
# public app checks our loopback appcast instead of the GitHub release.
defaults write "$REHEARSAL_BUNDLE_ID" SUFeedURL -string "$REHEARSAL_SERVER_URL/appcast.xml"
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
rehearsal::open_app

# The Sparkle "Install Update" click is a native macOS dialog. Driving it from a
# CLI would record the update as done without ever showing the customer-visible
# flow, which is the only thing a warm start is evidence for.
rehearsal::write_report staged

cat <<NEXT

────────────────────────────────────────────────────────────────────────
 WARM START READY
────────────────────────────────────────────────────────────────────────
 Mac App installed   $BASELINE_VERSION
 VibeTV firmware     $PUBLIC_FIRMWARE_VERSION   (public customer build)
 Candidate offered   $CANDIDATE_VERSION   (commit ${CANDIDATE_SHA:0:12})

 Mac App update       staged (yours to click)

 Now drive the customer flow yourself:
   1. Pair the VibeTV in the app as a customer would.
   2. Updates tab: update the Mac App. Sparkle downloads $CANDIDATE_VERSION,
      replaces the app and relaunches it. Click "Install Update" yourself --
      that dialog is the step this rehearsal exists to exercise.
   3. Updates tab: update the VibeTV firmware to $CANDIDATE_VERSION.

 Expected afterwards: Mac App and firmware both report $CANDIDATE_VERSION,
 and the preview matches what the VibeTV shows.

 Report   $REHEARSAL_RUN_DIR/report.json
 Log      $REHEARSAL_LOG
 Undo     scripts/vibetv-rehearse-warm-start.sh --restore
────────────────────────────────────────────────────────────────────────
NEXT
