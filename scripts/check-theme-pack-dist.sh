#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

node scripts/build-theme-packs.mjs

if ! git diff --exit-code -- dist/theme-packs || ! git diff --cached --exit-code -- dist/theme-packs; then
  echo "::error::dist/theme-packs is out of date. Run node scripts/build-theme-packs.mjs and commit the generated files."
  exit 1
fi
