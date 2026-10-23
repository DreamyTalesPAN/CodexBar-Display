#!/usr/bin/env bash
set -euo pipefail

# Commits in these tests are made after APPROVAL_COMMIT_PATH_RULE_SINCE, so the
# newest rule applies; the older-commit test sets its own date.
export GIT_COMMITTER_DATE="2026-10-18T07:00:00Z"

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
  printf '\n## %s\n\n- User approval: approved by Paul in the communicator chat, 2026-10-20 12:15: "Ja, so passt das (%s)."\n- Approved customer-visible result: %s\n- Scope: %s and this approval record.\n' \
    "$label" "$label" "$label" "$label"
  [[ -z "$whats_new" ]] || printf '%s\n' "$whats_new"
}

# An entry that waits for Paul's yes in the PR review: no approval yet.
pending_approval_entry() {
  local label="$1"
  printf '\n## %s\n\n- User approval: pending — Paul reviews this PR (test).\n- Approved customer-visible result: The result of %s\n- Scope: %s and this approval record.\n%s\n' \
    "$label" "$label" "$label" "$WHATS_NEW_NONE"
}

PENDING_REASON="says pending or draft"

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
  # The base the gate compares with; without it the gate fails closed.
  git -C "$repo" update-ref refs/remotes/origin/main HEAD
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

