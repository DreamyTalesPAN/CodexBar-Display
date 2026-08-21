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
# An unresolvable base makes the diff below fail silently, every area check drop
# out as untouched, and this script print "safe to push" having checked nothing.
git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null || {
  printf 'error: cannot resolve comparison base %s\n' "$BASE" >&2
  exit 2
}
FAILED=()
SKIPPED=()

# `git diff` reads the working tree against the index, so a change that was
# already `git add`ed shows up in none of the other three. Staging before
# running the gate is ordinary, and without --cached such a change skipped every
# area check and still reported "safe to push".
changed="$(git diff --name-only "$BASE"...HEAD 2>/dev/null; git diff --name-only; git diff --cached --name-only; git ls-files --others --exclude-standard)"
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
  # companion-tests in CI runs staticcheck as well, so a staticcheck-only
  # failure used to pass here and red CI afterwards -- the exact blind spot this
  # gate exists to close. Install it when missing, the way CI does, and fail
  # loudly if that cannot happen: a skipped check that still prints "safe to
  # push" is worse than no check at all.
  run "staticcheck" bash -c '
    export PATH="$(go env GOPATH)/bin:$PATH"
    if ! command -v staticcheck >/dev/null 2>&1; then
      printf "   installing staticcheck\n"
      go install honnef.co/go/tools/cmd/staticcheck@latest || exit 1
    fi
    cd companion && staticcheck ./...'
  # companion-tests in CI enforces the daemon latency and allocation budgets
  # after the Go tests. Without it a change to the cycle or to frame marshaling
  # passes here and only fails there.
  #
  # Allocations are enforced exactly as CI does: they are deterministic, and
  # they are where a real regression shows up. The wall-clock budgets get four
  # times the headroom locally, because they measure the machine as much as the
  # code -- marshaling took 506ns on an idle Mac and 1099ns against CI's 1000ns
  # limit while the rest of this gate was running. Failing a push for that would
  # teach people to distrust the gate, and an order-of-magnitude slowdown still
  # trips these. CI keeps the real numbers on a controlled runner.
  run "bench budget" env MAX_CYCLE_NS=200000 MAX_MARSHAL_NS=4000 \
    ./scripts/check-companion-bench-budget.sh
  # companion-tests in CI also runs the cold/warm honesty simulation against the
  # virtual VibeTV. It covers startup and recovery across a process restart,
  # which is exactly what provider recovery and the runtime restarts touch, and
  # it needs no hardware. About 22 seconds.
  run "cold/warm honesty" ./scripts/test-companion-coldwarm-e2e.sh
  # Only files this branch touched: the repo carries older violations, and a
  # gate that fails on someone else's formatting is a gate people switch off.
  # "Touched" has to mean the same four sources `changed` is built from, though
  # -- go vet, the tests and staticcheck all accept an unformatted file, so a
  # working-tree or staged Go file that never reached a commit was the one thing
  # nothing here looked at.
  run "gofmt" bash -c '
    files="$( { git diff --name-only '"$BASE"'...HEAD -- "companion/**/*.go"
                git diff --name-only -- "companion/**/*.go"
                git diff --cached --name-only -- "companion/**/*.go"
                git ls-files --others --exclude-standard -- "companion/**/*.go"
              } | sort -u | sed "s#^companion/##")"
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
    # npm run lint, not `eslint src`: CI lints the whole project, so anything
    # outside src was never linted locally and could only fail there.
    run "eslint"            bash -c 'cd apps/control-center && npm run --silent lint'
    # The slow one, and the one that catches recovery-screen regressions.
    run "customer flows"    bash -c 'cd apps/control-center && npm run --silent test:customer-flows'
    # theme-studio-tests is a separate CI job, and the customer-flow run does
    # not reach the --theme-studio-safety branch, so both Theme Studio browser
    # flows were CI-only. About 41 seconds.
    run "theme studio"      bash -c 'cd apps/control-center && npm run --silent test:theme-studio'
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
  #
  # Enumerate the same four sources `changed` is built from. Listing only
  # committed files let an unstaged edit, a staged one, or a brand new untracked
  # script reach "all checks passed -- safe to push" without ever being parsed,
  # even though that very file is what put this section in scope.
  run "shell syntax" bash -c '
    rc=0
    for f in $( { git diff --name-only '"$BASE"'...HEAD -- scripts
                  git diff --name-only -- scripts
                  git diff --cached --name-only -- scripts
                  git ls-files --others --exclude-standard -- scripts
                } | sort -u | grep "\.sh$"); do
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
