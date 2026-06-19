#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${VIBETV_PKG_SMOKE_VERSION:-0.0.0-ci}"
WORK_DIR="${VIBETV_PKG_SMOKE_WORK_DIR:-}"
KEEP_WORK_DIR="${VIBETV_PKG_SMOKE_KEEP:-0}"

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required"
}

cleanup() {
  if [[ "$KEEP_WORK_DIR" != "1" && -n "$WORK_DIR" && -d "$WORK_DIR" ]]; then
    rm -rf "$WORK_DIR"
  fi
}

main() {
  [[ "$(uname -s)" == "Darwin" ]] \
    || die "macOS is required for Companion .pkg smoke tests"
  require_cmd go
  require_cmd pkgbuild
  require_cmd pkgutil
  require_cmd file

  if [[ -z "$WORK_DIR" ]]; then
    WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-companion-pkg-smoke.XXXXXX")"
  fi
  trap cleanup EXIT INT TERM

  mkdir -p "${WORK_DIR}/companion" "${WORK_DIR}/pkg"

  for arch in arm64 amd64; do
    local binary
    binary="${WORK_DIR}/companion/codexbar-display-darwin-${arch}-v${VERSION}"
    (
      cd "${ROOT}/companion"
      GOOS=darwin GOARCH="$arch" CGO_ENABLED=0 \
        go build \
          -ldflags "-s -w -X github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/buildinfo.Version=${VERSION} -X github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/buildinfo.Commit=pkg-smoke -X github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/buildinfo.Date=2026-06-19T00:00:00Z" \
          -o "$binary" \
          ./cmd/codexbar-display
    )

    "${ROOT}/scripts/build-control-center-companion-pkg.sh" \
      --version "$VERSION" \
      --arch "$arch" \
      --binary "$binary" \
      --out "${WORK_DIR}/pkg"
  done

  for pkg in "${WORK_DIR}"/pkg/*.pkg; do
    "${ROOT}/scripts/check-control-center-companion-customer-readiness.sh" \
      --pkg "$pkg" \
      --expect-version "$VERSION"
  done

  if [[ "$KEEP_WORK_DIR" == "1" ]]; then
    printf 'Companion package smoke artifacts kept at %s\n' "$WORK_DIR"
  fi
  printf 'companion package smoke tests passed\n'
}

main "$@"