# A UI change approved by an entry with the given approval lines.
approve_ui_change_with_lines() {
  local repo="$1"
  setup_repo "$repo"
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Change customer-facing UI"
  printf '\n## Overview\n\n%s\n%s\n- Scope: overview and this approval record.\n%s\n' "$2" "$3" "$WHATS_NEW_NONE" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" add docs/control-center-customer-ui-approval.md
  git -C "$repo" commit -q -m "Approve overview"
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

  # Every entry of the change complete: ok (a broken earlier one stays due).
  repo="${TMP_ROOT}/whats-new-two-entries-ok"
  setup_repo "$repo"
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Change customer-facing UI"
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
  printf '\n## First half\n\n- User approval: approved by Paul in the communicator chat, 2026-10-20 12:15: "Ja, so passt das."\n%s\n\n## Second half\n\n- Approved customer-visible result: Second half\n%s\n' \
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

# An entry that says pending or draft is no approval yet: the gate is due (#705).
test_pending_approval_is_due() {
  local repo="${TMP_ROOT}/pending-approval"
  setup_repo "$repo"
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Change customer-facing UI"
  pending_approval_entry "Pending overview" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  expect_gate_due "$repo"
  assert_contains "$(run_gate "$repo")" "$PENDING_REASON"

  git -C "$repo" add docs/control-center-customer-ui-approval.md
  git -C "$repo" commit -q -m "Pending approval for overview"
  expect_gate_due "$repo"
  assert_contains "$(run_gate "$repo")" "$PENDING_REASON"
}

test_draft_approval_is_due() {
  local repo="${TMP_ROOT}/draft-approval"
  approve_ui_change_with_lines "$repo" \
    '- User approval: approved by Paul in the communicator chat, 2026-10-20 12:15: "Ja, so passt das."' \
    "- Approved customer-visible result: Draft, to be confirmed by Paul. The overview reads Ready."
  expect_gate_due "$repo"
  assert_contains "$(run_gate "$repo")" "$PENDING_REASON"
}

test_approval_pending_review_is_due() {
  local repo="${TMP_ROOT}/pending-review"
  approve_ui_change_with_lines "$repo" \
    "- User approval: Paul decided on 20.10.2026; the rendered result is Pending his review." \
    "- Approved customer-visible result: The overview reads Ready."
  expect_gate_due "$repo"
}

test_markdown_draft_result_is_due() {
  local repo="${TMP_ROOT}/markdown-draft"
  approve_ui_change_with_lines "$repo" \
    '- User approval: approved by Paul in the communicator chat, 2026-10-20 12:15: "Ja, so passt das."' \
    "- Approved customer-visible result: **Draft**, to be confirmed by Paul."
  expect_gate_due "$repo"
}

# The fix the gate asks for: a later commit replaces the pending approval with
# the given one, without adding a new entry.
give_pending_approval() {
  local repo="$1"
  local file="$repo/docs/control-center-customer-ui-approval.md"
  sed 's/^- User approval: pending — Paul reviews this PR (test)\.$/- User approval: approved by Paul in the communicator chat, 2026-10-20 12:15: "Ja, so passt das."/' \
    "$file" > "$file.new"
  mv "$file.new" "$file"
}

test_pending_entry_corrected_later_passes() {
  local with_base
  for with_base in yes no; do
    local repo="${TMP_ROOT}/pending-corrected-${with_base}"
    setup_repo "$repo"
    [[ "$with_base" == no ]] || git -C "$repo" update-ref refs/remotes/origin/main HEAD
    commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
      "Change customer-facing UI"
    pending_approval_entry "Pending overview" \
      >> "$repo/docs/control-center-customer-ui-approval.md"
    git -C "$repo" add docs/control-center-customer-ui-approval.md
    git -C "$repo" commit -q -m "Pending approval for overview"
    expect_gate_due "$repo"

    give_pending_approval "$repo"
    expect_gate_success "$repo"
    git -C "$repo" commit -q -am "Paul approved the overview"
    expect_gate_success "$repo"
  done
}

# A correction commit is no new marker: UI it changes itself stays due.
test_correction_commit_does_not_cover_its_own_ui() {
  local repo="${TMP_ROOT}/correction-with-ui"
  setup_repo "$repo"
  git -C "$repo" update-ref refs/remotes/origin/main HEAD
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Change customer-facing UI"
  pending_approval_entry "Pending overview" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" add docs/control-center-customer-ui-approval.md
  git -C "$repo" commit -q -m "Pending approval for overview"
  give_pending_approval "$repo"
  printf 'export const late = "Later";\n' \
    >> "$repo/apps/control-center/src/components/overview-screen.tsx"
  git -C "$repo" commit -q -am "Approve and change the overview again"
  expect_gate_due "$repo"
}

# "pending" and "draft" inside the described result are words of the product,
# not the state of the approval.
test_result_that_describes_a_draft_passes() {
  local repo="${TMP_ROOT}/result-names-draft"
  approve_ui_change_with_lines "$repo" \
    '- User approval: approved by Paul in the communicator chat, 2026-10-20 12:15: "Ja, so passt das."' \
    "- Approved customer-visible result: Theme Studio keeps the unsaved draft while a provider is pending."
  expect_gate_success "$repo"
}

# A pending entry followed by a given one in the same change (#799).
test_pending_entry_before_a_given_one_is_due() {
  local repo="${TMP_ROOT}/pending-then-given"
  setup_repo "$repo"
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Change customer-facing UI"
  pending_approval_entry "Pending overview" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  commit_approval "$repo" "Given overview"
  expect_gate_due "$repo"
  assert_contains "$(run_gate "$repo")" "$PENDING_REASON"
}

# Entries added in earlier commits of the change count too, not only those of
# the newest approval commit (#799).
test_every_entry_since_base_is_checked() {
  local repo="${TMP_ROOT}/entries-since-base"
  setup_repo "$repo"
  git -C "$repo" update-ref refs/remotes/origin/main HEAD
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Change customer-facing UI"
  pending_approval_entry "Pending overview" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" add docs/control-center-customer-ui-approval.md
  git -C "$repo" commit -q -m "Pending approval for overview"
  commit_approval "$repo" "Given overview"
  expect_gate_due "$repo"
  assert_contains "$(run_gate "$repo")" "$PENDING_REASON"
}

# The same check in CI on the pull request merge head.
test_pull_request_checks_every_entry_it_adds() {
  local repo="${TMP_ROOT}/pull-request-every-entry"
  setup_repo "$repo"
  local base_branch output status
  base_branch="$(git -C "$repo" symbolic-ref --short HEAD)"

  git -C "$repo" checkout -q -b feature
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Change customer-facing UI"
  pending_approval_entry "Pending overview" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" add docs/control-center-customer-ui-approval.md
  git -C "$repo" commit -q -m "Pending approval for overview"
  commit_approval "$repo" "Given overview"
  local feature_head
  feature_head="$(git -C "$repo" rev-parse HEAD)"

  git -C "$repo" checkout -q "$base_branch"
  commit_file "$repo" "docs/base-follow-up.md" "Base follow-up non-ui change"
  git -C "$repo" merge -q --no-ff "$feature_head" -m "Merge pull request"

  set +e
  output="$(run_gate_pull_request "$repo")"
  status=$?
  set -e
  [[ "$status" -ne 0 ]] || {
    printf '%s\n' "$output" >&2
    die "expected the pull request's pending entry to make the gate due"
  }
  assert_contains "$output" "Control Center UI review gate: due"
  assert_contains "$output" "$PENDING_REASON"
}

# A pending entry that is already on the base (an older one on main) does not
# block a later pull request without its own entry.
test_pending_entry_on_base_does_not_block_later_pull_requests() {
  local repo="${TMP_ROOT}/pending-on-base"
  setup_repo "$repo"
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Change customer-facing UI"
  pending_approval_entry "Pending overview" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" add docs/control-center-customer-ui-approval.md
  git -C "$repo" commit -q -m "Pending approval for overview"
  git -C "$repo" update-ref refs/remotes/origin/main HEAD
  local base_branch
  base_branch="$(git -C "$repo" symbolic-ref --short HEAD)"

  git -C "$repo" checkout -q -b feature
  commit_file "$repo" "docs/unrelated-change.md" "Unrelated non-ui change"
  local feature_head
  feature_head="$(git -C "$repo" rev-parse HEAD)"
  expect_gate_success "$repo"

  git -C "$repo" checkout -q "$base_branch"
  commit_file "$repo" "docs/base-follow-up.md" "Base follow-up non-ui change"
  git -C "$repo" merge -q --no-ff "$feature_head" -m "Merge pull request"

  local output
  output="$(run_gate_pull_request "$repo")" || {
    printf '%s\n' "$output" >&2
    die "expected later non-ui merge to pass the gate"
  }
  assert_contains "$output" "Control Center UI review gate: ok"
}

# An approval entry that names the UI file it covers in its own commit.
approval_entry_scoped() {
  local label="$1"
  local path="$2"
  printf '\n## %s\n\n- User approval: approved by Paul in the communicator chat, 2026-10-20 12:15: "Ja, so passt das."\n- Approved customer-visible result: %s\n- Scope: %s and this approval record.\n%s\n' \
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

# A path added under an older entry further down the record does not name the
# UI file for a new entry that the same commit adds above it.
test_path_under_older_entry_does_not_name_ui_file() {
  local repo="${TMP_ROOT}/path-under-older-entry"
  setup_repo "$repo"
  local record="$repo/docs/control-center-customer-ui-approval.md"
  printf '\nexport const visibleLabel = "Install";\n' \
    >> "$repo/apps/control-center/src/components/overview-screen.tsx"
  {
    head -n 1 "$record"
    approval_entry "Updated overview"
    tail -n +2 "$record"
    printf -- '- Note: apps/control-center/src/components/overview-screen.tsx\n'
  } > "${record}.new"
  mv "${record}.new" "$record"
  git -C "$repo" add apps/control-center/src/components/overview-screen.tsx \
    docs/control-center-customer-ui-approval.md
  git -C "$repo" commit -q -m "Approve overview at the top, note its path below"
  expect_gate_due "$repo"
}

# A merge that brings a UI change from the branch and records a scoped approval
# for it passes: the approval is read against the first parent, not as a combined diff.
test_scoped_merge_approval_passes() {
  local repo="${TMP_ROOT}/scoped-merge-approval"
  setup_repo "$repo"
  local base_branch
  base_branch="$(git -C "$repo" symbolic-ref --short HEAD)"

  git -C "$repo" checkout -q -b feature
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Feature customer-facing UI"
  git -C "$repo" checkout -q "$base_branch"
  commit_file "$repo" "docs/base-follow-up.md" "Base follow-up non-ui change"
  git -C "$repo" merge -q --no-ff --no-commit feature >/dev/null 2>&1
  approval_entry_scoped "Merged overview" \
    "apps/control-center/src/components/overview-screen.tsx" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" add docs/control-center-customer-ui-approval.md
  git -C "$repo" commit -q -m "Merge feature and record scoped approval"
  expect_gate_success "$repo"
}

# main takes squash merges, so a pull request's UI change and its entry become
# one commit there. That commit was gated in its pull request: neither main nor
# a later pull request is due because of it. A pull request's own approval
# commit with an unnamed UI file stays due.
test_squash_merge_on_main_does_not_block_later_pull_requests() {
  local repo="${TMP_ROOT}/squash-merge-on-main"
  setup_repo "$repo"
  local base_branch output status
  base_branch="$(git -C "$repo" symbolic-ref --short HEAD)"

  printf '\nexport const visibleLabel = "Install";\n' \
    >> "$repo/apps/control-center/src/components/overview-screen.tsx"
  approval_entry "Squashed overview" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" add apps/control-center/src/components/overview-screen.tsx \
    docs/control-center-customer-ui-approval.md
  git -C "$repo" commit -q -m "Squash merge of a UI pull request"
  git -C "$repo" update-ref refs/remotes/origin/main HEAD
  expect_gate_success "$repo"

  git -C "$repo" checkout -q -b docs-only
  commit_file "$repo" "docs/notes.md" "Non-UI pull request"
  local docs_head
  docs_head="$(git -C "$repo" rev-parse HEAD)"

  git -C "$repo" checkout -q -b unscoped "$base_branch"
  printf '\nexport const otherLabel = "Open";\n' \
    >> "$repo/apps/control-center/src/components/overview-screen.tsx"
  approval_entry "Unscoped overview" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" add apps/control-center/src/components/overview-screen.tsx \
    docs/control-center-customer-ui-approval.md
  git -C "$repo" commit -q -m "Change overview and approve it"
  local unscoped_head
  unscoped_head="$(git -C "$repo" rev-parse HEAD)"

  git -C "$repo" checkout -q --detach refs/remotes/origin/main
  git -C "$repo" merge -q --no-ff "$docs_head" -m "Merge pull request"
  output="$(run_gate_pull_request "$repo")" || {
    printf '%s\n' "$output" >&2
    die "expected a later pull request to pass after a squash merge on main"
  }
  assert_contains "$output" "Control Center UI review gate: ok"

  git -C "$repo" checkout -q --detach refs/remotes/origin/main
  git -C "$repo" merge -q --no-ff "$unscoped_head" -m "Merge pull request"
  set +e
  output="$(run_gate_pull_request "$repo")"
  status=$?
  set -e
  [[ "$status" -ne 0 ]] || {
    printf '%s\n' "$output" >&2
    die "expected the pull request's own unscoped approval commit to stay due"
  }
  assert_contains "$output" "Control Center UI review gate: due"
}

# An approval commit committed before the cutoff keeps the old rule: its own
# unnamed UI file passes, as it did before the path rule.
test_approval_commit_before_cutoff_keeps_old_rule() {
  local repo="${TMP_ROOT}/approval-before-cutoff"
  setup_repo "$repo"
  printf '\nexport const visibleLabel = "Install";\n' \
    >> "$repo/apps/control-center/src/components/overview-screen.tsx"
  approval_entry "Updated overview" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" add apps/control-center/src/components/overview-screen.tsx \
    docs/control-center-customer-ui-approval.md
  GIT_COMMITTER_DATE="2026-10-17T07:00:00Z" \
    git -C "$repo" commit -q -m "Change overview and approve it before the cutoff"
  expect_gate_success "$repo"
}

# Moving a UI file out of the UI folders is a change to that UI file.
test_ui_file_renamed_out_of_ui_folders_is_due() {
  local repo="${TMP_ROOT}/ui-renamed-away"
  setup_repo "$repo"
  git -C "$repo" mv apps/control-center/src/components/overview-screen.tsx \
    docs/overview-screen.md
  approval_entry "Moved overview" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" add docs/control-center-customer-ui-approval.md
  git -C "$repo" commit -q -m "Move overview out of the UI and approve it"
  expect_gate_due "$repo"
}

# How approvals are recorded (docs/control-center-customer-ui-approval.md).
# A UI change approved by an entry with the given approval line and What's new line.
approve_ui_change_with_approval_line() {
  local repo="$1" approval_line="$2" whats_new="${3-$WHATS_NEW_NONE}"
  approve_ui_change_with_lines "$repo" "$approval_line" \
    "- Approved customer-visible result: The overview reads Ready."
  if [[ "$whats_new" != "$WHATS_NEW_NONE" ]]; then
    sed "s/^- What's new: none — nothing a customer would look for\$/${whats_new//\//\\/}/" \
      "$repo/docs/control-center-customer-ui-approval.md" > "$repo/approval.new"
    mv "$repo/approval.new" "$repo/docs/control-center-customer-ui-approval.md"
    git -C "$repo" commit -q -am "What's new line"
  fi
}

NO_CHANGE_LINE="- User approval: no visible change – UI approval not needed (merge of main, no screen differs)"

# 1) approved by Paul in the communicator chat, with his quote and the time.
test_approved_by_paul_in_chat_passes() {
  local repo="${TMP_ROOT}/approved-by-paul"
  approve_ui_change_with_approval_line "$repo" \
    '- User approval: approved by Paul in the communicator chat, 2026-10-20 12:15: "Ja, so passt das."'
  expect_gate_success "$repo"
  # His words may contain the words pending or draft without undoing his yes.
  repo="${TMP_ROOT}/approved-by-paul-quote-draft"
  approve_ui_change_with_approval_line "$repo" \
    '- User approval: approved by Paul in the communicator chat, 2026-10-20 12:15: "Ja, der Draft ist gut."'
  expect_gate_success "$repo"
}

# 2) no visible change, with a reason.
test_no_visible_change_with_reason_passes() {
  local repo="${TMP_ROOT}/no-visible-change"
  approve_ui_change_with_approval_line "$repo" "$NO_CHANGE_LINE"
  expect_gate_success "$repo"
}

test_no_visible_change_needs_a_reason() {
  local repo="${TMP_ROOT}/no-visible-change-bare"
  approve_ui_change_with_approval_line "$repo" "- User approval: no visible change"
  expect_gate_due "$repo"
  assert_contains "$(run_gate "$repo")" "no visible change"

  repo="${TMP_ROOT}/no-visible-change-no-reason"
  approve_ui_change_with_approval_line "$repo" \
    "- User approval: no visible change – UI approval not needed"
  expect_gate_due "$repo"

  repo="${TMP_ROOT}/no-visible-change-empty-reason"
  approve_ui_change_with_approval_line "$repo" \
    "- User approval: no visible change – UI approval not needed (  )"
  expect_gate_due "$repo"
}

# A What's new notice is something the customer sees: no cover for it.
test_no_visible_change_cannot_announce_something_new() {
  local repo="${TMP_ROOT}/no-visible-change-whats-new"
  approve_ui_change_with_approval_line "$repo" "$NO_CHANGE_LINE" \
    "- What's new: \`provider-shortcut\`"
  expect_gate_due "$repo"
  assert_contains "$(run_gate "$repo")" "no visible change"
}

# The form also passes in entries of earlier commits of the change, and a
# pending entry next to it still fails.
test_no_visible_change_in_an_earlier_commit_passes() {
  local repo="${TMP_ROOT}/no-visible-change-earlier"
  setup_repo "$repo"
  git -C "$repo" update-ref refs/remotes/origin/main HEAD
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Merge of main touches UI files"
  printf '\n## Merge of main\n\n%s\n- Approved customer-visible result: No screen differs.\n- Scope: the merge and this approval record.\n%s\n' \
    "$NO_CHANGE_LINE" "$WHATS_NEW_NONE" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" add docs/control-center-customer-ui-approval.md
  git -C "$repo" commit -q -m "Record the merge of main"
  commit_approval "$repo" "Given overview"
  expect_gate_success "$repo"

  pending_approval_entry "Pending overview" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" add docs/control-center-customer-ui-approval.md
  git -C "$repo" commit -q -m "Pending approval for overview"
  expect_gate_due "$repo"
  assert_contains "$(run_gate "$repo")" "$PENDING_REASON"
}

# Text after Paul's closing quote does not undo his yes ("— entry: …", "(build …)").
test_approved_by_paul_may_be_followed_by_text() {
  local repo="${TMP_ROOT}/approved-by-paul-trailing"
  approve_ui_change_with_approval_line "$repo" \
    '- User approval: approved by Paul in the communicator chat, 2026-10-20 15:10: "rest passt" (build 7198) — entry: #663: Reset (no visible change) [2]'
  expect_gate_success "$repo"
  # A line that has no closing quote is still not the form.
  repo="${TMP_ROOT}/approved-by-paul-no-closing-quote"
  approve_ui_change_with_approval_line "$repo" \
    '- User approval: approved by Paul in the communicator chat, 2026-10-20 15:10: rest passt'
  expect_gate_due "$repo"
}

# Text after the reason is outside the accepted form (Codex review of #823);
# nested brackets and a " [2]" suffix stay inside it.
test_no_visible_change_ends_after_its_reason() {
  local repo="${TMP_ROOT}/no-visible-change-trailing"
  approve_ui_change_with_approval_line "$repo" \
    "- User approval: no visible change – UI approval not needed (tests) despite changing the screen"
  expect_gate_due "$repo"
  assert_contains "$(run_gate "$repo")" "no visible change"

  repo="${TMP_ROOT}/no-visible-change-nested"
  approve_ui_change_with_approval_line "$repo" \
    "- User approval: no visible change – UI approval not needed (merge into #783; entry: #674: marker (no visible change)) [2]"
  expect_gate_success "$repo"
}

# A "no visible change" entry is no approval from Paul (Codex review of #823):
# it covers an earlier UI commit only when it names that file. Entries before
# the rule's cutoff keep the old behaviour (test_no_visible_change_with_reason_passes).
test_no_visible_change_does_not_cover_earlier_ui() {
  local repo="${TMP_ROOT}/no-visible-change-earlier-ui"
  setup_repo "$repo"
  export GIT_COMMITTER_DATE="2026-10-23T07:00:00Z"
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Unapproved visible UI change"
  commit_file "$repo" "companion/fix.go" "Companion fix"
  printf '\n## Companion fix\n\n%s\n- Approved customer-visible result: No screen differs.\n- Scope: companion/fix.go and this approval record.\n%s\n' \
    "$NO_CHANGE_LINE" "$WHATS_NEW_NONE" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" add docs/control-center-customer-ui-approval.md
  git -C "$repo" commit -q -m "Record the companion fix"
  expect_gate_due "$repo"
  assert_contains "$(run_gate "$repo")" "apps/control-center/src/components/overview-screen.tsx"

  # Naming the UI file covers it.
  repo="${TMP_ROOT}/no-visible-change-names-ui"
  setup_repo "$repo"
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "UI change without a visible difference"
  printf '\n## Overview refactor\n\n%s\n- Approved customer-visible result: No screen differs.\n- Scope: apps/control-center/src/components/overview-screen.tsx and this approval record.\n%s\n' \
    "$NO_CHANGE_LINE" "$WHATS_NEW_NONE" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" add docs/control-center-customer-ui-approval.md
  git -C "$repo" commit -q -m "Record the overview refactor"
  expect_gate_success "$repo"
  export GIT_COMMITTER_DATE="2026-10-18T07:00:00Z"
}

# Nor does it hide the UI an earlier approval commit changed without naming it
# (Paul's review of #823 at 96571e7d).
test_no_visible_change_keeps_earlier_unscoped_approval_ui_due() {
  local repo="${TMP_ROOT}/no-visible-change-after-unscoped-approval"
  setup_repo "$repo"
  export GIT_COMMITTER_DATE="2026-10-23T07:00:00Z"
  printf 'export const A = 1;\n' > "$repo/apps/control-center/src/components/a.tsx"
  approval_entry "Component A" >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" add .
  git -C "$repo" commit -q -m "Add a.tsx with an entry that does not name it"
  expect_gate_due "$repo"
  mkdir -p "$repo/companion"
  printf 'package main\n' > "$repo/companion/fix.go"
  printf '\n## Companion fix\n\n%s\n- Approved customer-visible result: No screen differs.\n- Scope: companion/fix.go and this approval record.\n%s\n' \
    "$NO_CHANGE_LINE" "$WHATS_NEW_NONE" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" add .
  git -C "$repo" commit -q -m "Companion fix, recorded as no visible change"
  expect_gate_due "$repo"
  assert_contains "$(run_gate "$repo")" "apps/control-center/src/components/a.tsx"
  export GIT_COMMITTER_DATE="2026-10-18T07:00:00Z"
}

# UI files the branch takes from its base with an unrecorded merge of main are
# approved there: a later no-visible-change entry need not name them.
test_no_visible_change_after_merge_of_base_ui_passes() {
  local repo="${TMP_ROOT}/no-visible-change-after-base-merge"
  setup_repo "$repo"
  export GIT_COMMITTER_DATE="2026-10-23T07:00:00Z"
  local base main_tip
  base="$(git -C "$repo" rev-parse HEAD)"
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "UI change on main"
  main_tip="$(git -C "$repo" rev-parse HEAD)"
  git -C "$repo" update-ref refs/remotes/origin/main "$main_tip"
  git -C "$repo" reset -q --hard "$base"
  commit_file "$repo" "companion/other.go" "Branch work"
  git -C "$repo" merge -q --no-ff --no-edit -m "Merge main" "$main_tip"
  commit_file "$repo" "companion/fix.go" "Companion fix"
  printf '\n## Companion fix\n\n%s\n- Approved customer-visible result: No screen differs.\n- Scope: companion/fix.go and this approval record.\n%s\n' \
    "$NO_CHANGE_LINE" "$WHATS_NEW_NONE" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" add docs/control-center-customer-ui-approval.md
  git -C "$repo" commit -q -m "Record the companion fix"
  expect_gate_success "$repo"
  export GIT_COMMITTER_DATE="2026-10-18T07:00:00Z"
}

# An entry first committed as pending and later corrected in place to "no
# visible change" is judged as it reads now (Codex review of #823 at 67c6d359):
# it covers the earlier UI only when it names it.
test_corrected_no_visible_change_entry_needs_its_scope() {
  local repo="${TMP_ROOT}/no-visible-change-corrected"
  setup_repo "$repo"
  export GIT_COMMITTER_DATE="2026-10-23T07:00:00Z"
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Unapproved visible UI change"
  mkdir -p "$repo/companion"
  printf 'package main\n' > "$repo/companion/fix.go"
  printf '\n## Companion fix\n\n- User approval: pending — Paul reviews this PR (test).\n- Approved customer-visible result: No screen differs.\n- Scope: companion/fix.go and this approval record.\n%s\n' \
    "$WHATS_NEW_NONE" >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" add .
  git -C "$repo" commit -q -m "Companion fix, approval pending"
  expect_gate_due "$repo"
  NO_CHANGE_LINE="$NO_CHANGE_LINE" perl -pi -e 's/^- User approval: pending — Paul reviews this PR \(test\)\.$/$ENV{NO_CHANGE_LINE}/' \
    "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" commit -q -am "Correct the entry to no visible change"
  expect_gate_due "$repo"
  assert_contains "$(run_gate "$repo")" "apps/control-center/src/components/overview-screen.tsx"
  export GIT_COMMITTER_DATE="2026-10-18T07:00:00Z"
}

# A fenced or indented example in the log is no entry (Codex review of #823 at
# 96571e7d): it does not cover the UI change before it.
test_code_example_in_log_is_no_entry() {
  local repo="${TMP_ROOT}/fenced-example"
  setup_repo "$repo"
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Unapproved visible UI change"
  { printf '\nExample of an entry:\n\n```markdown'; approval_entry "Example entry"; printf '```\n'; } \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" commit -q -am "Add an example entry in a code block"
  expect_gate_due "$repo"

  repo="${TMP_ROOT}/indented-example"
  setup_repo "$repo"
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Unapproved visible UI change"
  { printf '\nExample of an entry:\n'; approval_entry "Indented example" | sed 's/^/    /'; } \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" commit -q -am "Add an indented example entry"
  expect_gate_due "$repo"
}

# A fake entry inserted into a code block that is already in the log is no
# entry either (Codex review of #823 at a6d563b4): the fence opens in an
# unchanged line the change does not touch.
test_entry_inside_existing_code_block_is_no_entry() {
  local repo="${TMP_ROOT}/entry-in-existing-fence"
  setup_repo "$repo"
  printf '\nExample of an entry:\n\n~~~markdown\nplaceholder\n~~~\n' \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" commit -q -am "Add an example block"
  git -C "$repo" update-ref refs/remotes/origin/main HEAD
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Unapproved visible UI change"
  ENTRY="$(approval_entry "Fake inside the block")" perl -0pi -e 's/placeholder\n/placeholder\n$ENV{ENTRY}\n/' \
    "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" commit -q -am "Insert an entry into the example block"
  expect_gate_due "$repo"
}

# An entry that reuses the heading of an older one and is removed again
# approves nothing (Codex review of #823 at a6d563b4): the older entry with the
# same heading does not keep it alive.
test_removed_entry_with_duplicate_heading_does_not_cover_ui() {
  local repo="${TMP_ROOT}/removed-duplicate-heading"
  setup_repo "$repo"
  commit_approval "$repo" "Same heading"
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Unapproved visible UI change"
  printf '\n## Same heading\n\n- User approval: approved by Paul in the communicator chat, 2026-10-21 08:00: "Ja (second entry)."\n- Approved customer-visible result: Second entry.\n- Scope: the second entry and this approval record.\n%s\n' \
    "$WHATS_NEW_NONE" >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" commit -q -am "Approve with a second entry of the same heading"
  expect_gate_success "$repo"
  perl -0pi -e 's/\n## Same heading\n\n- User approval: approved by Paul in the communicator chat, 2026-10-21 08:00:.*\z//s' \
    "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" commit -q -am "Remove the second entry again"
  expect_gate_due "$repo"
  assert_contains "$(run_gate "$repo")" "apps/control-center/src/components/overview-screen.tsx"
}

# An entry committed as "no visible change" and corrected in place to Paul's
# approval counts as Paul's approval (Codex review of #823 at a6d563b4).
test_no_visible_change_corrected_to_paul_approval_covers_ui() {
  local repo="${TMP_ROOT}/no-visible-change-corrected-to-approval"
  setup_repo "$repo"
  export GIT_COMMITTER_DATE="2026-10-23T07:00:00Z"
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Visible UI change"
  commit_file "$repo" "companion/fix.go" "Companion fix"
  printf '\n## Companion fix\n\n%s\n- Approved customer-visible result: No screen differs.\n- Scope: companion/fix.go and this approval record.\n%s\n' \
    "$NO_CHANGE_LINE" "$WHATS_NEW_NONE" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" commit -q -am "Record the companion fix"
  expect_gate_due "$repo"
  NO_CHANGE_LINE="$NO_CHANGE_LINE" perl -pi -e 's/^\Q$ENV{NO_CHANGE_LINE}\E$/- User approval: approved by Paul in the communicator chat, 2026-10-23 09:00: "Ja, die Übersicht passt so."/' \
    "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" commit -q -am "Correct the entry to Paul's approval"
  expect_gate_success "$repo"
  export GIT_COMMITTER_DATE="2026-10-18T07:00:00Z"
}

# A code fence closes only with a fence of the same character at least as long
# as its opener (Codex review of #823 at 9e04e77e): a three-backtick line inside
# a four-backtick example keeps it open.
test_fence_closes_only_with_its_own_length() {
  local repo="${TMP_ROOT}/fence-length"
  setup_repo "$repo"
  printf '\nExample of an entry:\n\n\x60\x60\x60\x60markdown\n\x60\x60\x60\nplaceholder\n\x60\x60\x60\x60\n' \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" commit -q -am "Add an example block with an inner fence line"
  git -C "$repo" update-ref refs/remotes/origin/main HEAD
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Unapproved visible UI change"
  ENTRY="$(approval_entry "Fake after the inner fence line")" perl -0pi -e 's/placeholder\n/placeholder\n$ENV{ENTRY}\n/' \
    "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" commit -q -am "Insert an entry after the inner fence line"
  expect_gate_due "$repo"
}

# Only the Scope names the files an entry covers (Codex review of #823 at
# 9e04e77e): a path in the result text does not cover it.
test_path_outside_scope_does_not_cover_ui() {
  local repo="${TMP_ROOT}/path-outside-scope"
  local ui="apps/control-center/src/components/overview-screen.tsx"
  setup_repo "$repo"
  printf 'export const Changed = true;\n' >> "$repo/$ui"
  printf '\n## Docs touch-up\n\n- User approval: approved by Paul in the communicator chat, 2026-10-21 08:00: "Ja (docs touch-up)."\n- Approved customer-visible result: The help text reads better; %s is untouched.\n- Scope: docs only and this approval record.\n%s\n' \
    "$ui" "$WHATS_NEW_NONE" >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" add .
  git -C "$repo" commit -q -m "Change UI with an entry whose Scope excludes it"
  expect_gate_due "$repo"
  assert_contains "$(run_gate "$repo")" "$ui"

  repo="${TMP_ROOT}/no-visible-change-path-outside-scope"
  setup_repo "$repo"
  export GIT_COMMITTER_DATE="2026-10-23T07:00:00Z"
  commit_file "$repo" "$ui" "Unapproved visible UI change"
  commit_file "$repo" "companion/fix.go" "Companion fix"
  printf '\n## Companion fix\n\n%s\n- Approved customer-visible result: No screen differs; %s stays as it is.\n- Scope: companion/fix.go and this approval record.\n%s\n' \
    "$NO_CHANGE_LINE" "$ui" "$WHATS_NEW_NONE" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" commit -q -am "Record the companion fix"
  expect_gate_due "$repo"
  assert_contains "$(run_gate "$repo")" "$ui"
  export GIT_COMMITTER_DATE="2026-10-18T07:00:00Z"
}

# An approval entry that a later commit removes again approves nothing (Codex
# review of #823): the UI change before it is due again.
test_removed_approval_entry_does_not_cover_ui() {
  local repo="${TMP_ROOT}/approval-removed"
  setup_repo "$repo"
  git -C "$repo" update-ref refs/remotes/origin/main HEAD
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Change customer-facing UI"
  pending_approval_entry "Pending overview" \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" add docs/control-center-customer-ui-approval.md
  git -C "$repo" commit -q -m "Pending approval for overview"
  git -C "$repo" show HEAD~1:docs/control-center-customer-ui-approval.md \
    > "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" commit -q -am "Drop the entry again"
  expect_gate_due "$repo"
}

# 3) everything else stays pending and fails.
test_pending_and_draft_stay_due_next_to_the_new_forms() {
  local repo="${TMP_ROOT}/pending-line"
  approve_ui_change_with_approval_line "$repo" \
    "- User approval: pending — Paul reviews this PR (test)."
  expect_gate_due "$repo"
  assert_contains "$(run_gate "$repo")" "$PENDING_REASON"

  repo="${TMP_ROOT}/draft-line"
  approve_ui_change_with_approval_line "$repo" "- User approval: draft, waiting for Paul."
  expect_gate_due "$repo"
  assert_contains "$(run_gate "$repo")" "$PENDING_REASON"

  # Not the full form of 1): quoting nothing, no time, or pending next to it.
  repo="${TMP_ROOT}/approved-by-paul-pending"
  approve_ui_change_with_approval_line "$repo" \
    "- User approval: approved by Paul in the communicator chat, pending his quote."
  expect_gate_due "$repo"
}

# Every added "User approval:" value must be one of the accepted forms; free
# text, an incomplete "approved by Paul" or a missing line is no approval.
test_unrecognized_approval_value_is_due() {
  local repo
  local label=0
  local value
  for value in \
    "Explicit test approval." \
    "approved by Paul in the communicator chat" \
    "approved by Paul in the communicator chat, 2026-10-20 12:15" \
    'approved by Paul in the communicator chat, 2026-10-20: "Ja."' \
    'approved by Paul in the communicator chat, 2026-10-20 12:15: ""' \
    "Paul asked for this change in the issue." \
    "approved"; do
    label=$((label + 1))
    repo="${TMP_ROOT}/unrecognized-approval-${label}"
    approve_ui_change_with_approval_line "$repo" "- User approval: ${value}"
    expect_gate_due "$repo"
    assert_contains "$(run_gate "$repo")" "none of the accepted forms"
  done

  # An earlier entry of the same change is checked too, and so is a missing line.
  repo="${TMP_ROOT}/unrecognized-approval-earlier"
  setup_repo "$repo"
  git -C "$repo" update-ref refs/remotes/origin/main HEAD
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Change customer-facing UI"
  printf '\n## Free text\n\n- User approval: Looks good.\n- Approved customer-visible result: Free text\n%s\n' \
    "$WHATS_NEW_NONE" >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" add docs/control-center-customer-ui-approval.md
  git -C "$repo" commit -q -m "Free text approval"
  commit_approval "$repo" "Given later"
  expect_gate_due "$repo"
  assert_contains "$(run_gate "$repo")" "none of the accepted forms"
}

# The approval log grows past execFileSync's default 1 MiB buffer on long-lived
# branches; the gate must still read the whole diff (#823).
test_approval_log_over_one_mib_is_read() {
  local repo="${TMP_ROOT}/big-log"
  setup_repo "$repo"
  python3 -c 'import sys; sys.stdout.write("".join("\n## filler %d\n\n- %s\n" % (i, "x" * 200) for i in range(6000)))' \
    >> "$repo/docs/control-center-customer-ui-approval.md"
  git -C "$repo" add docs/control-center-customer-ui-approval.md
  git -C "$repo" commit -q -m "Big approval log on base"
  git -C "$repo" update-ref refs/remotes/origin/main HEAD
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Change customer-facing UI"
  commit_approval "$repo" "Updated overview after a big log"
  expect_gate_success "$repo"
}

# --- Per-entry checks ported from #882 (#799) ---

APPROVAL_LOG="docs/control-center-customer-ui-approval.md"

# A repo with the base marked, a UI change, a first entry written with the given
# lines, then a valid second entry: the first one must not hide behind it.
first_entry_then_valid() {
  local repo="$1" entry="$2"
  setup_repo "$repo"
  git -C "$repo" update-ref refs/remotes/origin/main HEAD
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Change customer-facing UI"
  printf '%b' "$entry" >> "$repo/$APPROVAL_LOG"
  git -C "$repo" add "$APPROVAL_LOG"
  git -C "$repo" commit -q -m "First entry"
  commit_approval "$repo" "Valid second"
}

GIVEN='- User approval: approved by Paul in the communicator chat, 2026-10-20 12:15: "Ja, passt (first)."\n'
RESULT='- Approved customer-visible result: First\n'
SCOPE='- Scope: first and this approval record.\n'
NONE_NEW="- What's new: none — nothing a customer would look for\\n"

test_every_added_entry_needs_all_four_fields() {
  local repo name entry
  for name in scope empty-scope whats-new empty-whats-new result approval; do
    case "$name" in
      scope) entry="\n## First\n\n${GIVEN}${RESULT}${NONE_NEW}" ;;
      empty-scope) entry="\n## First\n\n${GIVEN}${RESULT}- Scope:\n${NONE_NEW}" ;;
      whats-new) entry="\n## First\n\n${GIVEN}${RESULT}${SCOPE}" ;;
      empty-whats-new) entry="\n## First\n\n${GIVEN}${RESULT}${SCOPE}- What's new:\n" ;;
      result) entry="\n## First\n\n${GIVEN}${SCOPE}${NONE_NEW}" ;;
      approval) entry="\n## First\n\n${RESULT}${SCOPE}${NONE_NEW}" ;;
    esac
    repo="${TMP_ROOT}/fields-${name}"
    first_entry_then_valid "$repo" "$entry"
    expect_gate_due "$repo"
    assert_contains "$(run_gate "$repo")" "First"
  done
  # A What's new id that is not in the list fails in an earlier entry too.
  repo="${TMP_ROOT}/fields-unknown-id"
  first_entry_then_valid "$repo" "\n## First\n\n${GIVEN}${RESULT}${SCOPE}- What's new: \`not-an-entry\`\n"
  expect_gate_due "$repo"
  assert_contains "$(run_gate "$repo")" "First"
}

