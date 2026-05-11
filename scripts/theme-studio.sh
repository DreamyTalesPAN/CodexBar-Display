#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo_root}/tools/theme-studio"

if [ ! -d node_modules ]; then
  npm install
fi

npm run dev -- --port "${THEME_STUDIO_PORT:-5174}"
