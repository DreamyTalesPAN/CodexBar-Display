#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
}).trim();
process.chdir(repoRoot);

// The approval log is over 1 MiB on long-lived branches; execFileSync's default
// 1 MiB buffer would cut it and the gate would read an empty diff.
const GIT_MAX_BUFFER = 1 << 28;

// CRLF from a Windows autocrlf checkout must not make old entries look new.
const DIFF_OPTIONS = ["--unified=0", "--ignore-cr-at-eol"];

const APPROVAL_FILE = "docs/control-center-customer-ui-approval.md";
const PRINCIPLES_FILE = "docs/control-center-ui-principles.md";
// Approval commits committed after this moment must name the UI paths they
// change. Older commits were checked before that rule existed and keep the old
// behaviour, so open pull requests whose approval commits predate it do not
// start failing with this change.
const APPROVAL_COMMIT_PATH_RULE_SINCE = "2026-10-18T06:00:00Z";
// An approval commit committed after this moment whose entries all say "no
// visible change" covers the UI files changed before it only when it names
// them. Older commits keep the old behaviour.
const NO_VISIBLE_CHANGE_SCOPE_RULE_SINCE = "2026-10-22T14:00:00Z";
const APPROVAL_PREFIXES = [
  "- User approval:",
  "- Approved customer-visible result:",
];
// What the change adds to the "What's new" notice: ids from WHATS_NEW_FILE in
// backticks, or "none — <reason>".
const WHATS_NEW_PREFIX = "- What's new:";
const WHATS_NEW_FILE = "apps/control-center/src/lib/whats-new.ts";
// An entry whose approval says pending or draft is no approval yet (#705): the
// word anywhere in its "User approval:" line, or at the start of its
// "Approved customer-visible result:" line ("Draft, to be confirmed by Paul.").
// Further into the result line the words describe the product (Theme Studio
// drafts, a pending provider).
const PENDING_APPROVAL_PATTERN = /\b(pending|draft)\b/i;
const PENDING_RESULT_PATTERN = /^(pending|draft)\b/i;
// Markdown around the first word ("**Draft**") does not hide it.
const LEADING_MARKDOWN = /^[\s*_`~]+/;
// How an approval is recorded (docs/control-center-customer-ui-approval.md):
// 1) after Paul's yes in the communicator chat: the line is
//    `approved by Paul in the communicator chat, <YYYY-MM-DD HH:MM>: "<quote>"`.
//    His words are quoted as said and do not count as the state of the approval.
//    Further text after the closing quote is allowed (` — entry: …`, `(build …)`).
// 2) a change with no visible change (a merge of main, a firmware or companion
//    fix that only touches UI files): `no visible change – UI approval not
//    needed (<reason>)`. The reason is required. The gate cannot see what a
//    customer sees; it can only refuse the form when it is incomplete or when
//    the entry also announces something in "What's new".
// 3) everything else stays "pending …" and is due until Paul's OK.
const APPROVED_BY_PAUL_PATTERN =
  /^approved by Paul in the communicator chat, \d{4}-\d{2}-\d{2} \d{2}:\d{2}: ["“„]\s*[^\s"”“„].*["”“](\s.*)?$/i;
// The text of an approval line outside Paul's quote.
const QUOTE_PATTERN = /["“„].*["”“]/;
const NO_VISIBLE_CHANGE_START = /^no visible change\b/i;
// The reason in brackets ends the line (it may hold brackets of its own, and an
// entry written twice carries a " [2]" suffix); text after it is not part of
// the accepted form.
const NO_VISIBLE_CHANGE_PATTERN =
  /^no visible change\s*[–—-]\s*UI approval not needed\s*\(\s*[^)\s].*\)(\s*\[\d+\])?\s*$/i;

const uiFilePatterns = [
  /^apps\/control-center\/src\/components\//,
  /^apps\/control-center\/src\/app\//,
  /^apps\/control-center\/src\/lib\//,
  /^apps\/control-center\/public\//,
  /^apps\/control-center\/scripts\/test-customer-flows\.mjs$/,
];

// These are asked again and again for the same commit (per UI file and per
// merge level); without a cache a branch with many merges of main takes minutes.
latestApprovalCommit = cached(latestApprovalCommit);
uncoveredApprovalCommitUiFiles = cached(uncoveredApprovalCommitUiFiles);
noVisibleChangeUncoveredUiFiles = cached(noVisibleChangeUncoveredUiFiles);
unapprovedUiFilesAt = cached(unapprovedUiFilesAt);

const analysisRef = analysisHeadRef();
const approvalCommit = latestApprovalCommit(analysisRef);
const workingTreeChangedFiles = changedFilesInWorkingTree();
const workingTreeApprovalEdited = workingTreeChangedFiles.includes(APPROVAL_FILE);
// Only a change that adds an entry is an approval marker; one that corrects
// lines of entries already there (pending → the given approval) is not.
const workingTreeApprovalChanged =
  workingTreeApprovalEdited && addedEntries(workingTreeApprovalDiff()).length > 0;
const workingTreeApprovalValid = workingTreeApprovalChanged
  ? diffAddsApprovalEvidence(workingTreeApprovalDiff())
  : false;
const committedApprovalValid = approvalCommit
  ? diffAddsApprovalEvidence(commitDiff(approvalCommit))
  : false;
const activeApprovalValid = workingTreeApprovalChanged
  ? workingTreeApprovalValid
  : committedApprovalValid;
const changedFiles = unique([
  ...changedFilesSince(approvalCommit, analysisRef),
  ...workingTreeChangedFiles,
]);
// The approval commit covers the UI files of the commits before it, not its own:
// a UI file it changes itself counts unless it is covered (see below).
const uiChangedFiles = unique([
  ...changedFiles.filter(isUiFile),
  ...(approvalCommit ? uncoveredApprovalCommitUiFiles(approvalCommit) : []),
  ...noVisibleChangeUncoveredUiFiles(approvalCommit),
]);
const approvalCoversUi = workingTreeApprovalChanged && workingTreeApprovalValid;
const unapprovedUiFiles = approvalCoversUi ? [] : uiChangedFiles;
// Every entry this change adds is checked, also those of earlier commits (#799),
// as it reads now: against the base the change branched from. Without that base
// the added entries are unknown and the gate fails instead of passing.
const addedSince = changeBase(analysisRef);
const addedDiff = workingTreeApprovalEdited
  ? git(["diff", ...DIFF_OPTIONS, addedSince, "--", APPROVAL_FILE])
  : approvalDiff(addedSince, analysisRef);
// Ids of "What's new" and the approval log as they read at the checked head.
const recordRef = workingTreeChangedFiles.some((file) => file === APPROVAL_FILE || file === WHATS_NEW_FILE)
  ? null
  : analysisRef;
const invalidEntries = addedEntries(addedDiff)
  .map((entry) => ({ title: entry.split("\n")[0].slice(3), errors: entryErrors(entry, recordRef) }))
  .filter(({ errors }) => errors.length > 0);
const pendingEntries = addedEntries(addedDiff).filter(isPendingOrDraft);
const badNoChangeEntries = addedEntries(addedDiff).filter(isBadNoVisibleChange);
const unrecognizedApprovalEntries = addedEntries(addedDiff).filter(hasUnrecognizedApproval);
const invalidApprovalMarker =
  (workingTreeApprovalChanged && !workingTreeApprovalValid) ||
  (!workingTreeApprovalChanged && Boolean(approvalCommit) && !committedApprovalValid);
const due =
  invalidApprovalMarker ||
  invalidEntries.length > 0 ||
  pendingEntries.length > 0 ||
  badNoChangeEntries.length > 0 ||
  unrecognizedApprovalEntries.length > 0 ||
  unapprovedUiFiles.length > 0;

printSummary({
  activeApprovalValid,
  analysisRef,
  approvalCommit,
  badNoChangeEntries,
  due,
  invalidApprovalMarker,
  invalidEntries,
  pendingEntries,
  uiChangedFiles,
  unapprovedUiFiles,
  unrecognizedApprovalEntries,
  workingTreeApprovalChanged,
  workingTreeChangedFiles,
});

if (due) {
  const reason = invalidEntries.length > 0
    ? `${invalidEntries.length} approval entr${invalidEntries.length === 1 ? "y" : "ies"} added by this change ${invalidEntries.length === 1 ? "is" : "are"} incomplete or not unique (see the list above): each needs "User approval:" (one line, unique in the log), "Approved customer-visible result:", "Scope:", and "${WHATS_NEW_PREFIX}" with "none — <reason>" or ids from ${WHATS_NEW_FILE} in backticks.`
    : invalidApprovalMarker
    ? `The newest approval marker does not add the required lines: "${APPROVAL_PREFIXES.join('", "')}", and "${WHATS_NEW_PREFIX}" with "none — <reason>" or ids from ${WHATS_NEW_FILE} in backticks.`
    : pendingEntries.length > 0
      ? `${pendingEntries.length} approval entr${pendingEntries.length === 1 ? "y" : "ies"} added by this change say${pendingEntries.length === 1 ? "s" : ""} pending or draft, which is no approval yet. Replace it with the given approval before merge.`
      : badNoChangeEntries.length > 0
        ? `${badNoChangeEntries.length} approval entr${badNoChangeEntries.length === 1 ? "y" : "ies"} added by this change say${badNoChangeEntries.length === 1 ? "s" : ""} "no visible change" without the full form \`no visible change – UI approval not needed (<reason>)\` or with a "What's new" notice, which is a visible change.`
        : unrecognizedApprovalEntries.length > 0
          ? `${unrecognizedApprovalEntries.length} approval entr${unrecognizedApprovalEntries.length === 1 ? "y" : "ies"} added by this change ${unrecognizedApprovalEntries.length === 1 ? "has" : "have"} a "User approval:" line in none of the accepted forms: \`approved by Paul in the communicator chat, <YYYY-MM-DD HH:MM>: "<quote>"\` or \`no visible change – UI approval not needed (<reason>)\`.`
          : `Customer-facing UI changed in ${unapprovedUiFiles.length} file(s) without a matching approval entry.`;
  const message = [
    reason,
    `Get explicit approval for the exact visible result, review ${PRINCIPLES_FILE}, then append it to ${APPROVAL_FILE}.`,
  ].join(" ");
  if (process.env["GITHUB_ACTIONS"]) {
    console.error(`::error title=Control Center UI approval required::${message}`);
  } else {
    console.error(`error: ${message}`);
  }
  process.exit(1);
}

function analysisHeadRef() {
  const eventName = process.env["GITHUB_EVENT_NAME"] || "";
  if (/^pull_request/.test(eventName)) {
    const prHead = tryGit(["rev-parse", "--verify", "HEAD^2"]);
    if (prHead) {
      return prHead;
    }
  }
  return "HEAD";
}

// The newest commit that adds an entry. A commit that only corrects lines of
// entries already there is no new marker: the corrected entry keeps covering
// what it covered.
function latestApprovalCommit(ref) {
  const commits = lines(git(["log", "--format=%H", ref, "--", APPROVAL_FILE]));
  // An entry a later commit removed again approves nothing: it must still be
  // in the file at ref (by its heading), else the UI change before it would be
  // counted as covered by an approval that is gone.
  const headingsAtRef = new Set(lines(readRecordFile(APPROVAL_FILE, ref)).filter((line) => line.startsWith("## ")));
  return (
    commits.find((commit) =>
      addedEntries(commitDiff(commit)).some((entry) => headingsAtRef.has(entry.split("\n")[0].trim())),
    ) || null
  );
}

function changedFilesSince(commit, ref) {
  if (!commit) {
    return lines(git(["ls-tree", "-r", "--name-only", ref]));
  }
  return lines(git(["diff", "--no-renames", "--name-only", `${commit}..${ref}`]));
}

// Files the approval commit changes itself, against its first parent (a merge
// brings in the files of the merged branch this way).
function approvalCommitChangedFiles(commit) {
  return lines(tryGit(["diff", "--no-renames", "--name-only", `${commit}^1`, commit]));
}

function appliesPathRule(commit, since = APPROVAL_COMMIT_PATH_RULE_SINCE) {
  const committedAt = Date.parse(tryGit(["log", "-1", "--format=%cI", commit]));
  return committedAt >= Date.parse(since);
}

// UI files the approval commit changes itself that its entry does not cover.
// A file a merge takes from its second parent is covered when that parent
// passes the gate on its own (its approval history), so the merge record need
// not name base UI that is already approved.
function uncoveredApprovalCommitUiFiles(commit) {
  if (!appliesPathRule(commit) || onBaseBranch(commit)) {
    return [];
  }
  const entryText = addedApprovalText(commitDiff(commit));
  const mergedParent = tryGit(["rev-parse", "--verify", `${commit}^2`]);
  return approvalCommitChangedFiles(commit)
    .filter(isUiFile)
    .filter((file) => !(mergedParent && coveredByMergedParent(file, commit, mergedParent)))
    .filter((file) => !namesPath(entryText, file));
}

function coveredByMergedParent(file, commit, parent) {
  const changedSinceParent = lines(tryGit(["diff", "--no-renames", "--name-only", parent, commit, "--", file]));
  return changedSinceParent.length === 0 && unapprovedUiFilesAt(parent).length === 0;
}

// A "no visible change" entry is no approval from Paul (Codex review of #823).
// An approval commit whose entries all say so covers the UI files changed since
// the approval before it only when its entries name them; else an earlier,
// unapproved UI commit would pass with it. Files the branch takes from its base
// (a merge of main) are approved there.
function noVisibleChangeUncoveredUiFiles(commit) {
  const parent = commit ? tryGit(["rev-parse", "--verify", `${commit}^1`]) : "";
  if (
    !parent ||
    !onlyNoVisibleChange(commit) ||
    !appliesPathRule(commit, NO_VISIBLE_CHANGE_SCOPE_RULE_SINCE) ||
    onBaseBranch(commit)
  ) {
    return [];
  }
  const previous = latestApprovalCommit(parent);
  const base = pullRequestBase() || tryGit(["rev-parse", "--verify", "origin/main"]);
  const forkPoint = base ? tryGit(["merge-base", base, parent]) : "";
  const branchFiles = forkPoint
    ? lines(tryGit(["diff", "--no-renames", "--name-only", forkPoint, parent]))
    : null;
  const entryText = addedApprovalText(commitDiff(commit));
  return unique([
    ...changedFilesSince(previous, parent)
      .filter(isUiFile)
      .filter((file) => !branchFiles || branchFiles.includes(file))
      .filter((file) => !namesPath(entryText, file)),
    ...(previous ? uncoveredApprovalCommitUiFiles(previous) : []),
    ...noVisibleChangeUncoveredUiFiles(previous),
  ]);
}

function onlyNoVisibleChange(commit) {
  const entries = addedEntries(commitDiff(commit));
  return (
    entries.length > 0 &&
    entries.every((entry) =>
      NO_VISIBLE_CHANGE_START.test(entryField(entry, "- User approval:").replace(LEADING_MARKDOWN, "")),
    )
  );
}

// An approval commit that is already on main was gated in its own pull request.
// main takes squash merges, which put a pull request's UI files and its entry
// into one commit; checking that commit again would turn main and every later
// pull request without its own entry red.
function onBaseBranch(commit) {
  const base = pullRequestBase() || tryGit(["rev-parse", "--verify", "origin/main"]);
  return Boolean(base) && isAncestor(commit, base);
}

function isAncestor(commit, ref) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", commit, ref], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// The gate's verdict for a committed ref, as a list of unapproved UI files.
function unapprovedUiFilesAt(ref) {
  const approval = latestApprovalCommit(ref);
  const since = changedFilesSince(approval, ref).filter(isUiFile);
  if (!approval) {
    return since;
  }
  if (!diffAddsApprovalEvidence(commitDiff(approval), approval)) {
    return [...since, "approval marker without evidence"];
  }
  return unique([...since, ...uncoveredApprovalCommitUiFiles(approval), ...noVisibleChangeUncoveredUiFiles(approval)]);
}

// The path as a whole token: "widget.tsx" does not name "widget.ts".
function namesPath(text, file) {
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w./-])${escaped}(?![\\w/-]|\\.\\w)`).test(text);
}

// The text of the entries the diff adds: only "## " blocks name a path. Each
// hunk is read on its own, so a line added under an older entry further down
// does not join a new entry added above it.
function addedApprovalText(diff) {
  return diff
    .split(/^(?=@@ )/m)
    .flatMap((hunk) =>
      lines(hunk)
        .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
        .map((line) => line.slice(1))
        .join("\n")
        .split(/^(?=## )/m)
        .filter((block) => block.startsWith("## ")),
    )
    .join("\n");
}

function changedFilesInWorkingTree() {
  return unique([
    ...lines(git(["diff", "--no-renames", "--name-only"])),
    ...lines(git(["diff", "--no-renames", "--name-only", "--cached"])),
    ...lines(git(["ls-files", "--others", "--exclude-standard"])),
  ]);
}

function workingTreeApprovalDiff() {
  return [
    git(["diff", "--ignore-cr-at-eol", "--", APPROVAL_FILE]),
    git(["diff", "--ignore-cr-at-eol", "--cached", "--", APPROVAL_FILE]),
    untrackedFileContents(APPROVAL_FILE),
  ].join("\n");
}

// Against the first parent: a merge's combined diff would not show the entry
// as "+" lines. A root commit has no parent and is shown on its own.
function commitDiff(commit) {
  const parent = tryGit(["rev-parse", "--verify", `${commit}^1`]);
  return parent
    ? git(["diff", ...DIFF_OPTIONS, parent, commit, "--", APPROVAL_FILE])
    : git(["show", "--format=", ...DIFF_OPTIONS, commit, "--", APPROVAL_FILE]);
}

function untrackedFileContents(file) {
  if (!lines(tryGit(["ls-files", "--others", "--exclude-standard", "--", file])).includes(file)) {
    return "";
  }
  try {
    return readFileSync(file, "utf8")
      .split("\n")
      .map((line) => `+${line}`)
      .join("\n");
  } catch {
    return "";
  }
}

// The base the change branched from: the pull request base in CI, else
// origin/main.
function changeBase(ref) {
  const base = pullRequestBase() || tryGit(["rev-parse", "--verify", "origin/main"]);
  if (!base) {
    throw new Error("Cannot determine the approval comparison base. Fetch origin/main with its full history before running the gate.");
  }
  return git(["merge-base", base, ref]);
}

function approvalDiff(from, to) {
  return git(["diff", ...DIFF_OPTIONS, from, to, "--", APPROVAL_FILE]);
}

function addedLinesOf(diff) {
  return lines(diff)
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1).trim());
}

// One block per added entry: its "## " heading starts it.
function addedEntries(diff) {
  return addedLinesOf(diff)
    .join("\n")
    .split(/^(?=## )/m)
    .filter((entry) => entry.startsWith("## "));
}

// The value of an entry's field, with the lines that continue it.
function entryField(entry, prefix) {
  const entryLines = entry.split("\n");
  const start = entryLines.findIndex((line) => line.startsWith(prefix));
  if (start < 0) {
    return "";
  }
  const value = [entryLines[start].slice(prefix.length)];
  for (const line of entryLines.slice(start + 1)) {
    if (!line || line.startsWith("- ") || line.startsWith("## ")) {
      break;
    }
    value.push(line);
  }
  return value.join(" ").trim();
}

// Every entry the change adds holds all four fields with a value, one "User
// approval:" line that no other line of the log repeats, and a valid "What's
// new" line.
function entryErrors(entry, ref) {
  const entryLines = lines(entry);
  const errors = [];
  for (const prefix of [...APPROVAL_PREFIXES, "- Scope:", WHATS_NEW_PREFIX]) {
    if (!entryLines.some((line) => line.startsWith(prefix) && line.slice(prefix.length).trim())) {
      errors.push(`missing ${prefix.slice(2)}`);
    }
  }
  const approvals = entryLines.filter((line) => line.startsWith(APPROVAL_PREFIXES[0]));
  if (approvals.length !== 1 || lines(readRecordFile(APPROVAL_FILE, ref)).filter((line) => line === approvals[0]).length !== 1) {
    errors.push("User approval: must occur exactly once and be unique in the log");
  }
  if (entryLines.filter((line) => line.startsWith(WHATS_NEW_PREFIX)).some((line) => !namesWhatsNew(line, ref))) {
    errors.push(`invalid ${WHATS_NEW_PREFIX.slice(2)}`);
  }
  return errors;
}

function isPendingOrDraft(entry) {
  // Paul's quote is his words; "pending" next to it is not approval.
  const approval = entryField(entry, "- User approval:").replace(QUOTE_PATTERN, "");
  return (
    PENDING_APPROVAL_PATTERN.test(approval) ||
    PENDING_RESULT_PATTERN.test(
      entryField(entry, "- Approved customer-visible result:").replace(LEADING_MARKDOWN, ""),
    )
  );
}

// An entry's "User approval:" line must be one of the accepted forms: Paul's
// recorded yes (1), or the complete no-visible-change form (2). Pending and
// draft entries (3) and a malformed "no visible change" are reported as such
// by the checks above; anything else (an incomplete "approved by Paul", free
// text, no line at all) is no approval.
function hasUnrecognizedApproval(entry) {
  const approval = entryField(entry, "- User approval:");
  if (APPROVED_BY_PAUL_PATTERN.test(approval)) {
    return false;
  }
  const marked = approval.replace(LEADING_MARKDOWN, "");
  if (PENDING_APPROVAL_PATTERN.test(approval) || NO_VISIBLE_CHANGE_START.test(marked)) {
    return false;
  }
  return true;
}

// An entry that calls itself "no visible change" needs the reason in the given
// form and may not announce a "What's new" notice (a notice is something the
// customer sees).
function isBadNoVisibleChange(entry) {
  const approval = entryField(entry, "- User approval:").replace(LEADING_MARKDOWN, "");
  if (!NO_VISIBLE_CHANGE_START.test(approval)) {
    return false;
  }
  if (!NO_VISIBLE_CHANGE_PATTERN.test(approval)) {
    return true;
  }
  const whatsNew = entryField(entry, WHATS_NEW_PREFIX).replace(LEADING_MARKDOWN, "");
  return !/^none\s*[—–-]\s*\S/.test(whatsNew);
}

// ref: the commit whose own tree the entry is judged against; null is the
// working tree (the checked-out head).
function diffAddsApprovalEvidence(diff, ref = null) {
  // Each added entry holds its own approval lines and answers for itself, also
  // when one change adds several.
  const added = addedLinesOf(diff).join("\n");
  const entries = addedEntries(diff);
  return [added, ...entries].every((text) => {
    const textLines = text.split("\n");
    const whatsNewLines = textLines.filter((line) => line.startsWith(WHATS_NEW_PREFIX));
    return (
      APPROVAL_PREFIXES.every((prefix) =>
        textLines.some((line) => line.startsWith(prefix)),
      ) &&
      whatsNewLines.length > 0 &&
      whatsNewLines.every((line) => namesWhatsNew(line, ref))
    );
  });
}

function namesWhatsNew(line, ref) {
  const value = line.slice(WHATS_NEW_PREFIX.length).trim();
  if (/^none\s*[—–-]\s*\S/.test(value)) {
    return true;
  }
  const ids = [...value.matchAll(/`([^`]*)`/g)].map((match) => match[1]);
  return (
    ids.length > 0 &&
    ids.every((id) => whatsNewIds(ref).includes(id) && timesNamed(id, ref) === 1)
  );
}

