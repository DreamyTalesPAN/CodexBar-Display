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
  printf '\n## %s\n\n- User approval: no visible change – UI approval not needed (%s test)\n- Approved customer-visible result: %s\n- Scope: gate test fixture\n' \
    "$label" "$label" "$label"
  [[ -z "$whats_new" ]] || printf '%s\n' "$whats_new"
}

# An entry that waits for Paul's yes in the PR review: the gate passes with a notice.
pending_approval_entry() {
  local label="$1"
  printf '\n## %s\n\n- User approval: pending — Paul reviews %s (test).\n- Approved customer-visible result: %s\n- Scope: gate test fixture\n%s\n' \
    "$label" "$label" "$label" "$WHATS_NEW_NONE"
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
  expect_gate_due "$repo"
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

  commit_approval "$repo" "Later non-pending entry"

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

# Regression: the newest valid marker must not hide a broken earlier commit.
test_first_broken_entry_is_named() {
  local repo="${TMP_ROOT}/first-broken"
  setup_repo "$repo"
  commit_approval "$repo" "First broken change" ""
  commit_approval "$repo" "Second valid change"
  expect_gate_due "$repo"
  local output
  output="$(run_gate "$repo" || true)"
  assert_contains "$output" "First broken change"
  assert_not_contains "$output" "Second valid change"
}

# Pending remains allowed even when followed by a non-pending entry.
test_earlier_pending_entry_prints_notice() {
  local repo="${TMP_ROOT}/earlier-pending"
  setup_repo "$repo"
  pending_approval_entry "First pending change" >> "$repo/docs/control-center-customer-ui-approval.md"
  commit_approval "$repo" "Second non-pending change"
  local output
  output="$(run_gate "$repo")" || die "expected pending followed by non-pending to pass"
  assert_contains "$output" "$PENDING_NOTICE"
}

# Validation applies to each whole entry, including staged/unstaged additions.
test_required_fields_and_approval_forms() {
  local kind repo output
  for kind in missing-scope duplicate duplicate-base multiple-approval bad-form unquoted approved invisible-period; do
    repo="${TMP_ROOT}/entry-${kind}"
    setup_repo "$repo"
    case "$kind" in
      missing-scope)
        approval_entry "First missing scope" | sed '/^- Scope:/d' >> "$repo/docs/control-center-customer-ui-approval.md"
        ;;
      duplicate)
        approval_entry "First duplicate" >> "$repo/docs/control-center-customer-ui-approval.md"
        approval_entry "Second duplicate" | sed 's/(Second duplicate test)/(First duplicate test)/' >> "$repo/docs/control-center-customer-ui-approval.md"
        ;;
      duplicate-base)
        approval_entry "Initial UI" >> "$repo/docs/control-center-customer-ui-approval.md"
        ;;
      multiple-approval)
        approval_entry "First multiple approval" >> "$repo/docs/control-center-customer-ui-approval.md"
        printf '%s\n' '- User approval: pending — a second approval line' >> "$repo/docs/control-center-customer-ui-approval.md"
        ;;
      bad-form)
        approval_entry "First bad form" | sed 's/^- User approval:.*/- User approval: implementation agent says OK/' >> "$repo/docs/control-center-customer-ui-approval.md"
        ;;
      unquoted)
        approval_entry "First unquoted" | sed 's/^- User approval:.*/- User approval: approved by Paul in chat/' >> "$repo/docs/control-center-customer-ui-approval.md"
        ;;
      invisible-period)
        approval_entry "First invisible" | sed '/^- User approval:/s/$/./' >> "$repo/docs/control-center-customer-ui-approval.md"
        ;;
      approved)
        approval_entry "First quoted" | sed 's/^- User approval:.*/- User approval: approved by Paul in chat: "yes, that layout"/' >> "$repo/docs/control-center-customer-ui-approval.md"
        ;;
    esac
    git -C "$repo" add docs/control-center-customer-ui-approval.md
    approval_entry "Last valid change" >> "$repo/docs/control-center-customer-ui-approval.md"
    if [[ "$kind" == approved || "$kind" == invisible-period ]]; then
      expect_gate_success "$repo"
    else
      expect_gate_due "$repo"
      output="$(run_gate "$repo" || true)"
      assert_not_contains "$output" "Last valid change"
      case "$kind" in
        missing-scope) assert_contains "$output" 'First missing scope: missing Scope:' ;;
        duplicate)
          assert_contains "$output" 'First duplicate: User approval:'
          assert_contains "$output" 'Second duplicate: User approval:' ;;
        duplicate-base) assert_contains "$output" 'Initial UI: User approval:' ;;
        *) assert_contains "$output" 'First ' ;;
      esac
    fi
  done
}

