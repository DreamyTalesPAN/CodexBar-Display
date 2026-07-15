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

approval_entry() {
  local label="$1"
  printf '\n## %s\n\n- User approval: Explicit test approval.\n- Approved customer-visible result: %s\n' \
    "$label" "$label"
}

setup_repo() {
  local repo="$1"
  mkdir -p "$repo"
  git -C "$repo" init -q
  git -C "$repo" config user.email "control-center-ui-review@example.test"
  git -C "$repo" config user.name "Control Center UI Review Test"

  mkdir -p "$repo/docs" "$repo/apps/control-center/src/components"
  printf '# Control Center Customer UI Approvals\n' \
    > "$repo/docs/control-center-customer-ui-approval.md"
  approval_entry "Initial UI" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  printf '# Control Center UI Principles\n\nKeep it simple.\n' \
    > "$repo/docs/control-center-ui-principles.md"
  printf 'export function Overview() { return "Ready"; }\n' \
    > "$repo/apps/control-center/src/components/overview-screen.tsx"

  git -C "$repo" add .
  git -C "$repo" commit -q -m "Initial approved UI"
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

commit_approval() {
  local repo="$1"
  local label="$2"
  approval_entry "$label" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" add docs/control-center-customer-ui-approval.md
  git -C "$repo" commit -q -m "Approve ${label}"
}

run_gate() {
  local repo="$1"
  (
    cd "$repo"
    GITHUB_ACTIONS= \
      GITHUB_EVENT_NAME= \
      node "$GATE"
  ) 2>&1
}

run_gate_pull_request() {
  local repo="$1"
  (
    cd "$repo"
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
    die "expected UI approval gate to pass"
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
    die "expected UI approval gate to fail"
  }
  assert_contains "$output" "Control Center UI review gate: due"
  assert_contains "$output" "explicit approval"
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

test_ui_change_blocks_immediately() {
  local repo="${TMP_ROOT}/ui-due"
  setup_repo "$repo"
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Change customer-facing UI"
  expect_gate_due "$repo"
}

test_working_tree_ui_change_blocks_immediately() {
  local repo="${TMP_ROOT}/working-tree"
  setup_repo "$repo"
  printf '\nexport const visibleLabel = "Install";\n' \
    >> "$repo/apps/control-center/src/components/overview-screen.tsx"
  expect_gate_due "$repo"
}

test_explicit_approval_resets_gate() {
  local repo="${TMP_ROOT}/approval-reset"
  setup_repo "$repo"
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Change customer-facing UI"
  expect_gate_due "$repo"
  commit_approval "$repo" "Updated overview"
  expect_gate_success "$repo"
}

test_working_tree_approval_covers_same_change() {
  local repo="${TMP_ROOT}/working-tree-approval"
  setup_repo "$repo"
  printf '\nexport const visibleLabel = "Update";\n' \
    >> "$repo/apps/control-center/src/components/overview-screen.tsx"
  approval_entry "One Update action" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  expect_gate_success "$repo"
}

test_marker_without_evidence_does_not_reset_gate() {
  local repo="${TMP_ROOT}/invalid-marker"
  setup_repo "$repo"
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Change customer-facing UI"
  commit_file "$repo" "docs/control-center-customer-ui-approval.md" \
    "Reviewed by the implementation agent"
  expect_gate_due "$repo"
}

test_pull_request_merge_commit_uses_pr_head() {
  local repo="${TMP_ROOT}/pull-request-merge"
  setup_repo "$repo"
  local base_branch
  base_branch="$(git -C "$repo" symbolic-ref --short HEAD)"

  git -C "$repo" checkout -q -b feature
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Change customer-facing UI"
  commit_approval "$repo" "Feature overview"
  local feature_head
  feature_head="$(git -C "$repo" rev-parse HEAD)"

  git -C "$repo" checkout -q "$base_branch"
  commit_file "$repo" "docs/base-follow-up.md" "Base follow-up non-ui change"
  git -C "$repo" merge -q --no-ff "$feature_head" -m "Merge pull request"

  local output
  output="$(run_gate_pull_request "$repo")" || {
    printf '%s\n' "$output" >&2
    die "expected pull_request merge-head UI approval gate to pass"
  }
  assert_contains "$output" "Control Center UI review gate: ok"
  assert_contains "$output" "Review head: ${feature_head}"
}

test_non_ui_commits_do_not_block
test_ui_change_blocks_immediately
test_working_tree_ui_change_blocks_immediately
test_explicit_approval_resets_gate
test_working_tree_approval_covers_same_change
test_marker_without_evidence_does_not_reset_gate
test_pull_request_merge_commit_uses_pr_head

printf 'control-center UI review gate tests passed\n'
