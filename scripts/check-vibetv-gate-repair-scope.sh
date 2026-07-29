#!/usr/bin/env bash
set -euo pipefail

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

[[ $# -eq 2 ]] || die "usage: $0 <base-sha> <head-sha>"
BASE_SHA="$1"
HEAD_SHA="$2"

for sha in "$BASE_SHA" "$HEAD_SHA"; do
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die "invalid commit SHA: $sha"
  git cat-file -e "${sha}^{commit}" 2>/dev/null || die "commit is unavailable: $sha"
done

changed_paths="$(git diff --name-only --diff-filter=ACDMRTUXB "$BASE_SHA" "$HEAD_SHA")"
[[ -n "$changed_paths" ]] || die "gate repair has no changed files"

blocked_paths=""
while IFS= read -r path; do
  case "$path" in
    .github/workflows/ci.yml | \
    .github/workflows/vibetv-gate-repair.yml | \
    .github/workflows/vibetv-merge-gate.yml | \
    .github/workflows/vibetv-release-candidate.yml | \
    scripts/check-vibetv-gate-repair-scope.sh | \
    scripts/test-vibetv-hosted-gates.sh | \
    scripts/test-vibetv-hosted-guest.sh | \
    scripts/extract-vibetv-candidate-app.sh | \
    scripts/build-sparkle-cli.sh | \
    companion/internal/virtualvibetv/* | \
    companion/cmd/virtual-vibetv/* | \
    companion/cmd/codexbar-display/virtual_vibetv_test.go)
      ;;
    *)
      blocked_paths+="${path}"$'\n'
      ;;
  esac
done <<< "$changed_paths"

[[ -z "$blocked_paths" ]] || die "gate repair changes product or release code outside the safe scope:
${blocked_paths%$'\n'}"

printf 'Gate repair scope is safe:\n%s\n' "$changed_paths"