# Old base entries are not retroactively validated; even a base that advanced
# after branching must not hide an entry introduced by this branch.
test_merge_base_scopes_validation() {
  local repo="${TMP_ROOT}/merge-base-scope" output feature_head base_branch
  setup_repo "$repo"
  commit_approval "$repo" "Historical incomplete entry" ""
  commit_approval "$repo" "Historical valid marker"
  git -C "$repo" update-ref refs/remotes/origin/main HEAD
  expect_gate_success "$repo"
  base_branch="$(git -C "$repo" symbolic-ref --short HEAD)"
  git -C "$repo" checkout -q -b feature
  commit_approval "$repo" "Branch first broken entry" ""
  commit_approval "$repo" "Branch last valid entry"
  feature_head="$(git -C "$repo" rev-parse HEAD)"
  git -C "$repo" checkout -q "$base_branch"
  commit_file "$repo" "docs/base-follow-up.md" "Advance base"
  git -C "$repo" merge -q --no-ff "$feature_head" -m "Merge pull request"
  if output="$(run_gate_pull_request "$repo")"; then
    die "expected earlier broken PR entry to fail on the merge checkout"
  fi
  assert_contains "$output" 'Branch first broken entry: missing'
  assert_not_contains "$output" 'Historical incomplete entry'
  assert_not_contains "$output" 'Branch last valid entry'
}

# A Windows autocrlf checkout: the working file has CRLF, the base blob has LF.
# Old entries must still count as already present, not as new.
test_crlf_working_copy_keeps_base_entries() {
  local repo="${TMP_ROOT}/crlf-working-copy"
  setup_repo "$repo"
  commit_approval "$repo" "Historical incomplete entry" ""
  git -C "$repo" update-ref refs/remotes/origin/main HEAD
  git -C "$repo" config core.autocrlf true
  local file="$repo/docs/control-center-customer-ui-approval.md"
  sed $'s/$/\r/' "$file" > "$file.crlf" && mv "$file.crlf" "$file"
  approval_entry "CRLF change" | sed $'s/$/\r/' >> "$file"
  expect_gate_success "$repo"
}

# Evidence lines above the first "## " entry belong to no entry; the gate must
# not accept them just because the diff adds them.
test_headless_evidence_lines_fail() {
  local repo="${TMP_ROOT}/headless-evidence"
  local log="$repo/docs/control-center-customer-ui-approval.md"
  local output
  setup_repo "$repo"
  commit_file "$repo" "apps/control-center/src/components/overview-screen.tsx" \
    "Change customer-facing UI"
  {
    head -n 1 "$log"
    printf '%s\n' \
      '- User approval: no visible change – UI approval not needed (headless test)' \
      '- Approved customer-visible result: headless test' \
      "$WHATS_NEW_NONE"
    tail -n +2 "$log"
  } > "${TMP_ROOT}/headless.md"
  mv "${TMP_ROOT}/headless.md" "$log"
  git -C "$repo" add docs/control-center-customer-ui-approval.md
  git -C "$repo" commit -q -m "Append approval evidence without a heading"
  output="$(run_gate "$repo")" && die "expected headless approval evidence to fail the gate"
  assert_contains "$output" 'Approval evidence outside any "## " entry'
  assert_contains "$output" "User approval: no visible change"
}

# A large historical log must still expose an earlier invalid PR entry.
test_large_approval_log_is_validated() {
  local repo="${TMP_ROOT}/large-log" output
  setup_repo "$repo"
  node -e 'process.stdout.write("Historical context.\n".repeat(60000))' >> "$repo/docs/control-center-customer-ui-approval.md"
  commit_approval "$repo" "Large historical marker"
  commit_approval "$repo" "Small historical marker"
  git -C "$repo" update-ref refs/remotes/origin/main HEAD
  expect_gate_success "$repo"
  approval_entry "Earlier missing scope" | sed '/^- Scope:/d' >> "$repo/docs/control-center-customer-ui-approval.md"
  commit_approval "$repo" "Later valid marker"
  output="$(run_gate "$repo")" && die "expected large log to expose the invalid earlier entry"
  assert_contains "$output" 'Earlier missing scope: missing Scope:'
}

