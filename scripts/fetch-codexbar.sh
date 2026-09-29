#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="0.63.0"
SHA256="e53c76f7184fd061472a277550a9fecddfdc7ffd1f9749b490afbc95b72000d7"
ARCHIVE_NAME="CodexBar-macos-universal-${VERSION}.zip"
CACHE_ROOT="${CODEXBAR_CACHE_ROOT:-${ROOT}/tmp/codexbar}"
ARCHIVE="${CACHE_ROOT}/${ARCHIVE_NAME}"
URL="https://github.com/steipete/CodexBar/releases/download/v${VERSION}/${ARCHIVE_NAME}"

mkdir -p "$CACHE_ROOT"
if [[ ! -f "$ARCHIVE" ]] \
    || [[ "$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')" != "$SHA256" ]]; then
  partial="${ARCHIVE}.part"
  rm -f "$partial"
  curl -fL --retry 3 --connect-timeout 15 -o "$partial" "$URL"
  actual="$(shasum -a 256 "$partial" | awk '{print $1}')"
  [[ "$actual" == "$SHA256" ]] || {
    rm -f "$partial"
    printf 'error: CodexBar %s checksum mismatch\n' "$VERSION" >&2
    exit 1
  }
  mv -f "$partial" "$ARCHIVE"
fi

printf '%s\n' "$ARCHIVE"