test_complete_earlier_entry_passes() {
  local repo="${TMP_ROOT}/fields-complete"
  first_entry_then_valid "$repo" "\n## First\n\n${GIVEN}${RESULT}${SCOPE}${NONE_NEW}"
  expect_gate_success "$repo"
}

test_approval_line_is_one_per_entry_and_unique() {
  local repo
  repo="${TMP_ROOT}/approval-twice-in-entry"
  first_entry_then_valid "$repo" "\n## First\n\n${GIVEN}${GIVEN}${RESULT}${SCOPE}${NONE_NEW}"
  expect_gate_due "$repo"
  assert_contains "$(run_gate "$repo")" "First"

  # The same line in two added entries.
  repo="${TMP_ROOT}/approval-same-in-two"
  first_entry_then_valid "$repo" "\n## First\n\n${GIVEN}${RESULT}${SCOPE}${NONE_NEW}\n## Copy\n\n${GIVEN}${RESULT}${SCOPE}${NONE_NEW}"
  expect_gate_due "$repo"
  assert_contains "$(run_gate "$repo")" "Copy"

  # The same line as an entry already in the log.
  repo="${TMP_ROOT}/approval-same-as-base"
  first_entry_then_valid "$repo" "\n## First\n\n- User approval: approved by Paul in the communicator chat, 2026-10-20 12:15: \"Ja, so passt das (Initial UI).\"\n${RESULT}${SCOPE}${NONE_NEW}"
  expect_gate_due "$repo"
  assert_contains "$(run_gate "$repo")" "First"
}

