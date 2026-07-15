#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
}).trim();
process.chdir(repoRoot);

const APPROVAL_FILE = "docs/control-center-customer-ui-approval.md";
const PRINCIPLES_FILE = "docs/control-center-ui-principles.md";
const APPROVAL_PREFIXES = [
  "- User approval:",
  "- Approved customer-visible result:",
];

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
const uiChangedFiles = changedFiles.filter(isUiFile);
const approvalCoversUi = workingTreeApprovalChanged && workingTreeApprovalValid;
const unapprovedUiFiles = approvalCoversUi ? [] : uiChangedFiles;
const invalidApprovalMarker =
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
    ? `The newest approval marker does not add both required approval lines.`
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

function latestApprovalCommit(ref) {
  const result = tryGit(["log", "-n", "1", "--format=%H", ref, "--", APPROVAL_FILE]);
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
    tryGit(["diff", "--", APPROVAL_FILE]),
    tryGit(["diff", "--cached", "--", APPROVAL_FILE]),
    untrackedFileContents(APPROVAL_FILE),
  ].join("\n");
}

function commitDiff(commit) {
  return tryGit(["show", "--format=", "--unified=0", commit, "--", APPROVAL_FILE]);
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

function diffAddsApprovalEvidence(diff) {
  const addedLines = lines(diff)
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1).trim());
  return APPROVAL_PREFIXES.every((prefix) =>
    addedLines.some((line) => line.startsWith(prefix)),
  );
}

function isUiFile(file) {
  return uiFilePatterns.some((pattern) => pattern.test(file));
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
