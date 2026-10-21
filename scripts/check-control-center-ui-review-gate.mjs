#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const GIT_MAX_BUFFER = 1 << 28;
const repoRoot = git(["rev-parse", "--show-toplevel"]);
process.chdir(repoRoot);

const APPROVAL_FILE = "docs/control-center-customer-ui-approval.md";
const PRINCIPLES_FILE = "docs/control-center-ui-principles.md";
const APPROVAL_PREFIXES = [
  "- User approval:",
  "- Approved customer-visible result:",
];
// What the change adds to the "What's new" notice: ids from WHATS_NEW_FILE in
// backticks, or "none — <reason>".
const WHATS_NEW_PREFIX = "- What's new:";
const WHATS_NEW_FILE = "apps/control-center/src/lib/whats-new.ts";
// An added entry whose "User approval:" line starts with "pending" passes the
// gate, but the notice keeps Paul's yes in the PR review visible.
const PENDING_APPROVAL_NOTICE =
  "UI approval pending: Paul's yes in the PR review is required before merge";

const uiFilePatterns = [
  /^apps\/control-center\/src\/components\//,
  /^apps\/control-center\/src\/app\//,
  /^apps\/control-center\/src\/lib\//,
  /^apps\/control-center\/public\//,
  /^apps\/control-center\/scripts\/test-customer-flows\.mjs$/,
];

const analysisRef = analysisHeadRef();
const approvalCommit = latestApprovalCommit(analysisRef);
const workingTreeChangedFiles = changedFilesInWorkingTree();
const workingTreeApprovalChanged = workingTreeChangedFiles.includes(APPROVAL_FILE);
const approvalText = workingTreeApprovalChanged
  ? (existsSync(APPROVAL_FILE) ? readFileSync(APPROVAL_FILE, "utf8") : "")
  : git(["show", `${analysisRef}:${APPROVAL_FILE}`]);
const baseApprovalText = approvalBaseText();
const addedApprovalEntries = introducedApprovalEntries();
const invalidApprovalEntries = [
  { title: 'Approval evidence outside any "## " entry (add it under its own heading)', errors: approvalLinesOutsideEntries() },
  ...addedApprovalEntries.map((entry) => ({ title: entry.split("\n")[0].slice(3), errors: approvalErrors(entry) })),
].filter(({ errors }) => errors.length > 0);
const workingTreeApprovalValid = workingTreeApprovalChanged
  ? diffAddsApprovalEvidence(workingTreeApprovalDiff())
  : false;
const committedApprovalValid = approvalCommit
  ? diffAddsApprovalEvidence(commitDiff(approvalCommit))
  : false;
const activeApprovalValid = invalidApprovalEntries.length === 0 &&
  (workingTreeApprovalChanged ? workingTreeApprovalValid : committedApprovalValid);
const changedFiles = unique([
  ...changedFilesSince(approvalCommit, analysisRef),
  ...workingTreeChangedFiles,
]);
const uiChangedFiles = changedFiles.filter(isUiFile);
const approvalCoversUi = workingTreeApprovalChanged && workingTreeApprovalValid;
const unapprovedUiFiles = approvalCoversUi ? [] : uiChangedFiles;
const invalidApprovalMarker =
  invalidApprovalEntries.length > 0 ||
  (workingTreeApprovalChanged && !workingTreeApprovalValid) ||
  (!workingTreeApprovalChanged && Boolean(approvalCommit) && !committedApprovalValid);
const due = invalidApprovalMarker || unapprovedUiFiles.length > 0;

printSummary({
  activeApprovalValid,
  analysisRef,
  approvalCommit,
  due,
  invalidApprovalMarker,
  uiChangedFiles,
  unapprovedUiFiles,
  workingTreeApprovalChanged,
  workingTreeChangedFiles,
});

