#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
installer="$script_dir/install-agent-git-guardrails.sh"

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

bare_remote="$tmp_dir/remote.git"
repo="$tmp_dir/repo"
main_push_output="$tmp_dir/main-push.out"
tag_push_output="$tmp_dir/tag-push.out"

git init --bare --initial-branch=main "$bare_remote" >/dev/null
git init --initial-branch=main "$repo" >/dev/null

(
  cd "$repo"
  git config user.email "codex@example.test"
  git config user.name "Codex Guardrail Test"

  printf "hello\n" > README.md
  git add README.md
  git commit -m "Initial commit" >/dev/null
  git remote add origin "$bare_remote"

  "$installer" >/dev/null

  git checkout -b feature/allowed >/dev/null 2>&1
  printf "feature\n" > feature.txt
  git add feature.txt
  git commit -m "Feature branch" >/dev/null
  git push origin feature/allowed >/dev/null 2>&1

  git checkout main >/dev/null 2>&1
  printf "main change\n" >> README.md
  git add README.md
  git commit -m "Main change" >/dev/null

  if git push origin main >"$main_push_output" 2>&1; then
    echo "error: main push was not blocked" >&2
    exit 1
  fi
  grep -q "Blocked by VibeTV guardrail" "$main_push_output"

  VIBETV_ALLOW_MAIN_PUSH=1 git push origin main >/dev/null 2>&1

  git tag v9.9.9-guardrail-test
  if git push origin v9.9.9-guardrail-test >"$tag_push_output" 2>&1; then
    echo "error: tag push was not blocked" >&2
    exit 1
  fi
  grep -q "Blocked by VibeTV guardrail" "$tag_push_output"

  VIBETV_ALLOW_RELEASE_TAG_PUSH=1 git push origin v9.9.9-guardrail-test >/dev/null 2>&1
)

echo "agent git guardrails test passed"
