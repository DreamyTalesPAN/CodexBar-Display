#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

node scripts/build-theme-packs.mjs
node scripts/test-theme-pack-release-flow.mjs
./scripts/test-theme-pack-history.sh
./scripts/check-theme-pack-history.sh

if ! git diff --exit-code -- dist/theme-packs || ! git diff --cached --exit-code -- dist/theme-packs; then
  echo "::error::dist/theme-packs is out of date. Run node scripts/build-theme-packs.mjs and commit the generated files."
  exit 1
fi

untracked_theme_artifacts="$(git ls-files --others --exclude-standard -- dist/theme-packs)"
if [[ -n "${untracked_theme_artifacts}" ]]; then
  echo "::error::generated theme-pack artifacts are not committed:"
  printf '%s\n' "${untracked_theme_artifacts}"
  exit 1
fi