# A failed required blob read must never turn into an empty, valid log.
test_required_git_reads_fail_closed() {
  local repo="${TMP_ROOT}/read-failure" output spec
  setup_repo "$repo"
  commit_approval "$repo" "Valid new entry"
  mkdir -p "$repo/bin"
  printf '#!/usr/bin/env bash\nif [[ "$1" == show && "$2" == "$GATE_FAIL_SPEC" ]]; then\n  echo "simulated required read failure" >&2\n  exit 1\nfi\nexec "%s" "$@"\n' "$(command -v git)" > "$repo/bin/git"
  chmod +x "$repo/bin/git"
  for spec in "HEAD:docs/control-center-customer-ui-approval.md" "$(git -C "$repo" rev-parse origin/main):docs/control-center-customer-ui-approval.md" --format=; do
    output="$(PATH="$repo/bin:$PATH" GATE_FAIL_SPEC="$spec" run_gate "$repo")" && die "expected required read failure to block"
    assert_contains "$output" 'Required git read failed'
    assert_contains "$output" 'simulated required read failure'
    assert_not_contains "$output" 'gate: ok'
  done
}

# Missing refs and shallow history cannot narrow validation to the last marker.
test_missing_comparison_base_fails_closed() {
  local repo="${TMP_ROOT}/missing-base" output depth clone
  setup_repo "$repo"
  commit_approval "$repo" "Earlier broken entry" ""
  commit_approval "$repo" "Later valid entry"
  git -C "$repo" update-ref -d refs/remotes/origin/main
  output="$(run_gate "$repo")" && die "expected missing base to block"
  assert_contains "$output" 'Cannot determine approval comparison base'
  assert_not_contains "$output" 'gate: ok'
  for depth in 1 2; do
    clone="${TMP_ROOT}/shallow-${depth}"
    git clone -q --depth "$depth" "file://$repo" "$clone"
    git -C "$clone" update-ref -d refs/remotes/origin/main
    output="$(run_gate_pull_request "$clone")" && die "expected shallow history without a base to block"
    assert_contains "$output" 'Cannot determine approval comparison base'
    assert_contains "$output" 'history'
    assert_not_contains "$output" 'gate: ok'
  done
}

test_indented_pending_notice_reaches_ci_summary() {
  local repo="${TMP_ROOT}/indented-pending" output summary="${TMP_ROOT}/indented-summary.md"
  setup_repo "$repo"
  pending_approval_entry "Indented pending" | sed 's/^- /  - /' >> "$repo/docs/control-center-customer-ui-approval.md"
  commit_approval "$repo" "Later non-pending marker"
  output="$(GITHUB_STEP_SUMMARY="$summary" run_gate_pull_request "$repo")" || die "expected indented pending to pass"
  assert_contains "$output" "::notice title=Control Center UI approval pending::${PENDING_NOTICE}"
  assert_contains "$(cat "$summary")" "$PENDING_NOTICE"
}

test_whitespace_only_quotes_are_rejected() {
  local repo quote output index=0
  for quote in '" "' '“   ”' '„   “' '«   »'; do
    repo="${TMP_ROOT}/empty-quote-$((index++))"
    setup_repo "$repo"
    approval_entry "Whitespace quote" | sed "s/^- User approval:.*/- User approval: approved by Paul in chat: $quote/" >> "$repo/docs/control-center-customer-ui-approval.md"
    commit_approval "$repo" "Later valid entry"
    output="$(run_gate "$repo")" && die "expected whitespace-only quote to fail"
    assert_contains "$output" 'Whitespace quote: User approval: must be approved by Paul with a quote'
  done
}

test_push_validates_all_entries_since_previous_tip() {
  local repo="${TMP_ROOT}/push-base" output before event="${TMP_ROOT}/push-event.json"
  setup_repo "$repo"
  before="$(git -C "$repo" rev-parse HEAD)"
  approval_entry "Pushed missing scope" | sed '/^- Scope:/d' >> "$repo/docs/control-center-customer-ui-approval.md"
  commit_approval "$repo" "Pushed valid marker"
  git -C "$repo" update-ref refs/remotes/origin/main HEAD
  printf '{"before":"%s"}\n' "$before" > "$event"
  output="$(cd "$repo" && GITHUB_EVENT_NAME=push GITHUB_EVENT_PATH="$event" node "$GATE" 2>&1)" && die "expected earlier invalid pushed entry to fail"
  assert_contains "$output" 'Pushed missing scope: missing Scope:'
}