if (due) {
  const reason = invalidApprovalMarker
    ? `An approval marker does not add valid, unique approval evidence and the required lines: "${APPROVAL_PREFIXES.join('", "')}", "- Scope:", and "${WHATS_NEW_PREFIX}" with "none — <reason>" or ids from ${WHATS_NEW_FILE} in backticks.`
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

if (addedApprovalEntries.some((entry) => lines(entry).some((line) => /^- User approval:\s*pending\b/.test(line)))) {
  printPendingApprovalNotice();
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

function latestApprovalCommit(ref) {
  const result = git(["log", "-n", "1", "--format=%H", ref, "--", APPROVAL_FILE]);
  return result || null;
}

function changedFilesSince(commit, ref) {
  if (!commit) {
    return lines(git(["ls-tree", "-r", "--name-only", ref]));
  }
  return lines(git(["diff", "--name-only", `${commit}..${ref}`]));
}

function changedFilesInWorkingTree() {
  return unique([
    ...lines(git(["diff", "--name-only"])),
    ...lines(git(["diff", "--name-only", "--cached"])),
    ...lines(git(["ls-files", "--others", "--exclude-standard"])),
  ]);
}

function workingTreeApprovalDiff() {
  return [
    git(["diff", "--", APPROVAL_FILE]),
    git(["diff", "--cached", "--", APPROVAL_FILE]),
    untrackedFileContents(APPROVAL_FILE),
  ].join("\n");
}

function commitDiff(commit) {
  return git(["show", "--format=", "--unified=0", commit, "--", APPROVAL_FILE]);
}

function untrackedFileContents(file) {
  if (!lines(git(["ls-files", "--others", "--exclude-standard", "--", file])).includes(file)) {
    return "";
  }
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line) => `+${line}`)
    .join("\n");
}

function diffAddsApprovalEvidence(diff) {
  const addedLines = lines(diff)
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1).trim());
  // One block per added entry: its "## " heading starts it. Each one holds its
  // own approval lines and answers for itself, also when one change adds
  // several.
  const added = addedLines.join("\n");
  const entries = added.split(/^(?=## )/m).filter((entry) => entry.startsWith("## "));
  return [added, ...entries].every((text) => {
    const textLines = text.split("\n");
    const whatsNewLines = textLines.filter((line) => line.startsWith(WHATS_NEW_PREFIX));
    return (
      APPROVAL_PREFIXES.every((prefix) =>
        textLines.some((line) => line.startsWith(prefix)),
      ) &&
      whatsNewLines.length > 0 &&
      whatsNewLines.every(namesWhatsNew)
    );
  });
}

function namesWhatsNew(line) {
  const value = line.slice(WHATS_NEW_PREFIX.length).trim();
  if (/^none\s*[—–-]\s*\S/.test(value)) {
    return true;
  }
  const ids = [...value.matchAll(/`([^`]*)`/g)].map((match) => match[1]);
  return (
    ids.length > 0 &&
    ids.every((id) => whatsNewIds().includes(id) && timesNamed(id) === 1)
  );
}

// An entry is added to the list once, so one approval entry names it. A later
// change cannot pass by naming an entry that is already there.
function timesNamed(id) {
  return lines(approvalText).filter(
    (line) => line.trim().startsWith(WHATS_NEW_PREFIX) && line.includes(`\`${id}\``),
  ).length;
}

function whatsNewIds() {
  try {
    const text = workingTreeChangedFiles.includes(WHATS_NEW_FILE)
      ? readFileSync(WHATS_NEW_FILE, "utf8")
      : git(["show", `${analysisRef}:${WHATS_NEW_FILE}`]);
    return [...text.matchAll(/\bid: "([^"]+)"/g)].map(
      (match) => match[1],
    );
  } catch {
    return [];
  }
}

function isUiFile(file) {
  return uiFilePatterns.some((pattern) => pattern.test(file));
}

