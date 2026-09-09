#!/usr/bin/env bash
# End-to-end cold/warm start simulation against the protocol-faithful Virtual
# VibeTV. Exercises the honest-reachability contract:
#   S1 runtime cold start with the device powered off  -> reconnecting, never connected
#   S2 device powers on                                -> connected + ready quickly
#   S3 runtime warm restart (device stays on)          -> recovers quickly
#   S4 device power-cycle                              -> honest drop, fast recovery
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
API=127.0.0.1:47899
DEV_PORT=47898
DEV_ADDR="127.0.0.1:${DEV_PORT}"
export HOME="$WORK/home"
mkdir -p "$HOME/Library/Application Support/codexbar-display"

cleanup() {
  [[ -n "${RUNTIME_PID:-}" ]] && kill "$RUNTIME_PID" 2>/dev/null || true
  [[ -n "${DEVICE_PID:-}" ]] && kill "$DEVICE_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT

echo "== build =="
COMPANION="$(cd "$ROOT/../companion" && pwd)"
(cd "$COMPANION" && go build -o "$WORK/codexbar-display" ./cmd/codexbar-display)
(cd "$COMPANION" && go build -o "$WORK/virtual-vibetv" ./cmd/virtual-vibetv)

cat > "$WORK/codexbar-stub" <<'STUB'
#!/usr/bin/env bash
# Minimal CodexBar stand-in: implements `serve` with the two dashboard
# endpoints plus /health, mirroring the fixtures in dashboard_fetch_test.go.
if [[ "${1:-}" == "serve" ]]; then
  PORT=""
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == "--port" ]]; then PORT="$2"; shift; fi
    shift
  done
  exec python3 - "$PORT" <<'PY'
import http.server, json, os, sys, datetime

def utc(offset_secs=0):
    at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=offset_secs)
    return at.strftime("%Y-%m-%dT%H:%M:%SZ")

token = os.environ.get("CODEXBAR_DASHBOARD_TOKEN", "")

def snapshot():
    return {
        "schemaVersion": 1,
        "generatedAt": utc(),
        "staleAfterSeconds": 180,
        "providers": [{
            "id": "codex", "name": "Codex",
            "windows": [{"kind": "weekly", "label": "Weekly", "usedPercent": 42,
                         "resetAt": utc(3 * 24 * 3600)}],
            "error": None, "updatedAt": utc(),
        }],
    }
usage = [{"provider": "codex",
          "usage": {"secondary": {"usedPercent": 42, "windowMinutes": 10080}}}]

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path.startswith("/health"):
            body = b"{}"
        elif self.path.startswith("/dashboard/v1/snapshot"):
            if self.headers.get("Authorization") != "Bearer " + token:
                self.send_response(401); self.end_headers(); return
            body = json.dumps(snapshot()).encode()
        elif self.path.startswith("/usage"):
            body = json.dumps(usage).encode()
        else:
            self.send_response(404); self.end_headers(); return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
PY
fi
if [[ "${1:-}" == "usage" ]]; then
  echo '[{"provider":"codex","source":"oauth","usage":{"primary":{"usedPercent":42},"secondary":{"usedPercent":17}}}]'
  exit 0
fi
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

# The API derives stream.Running from `launchctl print`. Outside macOS we shim
# it so the in-process display worker counts as a running LaunchAgent.
mkdir -p "$WORK/bin"
cat > "$WORK/bin/launchctl" <<'LCTL'
#!/usr/bin/env bash
echo "	state = running"
LCTL
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

status() { curl -s -m 3 "http://${API}/v1/status" 2>/dev/null || echo "{}"; }
jqget() { python3 -c "import json,sys;d=json.load(sys.stdin);print(json.dumps({k:d.get('device',{}).get(k) for k in ['connected','ready','connectionState','active']}))" 2>/dev/null || echo "{}"; }

wait_for() { # wait_for <timeout-secs> <python-predicate over device dict>
  local deadline=$((SECONDS + $1)) predicate="$2" snap=""
  while (( SECONDS < deadline )); do
    snap="$(status)"
    if python3 -c "
import json,sys
try: d=json.loads(sys.argv[1]).get('device') or {}
except Exception: sys.exit(1)
sys.exit(0 if ($predicate) else 1)" "$snap"; then
      echo "$snap" | jqget
      return 0
    fi
    sleep 1
  done
  echo "TIMEOUT waiting for: $predicate" >&2
  echo "$snap" | jqget >&2
  return 1
}

start_runtime() {
  "$WORK/codexbar-display" daemon --transport wifi --interval 30s \
    --api-addr "$API" --api-fallback >"$WORK/runtime.log" 2>&1 &
  RUNTIME_PID=$!
}
start_device() {
  "$WORK/virtual-vibetv" -addr "$DEV_ADDR" -raw-addr 127.0.0.1:0 \
    -firmware 1.0.39 >"$WORK/device.log" 2>&1 &
  DEVICE_PID=$!
}

echo "== S1: runtime cold start, device OFF =="
T0=$SECONDS
start_runtime
wait_for 20 "d.get('active') is True and d.get('connectionState') == 'reconnecting'"
S1_SNAP="$(status)"
python3 -c "
import json,sys
d=json.loads(sys.argv[1]).get('device') or {}
assert d.get('connected') is not True, f'LIE: powered-off device reported connected: {d}'
assert d.get('ready') is not True, f'LIE: powered-off device reported ready: {d}'
print('S1 PASS: device off -> honest reconnecting, never connected  (+%ds)' % ($SECONDS-$T0))" "$S1_SNAP"

echo "== S2: device powers on (cold boot) =="
T0=$SECONDS
start_device
wait_for 30 "d.get('connected') is True" >/dev/null
echo "S2a connected after $((SECONDS-T0))s"
wait_for 60 "d.get('ready') is True and d.get('connectionState') == 'ready'" >/dev/null
echo "S2 PASS: cold device boot -> connected+ready after $((SECONDS-T0))s"

echo "== S3: runtime warm restart (device stays on) =="
kill "$RUNTIME_PID"; wait "$RUNTIME_PID" 2>/dev/null || true
T0=$SECONDS
start_runtime
wait_for 30 "d.get('connected') is True" >/dev/null
echo "S3a connected after $((SECONDS-T0))s"
wait_for 60 "d.get('ready') is True" >/dev/null
echo "S3 PASS: runtime warm restart -> connected+ready after $((SECONDS-T0))s"

echo "== S4: device power-cycle =="
kill "$DEVICE_PID"; wait "$DEVICE_PID" 2>/dev/null || true
T0=$SECONDS
# Honesty bound: connected must drop within the ready-age window (2min) plus one poll.
wait_for 150 "d.get('ready') is not True" >/dev/null
echo "S4a honest drop after $((SECONDS-T0))s (bounded by the 2min ready-age window)"
T0=$SECONDS
start_device
wait_for 30 "d.get('connected') is True" >/dev/null
echo "S4b reconnected after $((SECONDS-T0))s"
wait_for 60 "d.get('ready') is True" >/dev/null
echo "S4 PASS: device power-cycle -> honest drop + recovery after $((SECONDS-T0))s"

echo "ALL SCENARIOS PASS"
