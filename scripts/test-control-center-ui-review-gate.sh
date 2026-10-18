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

assert_not_contains() {
  local haystack="$1"
  local needle="$2"
  if printf '%s\n' "$haystack" | grep -F "$needle" >/dev/null; then
    die "expected output not to contain: ${needle}"
  fi
}

WHATS_NEW_NONE="- What's new: none — nothing a customer would look for"

# The second argument is the entry's "What's new" line; empty leaves it out.
approval_entry() {
  local label="$1"
  local whats_new="${2-$WHATS_NEW_NONE}"
  printf '\n## %s\n\n- User approval: Explicit test approval.\n- Approved customer-visible result: %s\n' \
    "$label" "$label"
  [[ -z "$whats_new" ]] || printf '%s\n' "$whats_new"
}

# An entry that waits for Paul's yes in the PR review: the gate passes with a notice.
pending_approval_entry() {
  local label="$1"
  printf '\n## %s\n\n- User approval: pending — Paul reviews this PR (test).\n- Approved customer-visible result: %s\n%s\n' \
    "$label" "$label" "$WHATS_NEW_NONE"
}

PENDING_NOTICE="UI approval pending: Paul's yes in the PR review is required before merge"

setup_repo() {
  local repo="$1"
  mkdir -p "$repo"
  git -C "$repo" init -q
  git -C "$repo" config user.email "control-center-ui-review@example.test"
  git -C "$repo" config user.name "Control Center UI Review Test"

  mkdir -p "$repo/docs" "$repo/apps/control-center/src/components" \
    "$repo/apps/control-center/src/lib"
  printf 'export const WHATS_NEW = [\n  {\n    id: "provider-shortcut",\n  },\n];\n' \
    > "$repo/apps/control-center/src/lib/whats-new.ts"
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
  approval_entry "$label" "${@:3}" \
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

# A UI change, then an approval entry with the given "What's new" line.
approve_ui_change_with() {
  local repo="$1"
  setup_repo "$repo"
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Change customer-facing UI"
  commit_approval "$repo" "Updated overview" "$2"
}

test_approval_without_whats_new_line_does_not_reset_gate() {
  local repo="${TMP_ROOT}/whats-new-missing"
  approve_ui_change_with "$repo" ""
  expect_gate_due "$repo"
}

test_whats_new_none_needs_a_reason() {
  local repo="${TMP_ROOT}/whats-new-none"
  approve_ui_change_with "$repo" "- What's new: none — a fix, nothing new to use"
  expect_gate_success "$repo"

  repo="${TMP_ROOT}/whats-new-none-bare"
  approve_ui_change_with "$repo" "- What's new: none"
  expect_gate_due "$repo"
}

test_whats_new_entry_id_resets_gate() {
  local repo="${TMP_ROOT}/whats-new-id"
  approve_ui_change_with "$repo" "- What's new: \`provider-shortcut\`"
  expect_gate_success "$repo"
}

test_unknown_whats_new_entry_id_does_not_reset_gate() {
  local repo="${TMP_ROOT}/whats-new-unknown-id"
  approve_ui_change_with "$repo" \
    "- What's new: \`provider-shortcut\`, \`not-an-entry\`"
  expect_gate_due "$repo"
}

# An entry is added once: a later approval cannot name it again.
test_whats_new_entry_id_is_named_by_one_approval_only() {
  local repo="${TMP_ROOT}/whats-new-id-twice"
  approve_ui_change_with "$repo" "- What's new: \`provider-shortcut\`"
  expect_gate_success "$repo"
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Change customer-facing UI again"
  commit_approval "$repo" "Overview again" "- What's new: \`provider-shortcut\`"
  expect_gate_due "$repo"
}

# Two entries in one change: each needs its own line.
test_every_added_entry_needs_its_whats_new_line() {
  local repo="${TMP_ROOT}/whats-new-two-entries"
  setup_repo "$repo"
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Change customer-facing UI"
  approval_entry "First change" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  commit_approval "$repo" "Second change" ""
  expect_gate_due "$repo"

  approval_entry "Third change" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  commit_approval "$repo" "Fourth change"
  expect_gate_success "$repo"
}

# Two entries in one change that only together hold both approval lines.
test_every_added_entry_needs_its_approval_lines() {
  local repo="${TMP_ROOT}/approval-lines-split"
  setup_repo "$repo"
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Change customer-facing UI"
  printf '\n## First half\n\n- User approval: Explicit test approval.\n%s\n\n## Second half\n\n- Approved customer-visible result: Second half\n%s\n' \
    "$WHATS_NEW_NONE" "$WHATS_NEW_NONE" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" add docs/control-center-customer-ui-approval.md
  git -C "$repo" commit -q -m "Approve in two halves"
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

# A pending newest entry passes and prints the notice on the console.
test_pending_approval_passes_with_notice() {
  local repo="${TMP_ROOT}/pending-approval"
  setup_repo "$repo"
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Change customer-facing UI"
  pending_approval_entry "Pending overview" \
    >> "$repo/docs/control-center-customer-ui-approval.md"

  local output
  output="$(run_gate "$repo")" || {
    printf '%s\n' "$output" >&2
    die "expected pending UI approval to pass the gate"
  }
  assert_contains "$output" "Control Center UI review gate: ok"
  assert_contains "$output" "$PENDING_NOTICE"
}

# In CI the same notice becomes an annotation and a job summary line.
test_pending_approval_notice_reaches_ci_summary() {
  local repo="${TMP_ROOT}/pending-ci"
  setup_repo "$repo"
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Change customer-facing UI"
  pending_approval_entry "Pending overview" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" add docs/control-center-customer-ui-approval.md
  git -C "$repo" commit -q -m "Pending approval for overview"

  local summary="${TMP_ROOT}/pending-ci-summary.md"
  : > "$summary"
  local output
  output="$(
    cd "$repo"
    GITHUB_ACTIONS=true \
      GITHUB_EVENT_NAME=pull_request \
      GITHUB_STEP_SUMMARY="$summary" \
      node "$GATE" 2>&1
  )" || {
    printf '%s\n' "$output" >&2
    die "expected pending UI approval to pass the gate in CI"
  }
  assert_contains "$output" "Control Center UI review gate: ok"
  assert_contains "$output" "::notice title=Control Center UI approval pending::${PENDING_NOTICE}"
  assert_contains "$(cat "$summary")" "$PENDING_NOTICE"
}

