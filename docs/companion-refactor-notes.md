# Companion Refactor Notes (Epic #18)

This note captures the companion refactor state for daemon/codexbar/setup.

## Daemon split (completed in this pass)
- `companion/internal/daemon/daemon.go`: runtime orchestration, cycle execution, error mapping.
- `companion/internal/daemon/collector.go`: provider collector lifecycle, ordering, persistence trigger logic, retry backoff.

Outcome:
- responsibilities are separated without runtime behavior changes.
- daemon package tests and benchmark budget gate remain green.

## Codexbar and setup status
- `#17` (codexbar split by responsibility) is already closed and integrated.
- `#19` (setup step pipeline refactor) is already closed and integrated.

Epic #18 therefore focuses on remaining daemon decomposition while preserving behavior.

## Validation run
- `cd companion && go test ./...`
- `cd companion && go vet ./...`
- `./scripts/check-companion-bench-budget.sh`
