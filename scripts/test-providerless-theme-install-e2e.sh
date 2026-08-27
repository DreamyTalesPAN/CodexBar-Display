#!/usr/bin/env bash
# End-to-end rehearsal of the customer state in issue #371 against the
# protocol-faithful Virtual VibeTV: a paired, healthy VibeTV on a Mac where no
# AI provider delivers usage.
#
#   P1 the device reports the support-report state: theme-missing, stream
#      provider_setup_required, not ready
#   P2 a live theme install completes instead of "Theme installed, but Mac App
#      did not send a fresh image to VibeTV"
#   P3 it completes while the customer is still watching, not after the full
#      display-stream window the device finished half a minute before
#   P4 Reload image answers with the provider state instead of an unexplained
#      render failure, and answers promptly
#
# The released Mac App fails P2 with display_stream_refresh_failed -- the exact
# string from the customer recording in the issue.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
API=127.0.0.1:47893
DEV_ADDR=127.0.0.1:47892
# The device install itself needs a few seconds; the point of P3/P4 is that no
# customer-visible step waits out displayStreamWaitTime (30s) on top of it.
INSTALL_BUDGET_S=20
RELOAD_BUDGET_S=15

export HOME="$WORK/home"
mkdir -p "$HOME/Library/Application Support/codexbar-display"

cleanup() {
  [[ -n "${RUNTIME_PID:-}" ]] && kill "$RUNTIME_PID" 2>/dev/null || true
  [[ -n "${DEVICE_PID:-}" ]] && kill "$DEVICE_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

echo "== build =="
(cd "$ROOT/companion" && go build -o "$WORK/codexbar-display" ./cmd/codexbar-display)
(cd "$ROOT/companion" && go build -o "$WORK/virtual-vibetv" ./cmd/virtual-vibetv)

# CodexBar stand-in that enumerates no provider: the customer state of the
# issue, reported by the runtime as runtime/no-providers.
cat > "$WORK/codexbar-stub" <<'STUB'
#!/usr/bin/env bash
if [[ "${1:-}" == "serve" ]]; then
  PORT=""
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == "--port" ]]; then PORT="$2"; shift; fi
    shift
  done
  exec python3 - "$PORT" <<'PY'
import http.server, json, sys, datetime
def utc():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path.startswith("/health"):
            body = b"{}"
        elif self.path.startswith("/dashboard/v1/snapshot"):
            body = json.dumps({"schemaVersion": 1, "generatedAt": utc(),
                               "staleAfterSeconds": 180, "providers": []}).encode()
        elif self.path.startswith("/usage"):
            body = b"[]"
        else:
            self.send_response(404); self.end_headers(); return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers(); self.wfile.write(body)
http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
PY
fi
if [[ "${1:-}" == "usage" ]]; then echo '[]'; exit 0; fi
if [[ "${1:-} ${2:-}" == "config dump" ]]; then
  echo '{"version":1,"providers":[{"id":"codex","enabled":true}]}'
  exit 0
fi
if [[ "${1:-} ${2:-}" == "config validate" ]]; then echo '{}'; exit 0; fi
if [[ "${1:-} ${2:-}" == "config providers" ]]; then
  echo '[{"provider":"codex","enabled":true}]'
  exit 0
fi
if [[ "${1:-} ${2:-}" == "config enable" ]]; then echo '{"enabled":true}'; exit 0; fi
echo "codexbar-stub 0.46.0"
STUB
chmod +x "$WORK/codexbar-stub"
export CODEXBAR_BIN="$WORK/codexbar-stub"

# The API derives stream.Running from `launchctl print`. The in-process display
# worker counts as a running LaunchAgent here, as in the cold/warm simulation.
mkdir -p "$WORK/bin"
printf '#!/usr/bin/env bash\necho "\tstate = running"\n' > "$WORK/bin/launchctl"
chmod +x "$WORK/bin/launchctl"
export PATH="$WORK/bin:$PATH"

cat > "$HOME/Library/Application Support/codexbar-display/config.json" <<CFG
{
  "deviceTarget": "http://${DEV_ADDR}",
  "deviceToken": "virtual-pair-token",
  "deviceId": "virtual-vibetv-001",
  "knownDevices": [
    {"deviceId": "virtual-vibetv-001", "target": "http://${DEV_ADDR}", "deviceToken": "virtual-pair-token"}
  ]
}
CFG

mkdir -p "$WORK/packs"
python3 - "$ROOT/theme-packs/mini-classic" "$WORK/packs/pack.zip" <<'PY'
import pathlib, sys, zipfile
src, out = pathlib.Path(sys.argv[1]), sys.argv[2]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(src.rglob("*")):
        if path.is_file():
            archive.write(path, path.relative_to(src).as_posix())