# Approval history is append-only: a valid replacement or later marker cannot
# legitimize rewriting or deleting a historical block alongside a UI change.
test_historical_entries_cannot_be_rewritten_or_deleted() {
  local kind repo output
  for kind in rewrite delete; do
    repo="${TMP_ROOT}/historical-${kind}"
    setup_repo "$repo"
    printf '# Control Center Customer UI Approvals\n' > "$repo/docs/control-center-customer-ui-approval.md"
    if [[ "$kind" == rewrite ]]; then
      approval_entry "Rewritten historical entry" >> "$repo/docs/control-center-customer-ui-approval.md"
    fi
    printf '\nexport const newLabel = "Changed";\n' >> "$repo/apps/control-center/src/components/overview-screen.tsx"
    git -C "$repo" add apps/control-center/src/components/overview-screen.tsx docs/control-center-customer-ui-approval.md
    git -C "$repo" commit -q -m "Change historical entry and UI"
    commit_approval "$repo" "Later valid marker"
    output="$(run_gate "$repo")" && die "expected historical $kind to fail"
    assert_contains "$output" 'Initial UI: historical approval entries are append-only'
  done
}

test_historical_entry_order_is_preserved() {
  local kind repo output
  for kind in reorder prepend; do
    repo="${TMP_ROOT}/historical-${kind}"
    setup_repo "$repo"
    commit_approval "$repo" "Second historical entry"
    git -C "$repo" update-ref refs/remotes/origin/main HEAD
    {
      printf '# Control Center Customer UI Approvals\n'
      if [[ "$kind" == reorder ]]; then
        approval_entry "Second historical entry"
        approval_entry "Initial UI"
      else
        approval_entry "Prepended new entry"
        approval_entry "Initial UI"
        approval_entry "Second historical entry"
      fi
    } > "$repo/docs/control-center-customer-ui-approval.md"
    git -C "$repo" add docs/control-center-customer-ui-approval.md
    git -C "$repo" commit -q -m "Change historical entry order"
    commit_approval "$repo" "Later valid marker"
    output="$(run_gate "$repo")" && die "expected historical $kind to fail"
    assert_contains "$output" 'Initial UI: historical approval entries are append-only'
  done
}

test_push_preserves_the_exact_previous_tip() {
  local repo="${TMP_ROOT}/rewritten-push" output ancestor before event="${TMP_ROOT}/rewritten-push-event.json"
  setup_repo "$repo"
  ancestor="$(git -C "$repo" rev-parse HEAD)"
  commit_approval "$repo" "Previous tip approval"
  before="$(git -C "$repo" rev-parse HEAD)"
  git -C "$repo" reset -q --hard "$ancestor"
  commit_approval "$repo" "Replacement tip approval"
  git -C "$repo" update-ref refs/remotes/origin/main HEAD
  printf '{"before":"%s"}\n' "$before" > "$event"
  output="$(cd "$repo" && GITHUB_EVENT_NAME=push GITHUB_EVENT_PATH="$event" node "$GATE" 2>&1)" && die "expected rewritten push to preserve previous approvals"
  assert_contains "$output" 'Previous tip approval: historical approval entries are append-only'
}

test_push_preserves_the_exact_previous_tip
test_historical_entry_order_is_preserved
test_historical_entries_cannot_be_rewritten_or_deleted
test_large_approval_log_is_validated
test_required_git_reads_fail_closed
test_missing_comparison_base_fails_closed
test_indented_pending_notice_reaches_ci_summary
test_whitespace_only_quotes_are_rejected
test_push_validates_all_entries_since_previous_tip
test_headless_evidence_lines_fail
test_required_fields_and_approval_forms
test_merge_base_scopes_validation
test_crlf_working_copy_keeps_base_entries
test_first_broken_entry_is_named
test_earlier_pending_entry_prints_notice
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

printf 'control-center UI review gate tests passed\n'