# A Windows checkout with CRLF must neither fail a valid entry nor make entries
# of the base look added.
test_crlf_approval_log() {
  local repo="${TMP_ROOT}/crlf-entry"
  setup_repo "$repo"
  git -C "$repo" update-ref refs/remotes/origin/main HEAD
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Change customer-facing UI"
  approval_entry "Valid in CRLF" >> "$repo/$APPROVAL_LOG"
  perl -pi -e 's/\n/\r\n/' "$repo/$APPROVAL_LOG"
  git -C "$repo" add "$APPROVAL_LOG"
  git -C "$repo" commit -q -m "Approve with CRLF"
  expect_gate_success "$repo"

  # The base holds a pending entry; converting the file to CRLF re-adds it as text.
  repo="${TMP_ROOT}/crlf-base"
  setup_repo "$repo"
  pending_approval_entry "Old pending" >> "$repo/$APPROVAL_LOG"
  git -C "$repo" add "$APPROVAL_LOG"
  git -C "$repo" commit -q -m "Pending on base"
  git -C "$repo" update-ref refs/remotes/origin/main HEAD
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Change customer-facing UI"
  perl -pi -e 's/\n/\r\n/' "$repo/$APPROVAL_LOG"
  git -C "$repo" add "$APPROVAL_LOG"
  git -C "$repo" commit -q -m "Convert to CRLF"
  commit_approval "$repo" "Valid after CRLF"
  expect_gate_success "$repo"
}