# A later PR whose base already holds the pending entry (main after the merge)
# does not repeat the notice for its unrelated change.
test_pending_approval_already_on_base_prints_no_notice() {
  local repo="${TMP_ROOT}/pending-on-base"
  setup_repo "$repo"
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Change customer-facing UI"
  pending_approval_entry "Pending overview" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" add docs/control-center-customer-ui-approval.md
  git -C "$repo" commit -q -m "Pending approval for overview"
  local base_branch
  base_branch="$(git -C "$repo" symbolic-ref --short HEAD)"

  git -C "$repo" checkout -q -b feature
  commit_file "$repo" "docs/unrelated-change.md" "Unrelated non-ui change"
  local feature_head
  feature_head="$(git -C "$repo" rev-parse HEAD)"

  git -C "$repo" checkout -q "$base_branch"
  commit_file "$repo" "docs/base-follow-up.md" "Base follow-up non-ui change"
  git -C "$repo" merge -q --no-ff "$feature_head" -m "Merge pull request"

  local output
  output="$(run_gate_pull_request "$repo")" || {
    printf '%s\n' "$output" >&2
    die "expected later non-ui merge to pass the gate"
  }
  assert_contains "$output" "Control Center UI review gate: ok"
  assert_not_contains "$output" "UI approval pending"
}