PY

"$WORK/virtual-vibetv" -addr "$DEV_ADDR" -raw-addr 127.0.0.1:0 -firmware 1.0.40 \
  >"$WORK/device.log" 2>&1 &
DEVICE_PID=$!
"$WORK/codexbar-display" daemon --transport wifi --interval 15s \
  --api-addr "$API" --api-fallback >"$WORK/runtime.log" 2>&1 &
RUNTIME_PID=$!

echo "== P1: the customer state from the support report =="
STATE=""
for _ in $(seq 1 60); do
  STATE="$(curl -s -m 3 "http://${API}/v1/status" 2>/dev/null || true)"
  if [[ -n "$STATE" ]] && python3 -c "
import json,sys
d=(json.loads(sys.argv[1]).get('device') or {})
s=d.get('stream') or {}
sys.exit(0 if s.get('errorCode')=='provider_setup_required' and d.get('activeTheme')=='theme-missing' else 1)" "$STATE" 2>/dev/null; then
    break
  fi
  sleep 1
done
python3 -c "
import json,sys
p=json.loads(sys.argv[1]); d=p.get('device') or {}
s=d.get('stream') or {}
assert d.get('connected') is True and d.get('paired') is True, f'device must be paired and connected: {d}'
assert d.get('ready') is not True, f'a device without usage must never be ready: {d}'
assert d.get('activeTheme')=='theme-missing', f'expected theme-missing, got {d.get(\"activeTheme\")}'
assert s.get('running') is True and s.get('healthy') is not True, f'stream must run unhealthy: {s}'
assert s.get('errorCode')=='provider_setup_required', f'expected provider_setup_required, got {s}'
print('P1 PASS: paired VibeTV, no provider -> theme-missing + provider_setup_required')" "$STATE" \
  || fail "the no-provider customer state did not reproduce"

echo "== P2/P3: live theme install =="
START=$SECONDS
JOB="$(curl -s -m 30 -X POST \
  "http://${API}/v1/themes/install?slot=live&themeId=mini-classic&themeName=Mini%20Classic&async=true" \
  -H 'Content-Type: application/zip' --data-binary @"$WORK/packs/pack.zip")"
JOB_ID="$(python3 -c "
import json,sys
print(((json.loads(sys.argv[1]) or {}).get('job') or {}).get('id',''))" "$JOB")"
[[ -n "$JOB_ID" ]] || fail "theme install did not start: $JOB"

for _ in $(seq 1 120); do
  JOB="$(curl -s -m 5 "http://${API}/v1/themes/install/status?jobId=${JOB_ID}")"
  PHASE="$(python3 -c "
import json,sys
print(((json.loads(sys.argv[1]) or {}).get('job') or {}).get('phase',''))" "$JOB")"
  [[ "$PHASE" == "complete" || "$PHASE" == "error" ]] && break
  sleep 1
done
INSTALL_S=$((SECONDS - START))

python3 -c "
import json,sys
j=(json.loads(sys.argv[1]) or {}).get('job') or {}
err=j.get('error') or {}
assert j.get('phase')=='complete', f'install must not fail on a provider-less Mac: {err or j}'
message=' '.join([j.get('message') or ''] + (j.get('logs') or []))
assert 'AI usage' in message or 'AI provider' in message, f'the result must name the missing provider: {j.get(\"message\")}'
print('P2 PASS: install completes ->', j.get('message'))" "$JOB" \
  || fail "the provider-less theme install did not complete honestly"

if (( INSTALL_S > INSTALL_BUDGET_S )); then
  fail "install took ${INSTALL_S}s (budget ${INSTALL_BUDGET_S}s): the Mac App sat on Installing after VibeTV had finished"
fi
echo "P3 PASS: install answered after ${INSTALL_S}s (budget ${INSTALL_BUDGET_S}s)"

echo "== P4: Reload image =="
START=$SECONDS
RELOAD="$(curl -s -m 90 -X POST "http://${API}/v1/device/reload-display")"
RELOAD_S=$((SECONDS - START))
python3 -c "
import json,sys
p=json.loads(sys.argv[1]); e=p.get('error') or {}
assert e.get('code')=='provider_setup_required', f'Reload image must name the provider state, got {p}'
print('P4 PASS: Reload image ->', e.get('message'))" "$RELOAD" \
  || fail "Reload image did not give a truthful result"
if (( RELOAD_S > RELOAD_BUDGET_S )); then
  fail "Reload image answered after ${RELOAD_S}s (budget ${RELOAD_BUDGET_S}s)"
fi
echo "P4 PASS: Reload image answered after ${RELOAD_S}s (budget ${RELOAD_BUDGET_S}s)"

echo "ALL PROVIDER-LESS THEME INSTALL CHECKS PASS"
