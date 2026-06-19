#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
}).trim();
process.chdir(repoRoot);

const REVIEW_FILE = "docs/control-center-ui-review-checkpoint.md";
const PRINCIPLES_FILE = "docs/control-center-ui-principles.md";
const DEFAULT_INTERVAL = 5;
const interval = readInterval();

const uiFilePatterns = [
  /^apps\/control-center\/src\/components\//,
  /^apps\/control-center\/src\/app\//,
  /^apps\/control-center\/src\/lib\//,
  /^apps\/control-center\/public\//,
  /^apps\/control-center\/scripts\/test-customer-flows\.mjs$/,
];

const analysisRef = analysisHeadRef();
const reviewCommit = latestReviewCommit(analysisRef);
const workingTreeChangedFiles = changedFilesInWorkingTree();
const workingTreeReviewMarker =
  workingTreeChangedFiles.includes(REVIEW_FILE) ||
  (!reviewCommit && existsSync(REVIEW_FILE));
const commitsSinceReview = reviewCommit
  ? workingTreeReviewMarker
    ? 0
    : Number(git(["rev-list", "--count", `${reviewCommit}..${analysisRef}`]))
  : workingTreeReviewMarker
    ? 0
  : Number(git(["rev-list", "--count", analysisRef]));
const committedChangedFiles = workingTreeReviewMarker
  ? []
  : changedFilesSince(reviewCommit, analysisRef);
const changedFiles = unique([...committedChangedFiles, ...workingTreeChangedFiles]);
const uiChangedFiles = changedFiles.filter(isUiFile);
const projectedCommits =
  commitsSinceReview + (workingTreeChangedFiles.some(isUiFile) ? 1 : 0);
const due = projectedCommits >= interval && uiChangedFiles.length > 0;

printSummary({
  changedFiles,
  committedChangedFiles,
  commitsSinceReview,
  due,
  analysisRef,
  projectedCommits,
  reviewCommit,
  uiChangedFiles,
  workingTreeChangedFiles,
});

if (due) {
  const commitSummary =
    projectedCommits === commitsSinceReview
      ? `${commitsSinceReview} commits`
      : `${commitsSinceReview} committed changes plus current working-tree UI changes`;
  const message = [
    `Control Center UI review is due: ${commitSummary} since ${REVIEW_FILE}.`,
    `Customer-facing UI changed in ${uiChangedFiles.length} file(s).`,
    `Review ${PRINCIPLES_FILE}, simplify the UI, then update ${REVIEW_FILE}.`,
  ].join(" ");
  if (process.env["GITHUB_ACTIONS"]) {
    console.error(`::error title=Control Center UI review due::${message}`);
  } else {
    console.error(`error: ${message}`);
  }
  process.exit(1);
}

function readInterval() {
  const raw = process.env["CONTROL_CENTER_UI_REVIEW_INTERVAL"];
  if (!raw) {
    return DEFAULT_INTERVAL;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `CONTROL_CENTER_UI_REVIEW_INTERVAL must be a positive integer, got ${raw}`,
    );
  }
  return value;
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

function latestReviewCommit(ref) {
  const result = tryGit(["log", "-n", "1", "--format=%H", ref, "--", REVIEW_FILE]);
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

function isUiFile(file) {
  return uiFilePatterns.some((pattern) => pattern.test(file));
}

function printSummary({
  changedFiles,
  committedChangedFiles,
  commitsSinceReview,
  due,
  analysisRef,
  projectedCommits,
  reviewCommit,
  uiChangedFiles,
  workingTreeChangedFiles,
}) {
  const status = due ? "due" : "ok";
  console.log(`Control Center UI review gate: ${status}`);
  if (analysisRef !== "HEAD") {
    console.log(`Review head: ${analysisRef}`);
  }
  console.log(
    `Review marker: ${reviewCommit || (workingTreeReviewMarker ? "working tree" : "none")}`,
  );
  console.log(`Commits since marker: ${commitsSinceReview}/${interval}`);
  if (workingTreeChangedFiles.some(isUiFile)) {
    console.log(`Projected commits after current UI changes: ${projectedCommits}/${interval}`);
  }
  console.log(`Committed files since marker: ${committedChangedFiles.length}`);
  console.log(`Working tree files: ${workingTreeChangedFiles.length}`);
  console.log(`Changed files since marker: ${changedFiles.length}`);
  console.log(`UI-impacting files since marker: ${uiChangedFiles.length}`);
  if (uiChangedFiles.length > 0) {
    console.log("UI-impacting files:");
    for (const file of uiChangedFiles.slice(0, 40)) {
      console.log(`- ${file}`);
    }
    if (uiChangedFiles.length > 40) {
      console.log(`- ... ${uiChangedFiles.length - 40} more`);
    }
  }
  if (!due) {
    console.log(`Next required review at ${interval} commits with UI changes.`);
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