// An entry is added to the list once, so one approval entry names it. A later
// change cannot pass by naming an entry that is already there.
function timesNamed(id, ref) {
  return lines(readRecordFile(APPROVAL_FILE, ref)).filter(
    (line) => line.trim().startsWith(WHATS_NEW_PREFIX) && line.includes(`\`${id}\``),
  ).length;
}

function whatsNewIds(ref) {
  return [...readRecordFile(WHATS_NEW_FILE, ref).matchAll(/\bid: "([^"]+)"/g)].map(
    (match) => match[1],
  );
}

// A file as it is in ref, or in the working tree when ref is null.
function readRecordFile(file, ref) {
  if (ref) {
    // A file the ref does not have is absent; a failed read is not.
    return git(["ls-tree", "--name-only", ref, "--", file]) ? git(["show", `${ref}:${file}`]) : "";
  }
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function isUiFile(file) {
  return uiFilePatterns.some((pattern) => pattern.test(file));
}

function pullRequestBase() {
  if (!/^pull_request/.test(process.env["GITHUB_EVENT_NAME"] || "")) {
    return null;
  }
  return tryGit(["rev-parse", "--verify", "HEAD^1"]) || null;
}

function printSummary({
  activeApprovalValid,
  analysisRef,
  approvalCommit,
  due,
  invalidApprovalMarker,
  invalidEntries,
  pendingEntries,
  badNoChangeEntries,
  uiChangedFiles,
  unapprovedUiFiles,
  unrecognizedApprovalEntries,
  workingTreeApprovalChanged,
  workingTreeChangedFiles,
}) {
  console.log(`Control Center UI review gate: ${due ? "due" : "ok"}`);
  if (analysisRef !== "HEAD") {
    console.log(`Review head: ${analysisRef}`);
  }
  console.log(
    `Approval marker: ${workingTreeApprovalChanged ? "working tree" : approvalCommit || "none"}`,
  );
  console.log(`Approval evidence: ${activeApprovalValid ? "valid" : "missing"}`);
  console.log(`Working tree files: ${workingTreeChangedFiles.length}`);
  console.log(`UI-impacting files since approval: ${uiChangedFiles.length}`);
  console.log(`Unapproved UI files: ${unapprovedUiFiles.length}`);
  if (invalidApprovalMarker) {
    console.log("Approval marker is missing required evidence.");
  }
  for (const { title, errors } of invalidEntries) {
    console.log(`- ${title}: ${errors.join("; ")}`);
  }
  if (pendingEntries.length > 0) {
    console.log("Approval entries that say pending or draft:");
    for (const entry of pendingEntries) {
      console.log(`- ${entry.split("\n")[0].slice(3)}`);
    }
  }
  if (badNoChangeEntries.length > 0) {
    console.log('Approval entries that say "no visible change" without the full form:');
    for (const entry of badNoChangeEntries) {
      console.log(`- ${entry.split("\n")[0].slice(3)}`);
    }
  }
  if (unrecognizedApprovalEntries.length > 0) {
    console.log("Approval entries whose approval line is in none of the accepted forms:");
    for (const entry of unrecognizedApprovalEntries) {
      console.log(`- ${entry.split("\n")[0].slice(3)}`);
    }
  }
  const filesToPrint = due ? unapprovedUiFiles : uiChangedFiles;
  if (filesToPrint.length > 0) {
    console.log(due ? "Unapproved UI files:" : "Approved UI files:");
    for (const file of filesToPrint.slice(0, 40)) {
      console.log(`- ${file}`);
    }
    if (filesToPrint.length > 40) {
      console.log(`- ... ${filesToPrint.length - 40} more`);
    }
  }
}

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: GIT_MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function tryGit(args) {
  try {
    return git(args);
  } catch {
    return "";
  }
}

function lines(value) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

function cached(fn) {
  const results = new Map();
  return (key) => {
    if (!results.has(key)) {
      results.set(key, fn(key));
    }
    return results.get(key);
  };
}
