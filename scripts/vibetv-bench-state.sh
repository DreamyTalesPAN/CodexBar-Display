#!/usr/bin/env bash
# One look at the bench, so a rehearsal never starts blind.
#
# Every line here was a separate probe during a rehearsal that went sideways.
# Collecting them costs one call instead of thirty, and the traps are named
# where they are found instead of being rediscovered.
#
#   scripts/vibetv-bench-state.sh

set -uo pipefail
export PATH=/usr/bin:/bin:/usr/sbin:/sbin:$PATH

BUNDLE_ID="shop.vibetv.control-center"
APP="/Applications/VibeTV Control Center.app"
STATE_DIR="$HOME/.vibetv-rehearsal"

# shellcheck source=lib/vibetv-bench-api.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/vibetv-bench-api.sh"
API="$(bench::resolve_api)"

say() { printf '%s\n' "$*"; }
warn() { printf '  !! %s\n' "$*"; }

say "== Mac App"
if [[ -d "$APP" ]]; then
  say "  installed   $(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist" 2>/dev/null || echo '?')"
else
  warn "no app in /Applications"
fi

# A copy running from anywhere else answers vibetv:// URLs and shows the
# "Move to Applications" dialog. Always drive the installed one explicitly:
#   open -a "/Applications/VibeTV Control Center.app" "vibetv://<action>"
foreign="$(pgrep -fl 'VibeTVControlCenter' 2>/dev/null | grep -v "^[0-9]* $APP" || true)"
if [[ -n "$foreign" ]]; then
  warn "app instances outside /Applications are running:"
  printf '     %s\n' "$foreign"
fi

say "== Runtime"
listeners="$(lsof -nP -a -iTCP@127.0.0.1:47832 -sTCP:LISTEN -Fp 2>/dev/null | sed -nE 's/^p([0-9]+)$/\1/p' | sort -u | tr '\n' ' ')"
say "  listeners on 47832: ${listeners:-none}"
[[ "$(printf '%s' "$listeners" | wc -w | tr -d ' ')" -gt 1 ]] && warn "more than one listener: a restart raced its predecessor"
if ! launchctl print "gui/$(id -u)/${BUNDLE_ID}.runtime" >/dev/null 2>&1; then
  warn "the runtime LaunchAgent is not registered."
  warn "never 'launchctl bootout' this service: SMAppService does not come back"
  warn "from it, not on app restart and not on vibetv://repair-runtime."
  warn "Reinstall the app bundle to recover."
fi

say "== Companion"
if status="$(curl -fsS --max-time 10 "$API/v1/status" 2>/dev/null)"; then
  printf '%s' "$status" | python3 -c '
import json, sys
s = json.load(sys.stdin)
c, d = s.get("companion", {}), s.get("device", {})
r, st = c.get("runtime", {}), d.get("stream", {})
print(f"  companion   {c.get('"'"'version'"'"')}  status={c.get('"'"'status'"'"')}  mode={c.get('"'"'installationMode'"'"')}")
print(f"  runtime     {r.get('"'"'version'"'"')}  pid={r.get('"'"'pid'"'"')}  commit={(r.get('"'"'commit'"'"') or '"'"''"'"')[:12]}")
u = c.get("update", {})
print(f"  update      {u.get('"'"'status'"'"')}  installed={u.get('"'"'installedVersion'"'"')}  latest={u.get('"'"'latestVersion'"'"')}")
print(f"  device      {d.get('"'"'target'"'"')}  id={d.get('"'"'deviceId'"'"')}  fw={d.get('"'"'firmware'"'"')}  theme={d.get('"'"'activeTheme'"'"')}")
print(f"  connection  connected={d.get('"'"'connected'"'"')} paired={d.get('"'"'paired'"'"')} ready={d.get('"'"'ready'"'"')} state={d.get('"'"'connectionState'"'"')}")
print(f"  stream      healthy={st.get('"'"'healthy'"'"')} error={st.get('"'"'errorCode'"'"')}")
print(f"              {st.get('"'"'detail'"'"')}")
' 2>/dev/null || warn "status did not parse"
else
  warn "no Companion on $API"
fi

say "== Providers"
if prefs="$(curl -fsS --max-time 12 "$API/v1/preferences" 2>/dev/null)"; then
  printf '%s' "$prefs" | python3 -c '
import json, sys
items = [i for i in json.load(sys.stdin).get("items", []) if "codexbar.providers" in i.get("id", "")]
on = [i["id"].split(".")[2] for i in items if i.get("value") is True]
print(f"  {len(items)} known, enabled: {on or '"'"'none'"'"'}")
' 2>/dev/null || warn "preferences did not parse"
else
  say "  (Companion did not answer)"
fi
if [[ -d "$HOME/.codexbar" ]]; then
  say "  ~/.codexbar present"
else
  warn "~/.codexbar is gone: the stream will report provider_setup_required"
fi

say "== Rehearsal state"
launchctl getenv CODEXBAR_DISPLAY_FIRMWARE_MANIFEST_URL 2>/dev/null | grep -q . \
  && warn "firmware manifest override is active (a rehearsal is still staged)"
launchctl getenv CODEXBAR_DISPLAY_MAC_APP_RELEASE_API_URL 2>/dev/null | grep -q . \
  && warn "Mac App release override is active (a rehearsal is still staged)"
defaults read "$BUNDLE_ID" SUFeedURL >/dev/null 2>&1 \
  && warn "SUFeedURL points at a loopback appcast"

# --restore walks to the NEWEST run with a non-empty manifest. After a cold
# start followed by a warm start that is the candidate state, not what the Mac
# looked like before the session. The run that holds the original is the FIRST
# one of the current chain, so print enough of the chain to pick it by hand.
say "  recent runs with a restorable backup (newest first):"
shown=0
for run in $(ls -1dt "$STATE_DIR"/runs/*/ 2>/dev/null); do
  [[ -s "${run}backup/manifest.txt" ]] || continue
  app_version="-"
  backup_app="${run}backup/Applications/VibeTV Control Center.app/Contents/Info.plist"
  [[ -f "$backup_app" ]] && app_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$backup_app" 2>/dev/null || echo '?')"
  marker=""
  [[ $shown -eq 0 ]] && marker="   <- --restore uses this one"
  printf '    %s  app=%s  size=%s%s\n' \
    "$(basename "$run")" "$app_version" "$(du -sh "${run}backup" 2>/dev/null | cut -f1)" "$marker"
  shown=$((shown + 1))
  [[ $shown -ge 4 ]] && break
done
if [[ $shown -eq 0 ]]; then
  say "    none"
elif [[ $shown -gt 1 ]]; then
  warn "more than one: the pre-session state is the OLDEST of the current chain."
  warn "Recover it by hand with ditto from that run's backup/."
fi

say "== Driving the app"
trusted="$(swift -e 'import ApplicationServices; print(AXIsProcessTrusted())' 2>/dev/null || echo unknown)"
say "  AXIsProcessTrusted: $trusted"
[[ "$trusted" == "false" ]] && warn "clicks are silently dropped; keyboard and vibetv:// still work"

say "== Volumes"
mounted="$(ls -d /Volumes/VibeTV* 2>/dev/null || true)"
[[ -n "$mounted" ]] && warn "mounted image(s) will make hdiutil attach fail: $mounted"

say "== GitHub"
gh auth status >/dev/null 2>&1 && say "  gh authenticated" || warn "gh is not authenticated; candidate download will fail"
