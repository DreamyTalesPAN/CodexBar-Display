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
  # Answering runtime-health is not identity, and a foreign listener on a stale
  # published port must not shadow a healthy managed runtime on the default one.
  # Prefer the published origin only when it is ours; otherwise fall through, so
  # the port-reuse case this helper exists for resolves to the runtime that is
  # actually managed instead of failing the caller's own ownership check.
  if [[ -n "$published" ]] \
    && curl -fsS --max-time 3 "$published/v1/runtime-health" >/dev/null 2>&1 \
    && bench::api_owned_by_runtime "$published"; then
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

BENCH_RUNTIME_LABEL="${BENCH_RUNTIME_LABEL:-shop.vibetv.control-center.runtime}"

# The pid launchd has for the managed runtime, empty when it does not know the
# label at all.
bench::runtime_pid() {
  launchctl print "gui/$(id -u)/$BENCH_RUNTIME_LABEL" 2>/dev/null \
    | sed -nE 's/^[[:space:]]*pid = ([0-9]+)$/\1/p' | head -n 1
}

# True when the listener on this origin's port is the managed runtime itself.
#
# Answering /v1/runtime-health is not identity. runtime-endpoint.json can be
# stale, any process may reuse the port it names, and another Companion-
# compatible runtime answers exactly like ours -- so a bench tool can end up
# describing one runtime while the installed app manages another. The native
# side makes the same distinction before it trusts an answer
# (verifyRuntimeListenerOwnership in macos/VibeTVControlCenter/main.swift);
# this is the shell equivalent: launchd's pid for the label must be the pid
# holding the port.
bench::api_owned_by_runtime() {
  local port pid listener
  port="$(bench::api_port "$1")"
  pid="$(bench::runtime_pid)"
  [[ -n "$pid" ]] || return 1
  listener="$(lsof -nP -a -iTCP@127.0.0.1:"$port" -sTCP:LISTEN -Fp 2>/dev/null \
    | sed -nE 's/^p([0-9]+)$/\1/p' | sort -u)"
  [[ -n "$listener" ]] || return 1
  grep -qx "$pid" <<<"$listener"
}
