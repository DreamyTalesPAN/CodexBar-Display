#!/usr/bin/env bash
# Mac/Linux entry point for the same Go-only simulation run on Windows in CI.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/companion"
VIBETV_COLDWARM_E2E=1 go test ./integration/coldwarm -run '^TestColdWarm$' -v -count=1 -timeout=10m