# A given approval prints no pending notice, so nothing changes for it.
test_given_approval_prints_no_pending_notice() {
  local repo="${TMP_ROOT}/given-approval"
  approve_ui_change_with "$repo" "$WHATS_NEW_NONE"
  local output
  output="$(run_gate "$repo")" || {
    printf '%s\n' "$output" >&2
    die "expected given UI approval to pass the gate"
  }
  assert_contains "$output" "Control Center UI review gate: ok"
  assert_not_contains "$output" "UI approval pending"
}

# An approval entry that names the UI file it covers in its own commit.
approval_entry_scoped() {
  local label="$1"
  local path="$2"
  printf '\n## %s\n\n- User approval: Explicit test approval.\n- Approved customer-visible result: %s\n- Scope: %s and this approval record.\n%s\n' \
    "$label" "$label" "$path" "$WHATS_NEW_NONE"
}

# A UI change and an approval entry in one commit: the entry covers only the
# UI files it names, so an unnamed UI file in that commit stays due.
test_ui_change_in_approval_commit_needs_its_scope() {
  local repo="${TMP_ROOT}/approval-commit-ui-unscoped"
  setup_repo "$repo"
  printf '\nexport const visibleLabel = "Install";\n' \
    >> "$repo/apps/control-center/src/components/overview-screen.tsx"
  approval_entry "Updated overview" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" add apps/control-center/src/components/overview-screen.tsx \
    docs/control-center-customer-ui-approval.md
  git -C "$repo" commit -q -m "Change overview and approve it"
  expect_gate_due "$repo"
}

test_ui_change_in_approval_commit_passes_when_entry_names_it() {
  local repo="${TMP_ROOT}/approval-commit-ui-scoped"
  setup_repo "$repo"
  printf '\nexport const visibleLabel = "Install";\n' \
    >> "$repo/apps/control-center/src/components/overview-screen.tsx"
  approval_entry_scoped "Updated overview" \
    "apps/control-center/src/components/overview-screen.tsx" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" add apps/control-center/src/components/overview-screen.tsx \
    docs/control-center-customer-ui-approval.md
  git -C "$repo" commit -q -m "Change overview and approve it"
  expect_gate_success "$repo"
}

# A merge commit that brings a UI change from the branch and carries the
# approval entry: the entry must name the UI file, or the gate is due.
test_merge_commit_with_approval_needs_scope_for_branch_ui() {
  local repo="${TMP_ROOT}/merge-approval-ui"
  setup_repo "$repo"
  local base_branch
  base_branch="$(git -C "$repo" symbolic-ref --short HEAD)"

  git -C "$repo" checkout -q -b feature
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Change customer-facing UI"
  git -C "$repo" checkout -q "$base_branch"
  commit_file "$repo" "docs/base-follow-up.md" "Base follow-up non-ui change"
  git -C "$repo" merge -q --no-ff --no-commit feature >/dev/null 2>&1
  approval_entry "Merged overview" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" add docs/control-center-customer-ui-approval.md
  git -C "$repo" commit -q -m "Merge feature and approve it"
  expect_gate_due "$repo"
}

# A file whose path is a prefix of a named path is not named by that entry.
test_named_path_must_match_whole_file() {
  local repo="${TMP_ROOT}/named-path-prefix"
  setup_repo "$repo"
  printf 'export const short = 1;\n' \
    > "$repo/apps/control-center/src/components/overview-screen.ts"
  printf '\nexport const visibleLabel = "Install";\n' \
    >> "$repo/apps/control-center/src/components/overview-screen.tsx"
  approval_entry_scoped "Updated overview" \
    "apps/control-center/src/components/overview-screen.tsx" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" add apps/control-center/src/components/overview-screen.ts \
    apps/control-center/src/components/overview-screen.tsx \
    docs/control-center-customer-ui-approval.md
  git -C "$repo" commit -q -m "Change two overview files and approve one"
  expect_gate_due "$repo"
}

