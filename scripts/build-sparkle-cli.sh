#!/usr/bin/env bash
set -euo pipefail

COMMIT='6276ba2b404829d139c45ff98427cf90e2efc59b'
REPOSITORY='https://github.com/sparkle-project/Sparkle.git'
OUTPUT=''
while [[ $# -gt 0 ]]; do
  case "$1" in --output) OUTPUT="${2:-}"; shift 2 ;; *) echo "error: unknown argument: $1" >&2; exit 1 ;; esac
done
[[ -n "$OUTPUT" && ! -e "$OUTPUT" ]] || { echo 'error: --output must be a new directory' >&2; exit 1; }
[[ "$(uname -s)" == Darwin ]] || { echo 'error: Sparkle CLI build requires macOS/xcodebuild' >&2; exit 1; }
work="$(mktemp -d "${TMPDIR:-/tmp}/sparkle-cli.XXXXXX")"; trap 'rm -rf "$work"' EXIT
git init -q "$work/source"
git -C "$work/source" remote add origin "$REPOSITORY"
git -C "$work/source" fetch -q --depth=1 origin "$COMMIT"
[[ "$(git -C "$work/source" rev-parse HEAD)" == "$COMMIT" ]] || { echo 'error: Sparkle source commit mismatch' >&2; exit 1; }
xcodebuild -project "$work/source/Sparkle.xcodeproj" -scheme sparkle-cli -configuration Release -derivedDataPath "$work/derived" CODE_SIGNING_ALLOWED=NO build >/dev/null
cli="$(find "$work/derived" -type f -path '*/sparkle.app/Contents/MacOS/sparkle' -print -quit)"
[[ -x "$cli" ]] || { echo 'error: pinned Sparkle source did not build sparkle CLI' >&2; exit 1; }
mkdir -p "$OUTPUT"; ditto "$(dirname "$(dirname "$(dirname "$cli")")")" "$OUTPUT/sparkle.app"
printf 'Sparkle CLI source commit: %s\n' "$COMMIT"
