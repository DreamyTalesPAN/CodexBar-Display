#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

BASE_REF="${THEME_PACK_BASE_REF:-origin/main}"
if ! git rev-parse --verify "${BASE_REF}^{commit}" >/dev/null 2>&1; then
  echo "::error::theme-pack history base ${BASE_REF} is unavailable"
  exit 1
fi

legacy_paths=(
  "dist/theme-packs/vibetv-theme-packs.json"
  "dist/theme-packs/vibetv-theme-claude-creature.zip"
  "dist/theme-packs/vibetv-theme-clippy.zip"
  "dist/theme-packs/vibetv-theme-cozy-meadow.zip"
  "dist/theme-packs/vibetv-theme-mini-classic.zip"
  "dist/theme-packs/vibetv-theme-synthwave.zip"
)

if ! git diff --quiet "${BASE_REF}" -- "${legacy_paths[@]}"; then
  echo "::error::the frozen legacy theme catalog or one of its assets changed"
  git diff --name-status "${BASE_REF}" -- "${legacy_paths[@]}"
  exit 1
fi

while IFS=$'\t' read -r status asset _; do
  [[ -z "${status}" ]] && continue
  if [[ "${status}" != "A" ]]; then
    echo "::error::immutable versioned theme asset changed: ${status} ${asset}"
    echo "::error::publish a new manifest.version and a new ZIP filename instead"
    exit 1
  fi
done < <(
  git diff --name-status "${BASE_REF}" -- \
    ':(glob)dist/theme-packs/vibetv-theme-*-v*.zip'
)

while IFS=$'\t' read -r status asset _; do
  [[ -z "${status}" ]] && continue
  if [[ "${status}" != "A" ]]; then
    echo "::error::immutable render revision changed: ${status} ${asset}"
    echo "::error::publish a new ThemeSpec revision JSON instead"
    exit 1
  fi
done < <(
  git diff --name-status "${BASE_REF}" -- \
    ':(glob)dist/theme-packs/render/*/*.json'
)

# A VibeTV that still holds an earlier revision gets its update only while the
# catalog names that file (#559). So the file a theme had on the base, and every
# earlier file the base named, stays named when the theme moves on.
catalog="dist/theme-packs/vibetv-theme-packs-v2.json"
if ! git show "${BASE_REF}:${catalog}" | node -e '
  const base = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const current = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  let ok = true;
  for (const was of base.themes) {
    const now = current.themes.find((theme) => theme.id === was.id);
    for (const file of [was.themeSpecPath, ...(was.earlierThemeSpecPaths || [])]) {
      if (now && file !== now.themeSpecPath && !now.earlierThemeSpecPaths?.includes(file)) {
        console.log(`::error::${was.id} no longer names its earlier revision ${file}`);
        ok = false;
      }
    }
  }
  process.exit(ok ? 0 : 1);
' "${catalog}"; then
  echo "::error::run node scripts/build-theme-packs.mjs; earlierThemeSpecPaths only grows"
  exit 1
fi

echo "theme pack history ok against ${BASE_REF}"