// CRLF from a Windows autocrlf checkout must not make old entries look new.
function approvalEntries(text) {
  return text.replace(/\r\n/g, "\n").split(/^(?=## )/m)
    .filter((entry) => entry.startsWith("## "))
    .map((entry) => entry.trim());
}

// Compare against the merge base, not the latest marker: a later valid entry
// cannot hide an earlier broken or pending one. Consume matches so copying an
// existing entry still counts as an addition and fails the uniqueness check.
function introducedApprovalEntries() {
  const existing = approvalEntries(baseApprovalText);
  return approvalEntries(approvalText).filter((entry) => {
    const index = existing.indexOf(entry);
    if (index < 0) return true;
    existing.splice(index, 1);
    return false;
  });
}

function approvalBaseText() {
  // A push must compare with the previous tip, not origin/main after the push.
  const baseRef = process.env["GITHUB_EVENT_NAME"] === "push"
    ? JSON.parse(readFileSync(process.env["GITHUB_EVENT_PATH"], "utf8")).before
    : pullRequestBase() || `origin/${process.env["GITHUB_BASE_REF"] || "main"}`;
  const base = tryGit(["merge-base", baseRef, analysisRef]);
  if (!base) {
    throw new Error(`Cannot determine approval comparison base (${baseRef}). Fetch the base ref and complete history before running the gate.`);
  }
  // A log genuinely absent from the base is new; a failed read is not absence.
  if (!git(["ls-tree", "--name-only", base, "--", APPROVAL_FILE])) return "";
  return git(["show", `${base}:${APPROVAL_FILE}`]);
}

// Only "## " entries are validated, so evidence above the first one would pass
// unchecked. Lines the base already had do not count as added.
function approvalLinesOutsideEntries() {
  const outside = (text) => lines(text.replace(/\r\n/g, "\n").split(/^(?=## )/m)[0]);
  const base = outside(baseApprovalText);
  return outside(approvalText).filter(
    (line) =>
      !base.includes(line) &&
      (line.startsWith(WHATS_NEW_PREFIX) || APPROVAL_PREFIXES.some((prefix) => line.startsWith(prefix))),
  );
}

function approvalErrors(entry) {
  const entryLines = lines(entry);
  const errors = [];
  for (const prefix of [...APPROVAL_PREFIXES, "- Scope:", WHATS_NEW_PREFIX]) {
    if (!entryLines.some((line) => line.startsWith(prefix) && line.slice(prefix.length).trim())) {
      errors.push(`missing ${prefix.slice(2)}`);
    }
  }
  const approvals = entryLines.filter((line) => line.startsWith("- User approval:"));
  if (approvals.length !== 1 || lines(approvalText).filter((line) => line === approvals[0]).length !== 1) {
    errors.push("User approval: must occur exactly once and be unique in the log");
  }
  if (approvals.length === 1) {
    const value = approvals[0].slice("- User approval:".length).trim();
    const approved = /^approved by Paul\b/.test(value) &&
      [...value.matchAll(/"[^"\n]*"|“[^”\n]*”|„[^“\n]*“|«[^»\n]*»/g)]
        .some(([quote]) => quote.slice(1, -1).trim());
    const pending = /^pending\s*[—–-]\s*\S/.test(value);
    const invisible = /^no visible change\s*[—–-]\s*UI approval not needed\s*\(\s*\S.*\)\.?$/.test(value);
    if (!approved && !pending && !invisible) {
      errors.push("User approval: must be approved by Paul with a quote, pending — <reason>, or no visible change – UI approval not needed (<reason>)");
    }
  }
  if (entryLines.filter((line) => line.startsWith(WHATS_NEW_PREFIX)).some((line) => !namesWhatsNew(line))) {
    errors.push(`invalid ${WHATS_NEW_PREFIX.slice(2)}`);
  }
  return errors;
}

function pullRequestBase() {
  // Only a synthetic PR merge checkout has a separate first-parent base.
  if (analysisRef === "HEAD") return null;
  return tryGit(["rev-parse", "--verify", "HEAD^1"]) || null;
}

function printPendingApprovalNotice() {
  console.log(PENDING_APPROVAL_NOTICE);
  if (process.env["GITHUB_ACTIONS"]) {
    console.log(`::notice title=Control Center UI approval pending::${PENDING_APPROVAL_NOTICE}`);
    const summary = process.env["GITHUB_STEP_SUMMARY"];
    if (summary) {
      appendFileSync(summary, `### Control Center UI approval pending\n\n${PENDING_APPROVAL_NOTICE}.\n\n`);
    }
  }
}

function printSummary({
  activeApprovalValid,
  analysisRef,
  approvalCommit,
  due,
  invalidApprovalMarker,
  uiChangedFiles,
  unapprovedUiFiles,
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
  for (const { title, errors } of invalidApprovalEntries) {
    console.log(`- ${title}: ${errors.join("; ")}`);
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
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      maxBuffer: GIT_MAX_BUFFER,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    throw new Error(`Required git read failed (git ${args.join(" ")}): ${error.stderr?.trim() || error.message}`);
  }
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
