#!/usr/bin/env bash
# Fails when CI or release tooling floats (#208). Every third-party Action is
# pinned to a full commit SHA with its tag as a comment, and every installed
# tool, Rust toolchain or PlatformIO platform names an exact version. Node and
# Python stay on their major/minor line and take the runner's patch release.
#
# Updating a pin: Dependabot proposes Action updates weekly. For a tool, look
# up the new version, change it everywhere this script lists, let CI prove it,
# and review it like any other change. For an Action by hand:
#   git ls-remote https://github.com/<owner>/<repo> 'refs/tags/<tag>' 'refs/tags/<tag>^{}'
# and use the last (peeled) SHA.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

failures=0
fail() {
  printf 'error: %s\n' "$1" >&2
  failures=$((failures + 1))
}

while IFS= read -r line; do
  fail "Action is not pinned to a commit SHA with a version comment: $line"
done < <(grep -nE '^\s*(-\s+)?uses:\s' .github/workflows/*.yml |
  grep -vE 'uses:\s+\./' |
  grep -vE 'uses:\s+[^@[:space:]]+@[0-9a-f]{40} # \S+' || true)

while IFS= read -r line; do
  fail "tool install floats: $line"
done < <(grep -nE '@latest|cargo install .*--version "[^0-9]' .github/workflows/*.yml scripts/check-before-push.sh || true)

while IFS= read -r line; do
  fail "pip install without an exact version: $line"
done < <(grep -nE 'pip install ' .github/workflows/*.yml |
  grep -vE 'pip install( [A-Za-z0-9_.-]+==[0-9][0-9A-Za-z.]*)+[[:space:]]*$' || true)

for workflow in .github/workflows/*.yml; do
  uses="$(grep -c 'uses: dtolnay/rust-toolchain@' "$workflow" || true)"
  pinned="$(grep -A2 'uses: dtolnay/rust-toolchain@' "$workflow" | grep -cE 'toolchain: [0-9]+\.[0-9]+\.[0-9]+' || true)"
  if [[ "$uses" != "$pinned" ]]; then
    fail "$workflow: dtolnay/rust-toolchain needs an exact toolchain: x.y.z"
  fi
done

while IFS= read -r line; do
  fail "PlatformIO platform without an exact version: $line"
done < <(grep -nE '^platform\s*=' firmware_*/platformio.ini | grep -vE '=\s*[a-z0-9_-]+@[0-9]+\.[0-9]+\.[0-9]+\s*$' || true)

if (( failures > 0 )); then
  exit 1
fi
printf 'CI pins ok\n'