# Without the comparison base the added entries cannot be known: not ok.
test_missing_comparison_base_fails_closed() {
  local repo="${TMP_ROOT}/no-base"
  setup_repo "$repo"
  git -C "$repo" update-ref -d refs/remotes/origin/main
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Change customer-facing UI"
  commit_approval "$repo" "Updated overview"
  local output status
  set +e
  output="$(run_gate "$repo")"
  status=$?
  set -e
  [[ "$status" -ne 0 ]] || die "expected the gate to fail without a comparison base"
  assert_not_contains "$output" "Control Center UI review gate: ok"
  assert_contains "$output" "comparison base"
}

# A required git read that fails is no empty answer.
test_failed_git_read_fails_closed() {
  local repo="${TMP_ROOT}/git-read-fails"
  setup_repo "$repo"
  git -C "$repo" update-ref refs/remotes/origin/main HEAD
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Change customer-facing UI"
  pending_approval_entry "Pending first" >> "$repo/$APPROVAL_LOG"
  git -C "$repo" add "$APPROVAL_LOG"
  git -C "$repo" commit -q -m "Pending first"
  commit_approval "$repo" "Valid second"
  # The diff of the approval log fails: an empty answer would hide the pending entry.
  local shim="${TMP_ROOT}/shim" real output status
  real="$(command -v git)"
  mkdir -p "$shim"
  printf '#!/bin/bash\n[[ " $* " == *" --unified=0 "* && " $* " == *" HEAD "* ]] && { echo "fatal: simulated" >&2; exit 128; }\nexec %s "$@"\n' "$real" > "$shim/git"
  chmod +x "$shim/git"
  set +e
  output="$(cd "$repo" && PATH="$shim:$PATH" GITHUB_ACTIONS= GITHUB_EVENT_NAME= node "$GATE" 2>&1)"
  status=$?
  set -e
  [[ "$status" -ne 0 ]] || die "expected the gate to fail when a git read fails"
  assert_not_contains "$output" "Control Center UI review gate: ok"
}

