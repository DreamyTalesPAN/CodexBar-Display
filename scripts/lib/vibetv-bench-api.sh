#!/usr/bin/env bash
# Where the managed Companion actually listens.
#
# The bundled agent runs with --api-fallback: when 47832 is taken it serves from
# a free port and publishes that in runtime-endpoint.json. Any bench tool that
# hard-codes 47832 therefore questions whatever took the port, or reports no
# Companion at all while the managed one is healthy elsewhere -- and it does so
# precisely in the messy bench state these tools exist to explain.
#
# Deliberately no `set` here: this is sourced by scripts that choose their own
# error handling, and the proof script runs without -e on purpose.

# Prints the origin the managed runtime published, falling back to the default
# port when nothing is published or the published origin does not answer.
bench::resolve_api() {
  local endpoint published
  endpoint="$HOME/Library/Application Support/codexbar-display/run/runtime-endpoint.json"
  published="$(/usr/bin/python3 -c '
import json, sys
try:
    print(json.load(open(sys.argv[1])).get("origin") or "")
except Exception:
    print("")
' "$endpoint" 2>/dev/null)"
  if [[ -n "$published" ]] \
    && curl -fsS --max-time 3 "$published/v1/runtime-health" >/dev/null 2>&1; then
    printf '%s\n' "$published"
    return
  fi
  printf '%s\n' "http://127.0.0.1:47832"
}

# The port half of an origin, so a listener check watches the same process the
# requests go to. Defaults to 47832, which is what an origin without an explicit
# port means here.
bench::api_port() {
  local origin="$1" port
  port="${origin##*:}"
  [[ "$port" =~ ^[0-9]+$ ]] || port=47832
  printf '%s\n' "$port"
}
