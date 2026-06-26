#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATE="${ROOT}/scripts/check-control-center-ui-review-gate.mjs"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-ui-review-gate-test.XXXXXX")"

cleanup() {
  rm -rf "$TMP_ROOT"
}

trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  printf '%s\n' "$haystack" | grep -F "$needle" >/dev/null \
    || die "expected output to contain: ${needle}"
}

setup_repo() {
  local repo="$1"
  mkdir -p "$repo"
  git -C "$repo" init -q
  git -C "$repo" config user.email "control-center-ui-review@example.test"
  git -C "$repo" config user.name "Control Center UI Review Test"

  mkdir -p "$repo/docs" "$repo/apps/control-center/src/components"
  printf '# Control Center UI Review Checkpoint\n\ninitial review\n' \
    > "$repo/docs/control-center-ui-review-checkpoint.md"
  printf '# Control Center UI Principles\n\nKeep it simple.\n' \
    > "$repo/docs/control-center-ui-principles.md"
  printf 'export function Overview() { return "Ready"; }\n' \
    > "$repo/apps/control-center/src/components/overview-screen.tsx"

  git -C "$repo" add .
  git -C "$repo" commit -q -m "Initial UI review checkpoint"
}

commit_file() {
  local repo="$1"
  local path="$2"
  local message="$3"
  local absolute="${repo}/${path}"
  mkdir -p "$(dirname "$absolute")"
  printf '%s\n' "$message" >> "$absolute"
  git -C "$repo" add "$path"
  git -C "$repo" commit -q -m "$message"
}

run_gate() {
  local repo="$1"
  (
    cd "$repo"
    CONTROL_CENTER_UI_REVIEW_INTERVAL=5 \
      GITHUB_ACTIONS= \
      GITHUB_EVENT_NAME= \
      node "$GATE"
  ) 2>&1
}

run_gate_pull_request() {
  local repo="$1"
  (
    cd "$repo"
    CONTROL_CENTER_UI_REVIEW_INTERVAL=5 \
      GITHUB_ACTIONS=true \
      GITHUB_EVENT_NAME=pull_request \
      node "$GATE"
  ) 2>&1
}

expect_gate_success() {
  local repo="$1"
  local output
  output="$(run_gate "$repo")" || {
    printf '%s\n' "$output" >&2
    die "expected UI review gate to pass"
  }
  assert_contains "$output" "Control Center UI review gate: ok"
}

expect_gate_due() {
  local repo="$1"
  local output status
  set +e
  output="$(run_gate "$repo")"
  status=$?
  set -e
  [[ "$status" -ne 0 ]] || {
    printf '%s\n' "$output" >&2
    die "expected UI review gate to fail"
  }
  assert_contains "$output" "Control Center UI review gate: due"
  assert_contains "$output" "Control Center UI review is due"
  assert_contains "$output" "docs/control-center-ui-principles.md"
}

test_non_ui_commits_do_not_block() {
  local repo="${TMP_ROOT}/non-ui"
  setup_repo "$repo"
  for index in 1 2 3 4 5 6; do
    commit_file "$repo" "docs/non-ui-${index}.md" "Document non-ui change ${index}"
  done
  expect_gate_success "$repo"
}

test_control_center_readme_does_not_block() {
  local repo="${TMP_ROOT}/control-center-readme"
  setup_repo "$repo"
  for index in 1 2 3 4 5; do
    commit_file "$repo" "apps/control-center/README.md" \
      "Document Control Center setup ${index}"
  done
  expect_gate_success "$repo"
}

test_ui_change_blocks_after_interval() {
  local repo="${TMP_ROOT}/ui-due"
  setup_repo "$repo"
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Change customer-facing UI"
  for index in 1 2 3 4; do
    commit_file "$repo" "docs/follow-up-${index}.md" "Follow-up non-ui change ${index}"
  done
  expect_gate_due "$repo"
}

test_working_tree_ui_change_counts_as_next_commit() {
  local repo="${TMP_ROOT}/working-tree"
  setup_repo "$repo"
  for index in 1 2 3 4; do
    commit_file "$repo" "docs/follow-up-${index}.md" "Follow-up non-ui change ${index}"
  done
  printf '\nexport const visibleLabel = "Install";\n' \
    >> "$repo/apps/control-center/src/components/overview-screen.tsx"
  expect_gate_due "$repo"
}

test_review_marker_resets_gate() {
  local repo="${TMP_ROOT}/review-reset"
  setup_repo "$repo"
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Change customer-facing UI"
  for index in 1 2 3 4; do
    commit_file "$repo" "docs/follow-up-${index}.md" "Follow-up non-ui change ${index}"
  done
  expect_gate_due "$repo"

  commit_file "$repo" "docs/control-center-ui-review-checkpoint.md" \
    "Record UI review"
  expect_gate_success "$repo"
}

test_pull_request_merge_commit_uses_pr_head() {
  local repo="${TMP_ROOT}/pull-request-merge"
  setup_repo "$repo"
  local base_branch
  base_branch="$(git -C "$repo" symbolic-ref --short HEAD)"

  git -C "$repo" checkout -q -b feature
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Change customer-facing UI"
  for index in 1 2 3; do
    commit_file "$repo" "docs/feature-follow-up-${index}.md" \
      "Feature follow-up non-ui change ${index}"
  done
  local feature_head
  feature_head="$(git -C "$repo" rev-parse HEAD)"

  git -C "$repo" checkout -q "$base_branch"
  commit_file "$repo" "docs/base-follow-up.md" "Base follow-up non-ui change"
  git -C "$repo" merge -q --no-ff "$feature_head" -m "Merge pull request"

  local output status
  set +e
  output="$(run_gate "$repo")"
  status=$?
  set -e
  [[ "$status" -ne 0 ]] || die "expected normal merge-head UI review gate to fail"
  assert_contains "$output" "Control Center UI review gate: due"

  output="$(run_gate_pull_request "$repo")" || {
    printf '%s\n' "$output" >&2
    die "expected pull_request merge-head UI review gate to pass"
  }
  assert_contains "$output" "Control Center UI review gate: ok"
  assert_contains "$output" "Review head: ${feature_head}"
  assert_contains "$output" "Commits since marker: 4/5"
}

test_non_ui_commits_do_not_block
test_control_center_readme_does_not_block
test_ui_change_blocks_after_interval
test_working_tree_ui_change_counts_as_next_commit
test_review_marker_resets_gate
test_pull_request_merge_commit_uses_pr_head

printf 'control-center UI review gate tests passed\n'
