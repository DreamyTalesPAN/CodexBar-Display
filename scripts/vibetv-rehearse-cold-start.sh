#!/usr/bin/env bash
# Cold start: rehearse what a brand new customer gets.
#
# Wipes every VibeTV and CodexBar trace from this Mac, then installs the Mac App
# and the firmware from a pull request candidate. No update path is involved --
# this is the "unboxed today, already on the new build" state.
#
#   scripts/vibetv-rehearse-cold-start.sh --pr 348
#   scripts/vibetv-rehearse-cold-start.sh --restore

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/vibetv-rehearsal.sh
source "$ROOT/scripts/lib/vibetv-rehearsal.sh"

REHEARSAL_MODE=cold
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

rehearsal::fetch_candidate

cat <<PLAN

This rehearsal will:
  1. move every VibeTV and CodexBar file on this Mac into a restorable backup
  2. install Mac App $CANDIDATE_VERSION (commit ${CANDIDATE_SHA:0:12}) from the candidate DMG
  3. flash VibeTV $DEVICE_ID to firmware $CANDIDATE_VERSION

The VibeTV will be written to. Everything removed from this Mac is restorable
with --restore.
PLAN
rehearsal::confirm 'Proceed?'

# --- 1. clean Mac ------------------------------------------------------------
rehearsal::capture_device_token
rehearsal::purge_mac

# --- 2. install the candidate app -------------------------------------------
rehearsal::step "Installing candidate Mac App $CANDIDATE_VERSION"
rehearsal::install_dmg "$CANDIDATE_DMG" candidate

# --- 3. flash the candidate firmware ----------------------------------------
rehearsal::start_artifact_server

rehearsal::step "Flashing candidate firmware $CANDIDATE_VERSION"
FIRMWARE_OUTCOME=installed
if [[ "$DEVICE_FIRMWARE" == "$CANDIDATE_VERSION" ]]; then
  rehearsal::info "already on $CANDIDATE_VERSION, nothing to flash"
elif rehearsal::flash_firmware "$REHEARSAL_SERVER_URL/firmware-manifest.json" "$CANDIDATE_VERSION" 1; then
  rehearsal::wait_for_device_firmware "$CANDIDATE_VERSION" \
    || { rehearsal::warn "VibeTV did not report $CANDIDATE_VERSION within 3 minutes"; FIRMWARE_OUTCOME=unconfirmed; }
else
  FIRMWARE_OUTCOME=failed
fi

# Keep the candidate manifest active so the Updates tab stays consistent with
# what is actually installed instead of offering the public release again.
launchctl setenv "$REHEARSAL_FIRMWARE_ENV_VAR" "$REHEARSAL_SERVER_URL/firmware-manifest.json"

DEVICE_FIRMWARE_AFTER="$(rehearsal::device_field "$REHEARSAL_DEVICE_TARGET" firmware)"
rehearsal::record deviceFirmwareAfter "$DEVICE_FIRMWARE_AFTER"

rehearsal::open_app
rehearsal::write_report "$FIRMWARE_OUTCOME"

cat <<NEXT

────────────────────────────────────────────────────────────────────────
 COLD START READY
────────────────────────────────────────────────────────────────────────
 Mac App installed   $CANDIDATE_VERSION   (commit ${CANDIDATE_SHA:0:12})
 VibeTV firmware     $DEVICE_FIRMWARE_AFTER   (flash: $FIRMWARE_OUTCOME)

 Now drive the customer flow yourself:
   1. Pair the VibeTV in the app as a brand new customer would.
   2. Watch the Overview: it must reach a live preview without flapping
      between the setup screen and Overview.
   3. Updates tab: both entries must read $CANDIDATE_VERSION with no
      update offered.

 Report   $REHEARSAL_RUN_DIR/report.json
 Log      $REHEARSAL_LOG
 Undo     scripts/vibetv-rehearse-cold-start.sh --restore
────────────────────────────────────────────────────────────────────────
NEXT
