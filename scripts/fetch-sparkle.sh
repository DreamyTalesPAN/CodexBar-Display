#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="2.9.2"
SHA256="1cb340cbbef04c6c0d162078610c25e2221031d794a3449d89f2f56f4df77c95"
CACHE_ROOT="${SPARKLE_CACHE_ROOT:-${ROOT}/tmp/sparkle}"
DIST_DIR="${CACHE_ROOT}/${VERSION}"
ARCHIVE="${CACHE_ROOT}/Sparkle-${VERSION}.tar.xz"
URL="https://github.com/sparkle-project/Sparkle/releases/download/${VERSION}/Sparkle-${VERSION}.tar.xz"

if [[ -f "${DIST_DIR}/Sparkle.framework/Versions/B/Sparkle" \
      && -x "${DIST_DIR}/bin/generate_appcast" ]]; then
  printf '%s\n' "$DIST_DIR"
  exit 0
fi

mkdir -p "$CACHE_ROOT"
if [[ ! -f "$ARCHIVE" ]] \
    || [[ "$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')" != "$SHA256" ]]; then
  partial="${ARCHIVE}.part"
  rm -f "$partial"
  curl -fL --retry 3 --connect-timeout 15 -o "$partial" "$URL"
  actual="$(shasum -a 256 "$partial" | awk '{print $1}')"
  [[ "$actual" == "$SHA256" ]] || {
    rm -f "$partial"
    printf 'error: Sparkle %s checksum mismatch\n' "$VERSION" >&2
    exit 1
  }
  mv -f "$partial" "$ARCHIVE"
fi

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"
tar -xJf "$ARCHIVE" -C "$DIST_DIR"
[[ -f "${DIST_DIR}/Sparkle.framework/Versions/B/Sparkle" ]] \
  || { printf 'error: Sparkle framework missing after extraction\n' >&2; exit 1; }
[[ -x "${DIST_DIR}/bin/generate_appcast" ]] \
  || { printf 'error: Sparkle appcast tool missing after extraction\n' >&2; exit 1; }
printf '%s\n' "$DIST_DIR"