# A branch that merges an already approved base: the base UI it brings in is
# covered by the base's own approval, so the merge record need not name it.
test_merge_of_approved_base_needs_no_rescope() {
  local repo="${TMP_ROOT}/merge-approved-base"
  setup_repo "$repo"
  local base_branch
  base_branch="$(git -C "$repo" symbolic-ref --short HEAD)"

  git -C "$repo" checkout -q -b feature
  commit_file "$repo" "docs/feature-notes.md" "Feature non-ui change"

  git -C "$repo" checkout -q "$base_branch"
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Change customer-facing UI"
  commit_approval "$repo" "Base overview"
  expect_gate_success "$repo"

  git -C "$repo" checkout -q feature
  git -C "$repo" merge -q --no-ff --no-commit "$base_branch" >/dev/null 2>&1
  approval_entry "Merged base" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" add docs/control-center-customer-ui-approval.md
  git -C "$repo" commit -q -m "Merge base and record it"
  expect_gate_success "$repo"
}

# The merged parent's approval is judged on that parent's own files: an entry
# that names a What's New id only the other branch has does not cover anything.
test_merged_parent_approval_is_judged_on_its_own_tree() {
  local repo="${TMP_ROOT}/merged-parent-own-tree"
  setup_repo "$repo"
  local base_branch
  base_branch="$(git -C "$repo" symbolic-ref --short HEAD)"

  git -C "$repo" checkout -q -b feature
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Feature customer-facing UI"
  commit_approval "$repo" "Feature overview" "- What's new: \`base-entry\`"

  git -C "$repo" checkout -q "$base_branch"
  commit_file "$repo" "apps/control-center/src/lib/whats-new.ts" \
    'export const extra = { id: "base-entry" };'
  git -C "$repo" merge -q --no-ff --no-commit feature >/dev/null 2>&1
  approval_entry "Merged feature" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" add docs/control-center-customer-ui-approval.md
  git -C "$repo" commit -q -m "Merge feature and record it"
  expect_gate_due "$repo"
}

# A path written outside an approval entry does not name the file.
test_path_outside_entry_does_not_name_ui_file() {
  local repo="${TMP_ROOT}/path-outside-entry"
  setup_repo "$repo"
  printf '\nexport const visibleLabel = "Install";\n' \
    >> "$repo/apps/control-center/src/components/overview-screen.tsx"
  printf '\n- Note: apps/control-center/src/components/overview-screen.tsx changed\n' \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  approval_entry "Updated overview" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" add apps/control-center/src/components/overview-screen.tsx \
    docs/control-center-customer-ui-approval.md
  git -C "$repo" commit -q -m "Change overview and approve it"
  expect_gate_due "$repo"
}

test_non_ui_commits_do_not_block
test_ui_change_blocks_immediately
test_working_tree_ui_change_blocks_immediately
test_explicit_approval_resets_gate
test_working_tree_approval_covers_same_change
test_marker_without_evidence_does_not_reset_gate
test_approval_without_whats_new_line_does_not_reset_gate
test_whats_new_none_needs_a_reason
test_whats_new_entry_id_resets_gate
test_unknown_whats_new_entry_id_does_not_reset_gate
test_whats_new_entry_id_is_named_by_one_approval_only
test_every_added_entry_needs_its_whats_new_line
test_every_added_entry_needs_its_approval_lines
test_pull_request_merge_commit_uses_pr_head
test_pending_approval_passes_with_notice
test_pending_approval_notice_reaches_ci_summary
test_pending_approval_already_on_base_prints_no_notice
test_given_approval_prints_no_pending_notice
test_ui_change_in_approval_commit_needs_its_scope
test_ui_change_in_approval_commit_passes_when_entry_names_it
test_merge_commit_with_approval_needs_scope_for_branch_ui
test_named_path_must_match_whole_file
test_merge_of_approved_base_needs_no_rescope
test_merged_parent_approval_is_judged_on_its_own_tree
test_path_outside_entry_does_not_name_ui_file

printf 'control-center UI review gate tests passed\n'
