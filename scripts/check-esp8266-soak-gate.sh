#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"${ROOT_DIR}/scripts/check-gif-core-policy-tests.sh"

cd "${ROOT_DIR}/companion"

echo "soak gate: daemon resilience + theme contract"
go test ./internal/daemon -count=1 -run 'TestRunCycleWithDepsAppliesThemeWhenDeviceSupportsIt|TestRunWithDepsRetriesAndRecoversAfterReconnect|TestRunWithDepsResetsRetryBackoffAfterSleepWakeGap|TestDaemonSoakSimulation24hEquivalent'
