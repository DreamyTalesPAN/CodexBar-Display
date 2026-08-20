#!/usr/bin/env bash
# Run what CI runs, for the areas the branch actually touches.
#
# Written after three red CI runs in a row on one branch, every one of them
# avoidable: the customer-flow suite is the check that catches recovery-screen
# regressions, and it is the one nobody runs locally because it is slow.
#
#   scripts/check-before-push.sh            # compare against origin/main
#   scripts/check-before-push.sh <base-ref>

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASE="${1:-origin/main}"
FAILED=()
SKIPPED=()

changed="$(git diff --name-only "$BASE"...HEAD 2>/dev/null; git diff --name-only; git ls-files --others --exclude-standard)"
touches() { printf '%s\n' "$changed" | grep -qE "$1"; }

run() {
  local label="$1"; shift
  printf '\n== %s\n' "$label"
  if "$@"; then
    printf '   ok\n'
  else
    printf '   FAILED\n'
    FAILED+=("$label")
  fi
}

if touches '^companion/'; then
  run "go vet"  bash -c 'cd companion && go vet ./...'
  run "go test" bash -c 'cd companion && go test ./...'
  # Only files this branch touched: the repo carries older violations, and a
  # gate that fails on someone else's formatting is a gate people switch off.
  run "gofmt" bash -c '
    files="$(git diff --name-only '"$BASE"'...HEAD -- "companion/**/*.go" | sed "s#^companion/##")"
    [[ -n "$files" ]] || exit 0
    cd companion || exit 1
    existing=""
    for f in $files; do [[ -f "$f" ]] && existing="$existing $f"; done
    [[ -n "$existing" ]] || exit 0
    bad="$(gofmt -l $existing)"
    [[ -z "$bad" ]] || { printf "   unformatted: %s\n" "$bad"; exit 1; }'
else
  SKIPPED+=("companion (untouched)")
fi

if touches '^apps/control-center/'; then
  if [[ ! -d apps/control-center/node_modules ]]; then
    printf '\n!! apps/control-center/node_modules is missing; run npm ci there first\n'
    FAILED+=("control-center deps")
  else
    run "unit tests"        bash -c 'cd apps/control-center && npx vitest run'
    run "customer copy"     bash -c 'cd apps/control-center && npm run --silent check:customer-ui-copy'
    run "UI review gate"    bash -c 'cd apps/control-center && npm run --silent check:ui-review'
    run "eslint"            bash -c 'cd apps/control-center && npx eslint src'
    # The slow one, and the one that catches recovery-screen regressions.
    run "customer flows"    bash -c 'cd apps/control-center && npm run --silent test:customer-flows'
  fi
else
  SKIPPED+=("control-center (untouched)")
fi

if touches '^macos/|^scripts/test-macos-control-center-app-bundle\.sh|^scripts/test-vibetv-hosted-gates\.sh'; then
  run "swift parse" bash -c 'swiftc -parse macos/VibeTVControlCenter/*.swift'
  # The parser is not the contract. These two pin how the bundle and the native
  # repair are allowed to behave, and CI runs both; a gate that only parses can
  # call a branch safe while the macOS job fails.
  run "macos bundle contract" ./scripts/test-macos-control-center-app-bundle.sh
  run "hosted gate contract"  ./scripts/test-vibetv-hosted-gates.sh
else
  SKIPPED+=("macos (untouched)")
fi

if touches '^scripts/'; then
  # `|| true` on the whole list would swallow bash -n and report a clean gate
  # for a script that does not parse. Skip deleted files, keep every real error.
  run "shell syntax" bash -c '
    rc=0
    for f in $(git diff --name-only '"$BASE"'...HEAD -- scripts | grep "\.sh$"); do
      [[ -f "$f" ]] || continue
      bash -n "$f" || rc=1
    done
    exit $rc'
else
  SKIPPED+=("scripts (untouched)")
fi

printf '\n────────────────────────────────────────────\n'
for s in "${SKIPPED[@]+"${SKIPPED[@]}"}"; do printf 'skipped  %s\n' "$s"; done
if [[ ${#FAILED[@]} -eq 0 ]]; then
  printf 'all checks passed — safe to push\n'
  exit 0
fi
for f in "${FAILED[@]}"; do printf 'FAILED   %s\n' "$f"; done
printf '\ndo not push until these are green\n'
exit 1