test_whitespace_only_quote_is_no_approval() {
  local repo
  repo="${TMP_ROOT}/blank-quote"
  approve_ui_change_with_approval_line "$repo" \
    '- User approval: approved by Paul in the communicator chat, 2026-10-20 12:15: "   "'
  expect_gate_due "$repo"
  repo="${TMP_ROOT}/blank-quote-text"
  approve_ui_change_with_approval_line "$repo" \
    '- User approval: approved by Paul in the communicator chat, 2026-10-20 12:15: "  " — entry: "x"'
  expect_gate_due "$repo"
}

test_pending_outside_the_quote_is_no_approval() {
  local repo="${TMP_ROOT}/pending-outside"
  approve_ui_change_with_approval_line "$repo" \
    '- User approval: approved by Paul in the communicator chat, 2026-10-20 12:15: "Ja, passt." — pending his final OK'
  expect_gate_due "$repo"
  assert_contains "$(run_gate "$repo")" "$PENDING_REASON"
}


test_non_ui_commits_do_not_block
test_approval_log_over_one_mib_is_read
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
test_pending_approval_is_due
test_draft_approval_is_due
test_approval_pending_review_is_due
test_markdown_draft_result_is_due
test_pending_entry_corrected_later_passes
test_correction_commit_does_not_cover_its_own_ui
test_result_that_describes_a_draft_passes
test_pending_entry_before_a_given_one_is_due
test_every_entry_since_base_is_checked
test_pull_request_checks_every_entry_it_adds
test_pending_entry_on_base_does_not_block_later_pull_requests
test_ui_change_in_approval_commit_needs_its_scope
test_ui_change_in_approval_commit_passes_when_entry_names_it
test_merge_commit_with_approval_needs_scope_for_branch_ui
test_named_path_must_match_whole_file
test_merge_of_approved_base_needs_no_rescope
test_merged_parent_approval_is_judged_on_its_own_tree
test_path_outside_entry_does_not_name_ui_file
test_path_under_older_entry_does_not_name_ui_file
test_ui_file_renamed_out_of_ui_folders_is_due
test_approval_commit_before_cutoff_keeps_old_rule
test_scoped_merge_approval_passes
test_squash_merge_on_main_does_not_block_later_pull_requests
test_approved_by_paul_in_chat_passes
test_no_visible_change_with_reason_passes
test_no_visible_change_needs_a_reason
test_no_visible_change_cannot_announce_something_new
test_no_visible_change_in_an_earlier_commit_passes
test_approved_by_paul_may_be_followed_by_text
test_no_visible_change_ends_after_its_reason
test_removed_approval_entry_does_not_cover_ui
test_no_visible_change_does_not_cover_earlier_ui
test_no_visible_change_keeps_earlier_unscoped_approval_ui_due
test_no_visible_change_after_merge_of_base_ui_passes
test_corrected_no_visible_change_entry_needs_its_scope
test_code_example_in_log_is_no_entry
test_entry_inside_existing_code_block_is_no_entry
test_removed_entry_with_duplicate_heading_does_not_cover_ui
test_no_visible_change_corrected_to_paul_approval_covers_ui
test_fence_closes_only_with_its_own_length
test_path_outside_scope_does_not_cover_ui
test_pending_and_draft_stay_due_next_to_the_new_forms
test_unrecognized_approval_value_is_due
test_every_added_entry_needs_all_four_fields
test_complete_earlier_entry_passes
test_approval_line_is_one_per_entry_and_unique
test_crlf_approval_log
test_missing_comparison_base_fails_closed
test_failed_git_read_fails_closed
test_whitespace_only_quote_is_no_approval
test_pending_outside_the_quote_is_no_approval

printf 'control-center UI review gate tests passed\n'
