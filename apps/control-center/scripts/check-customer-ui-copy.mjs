import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const files = [
  ...collectFiles(join(appRoot, "src", "components")),
  ...collectFiles(join(appRoot, "src", "app")),
  join(appRoot, "src", "lib", "themes.ts"),
].filter((file) => file.endsWith(".tsx") || file.endsWith(".ts"));

const forbiddenPatterns = [
  {
    label: "internal Companion service name",
    pattern: /\bCompanion\b/,
    suggestion: "Use Mac App in customer-facing UI.",
  },
  {
    label: "bridge jargon",
    pattern: /\b[Bb]ridge\b/,
    suggestion: "Hide this detail or describe the next customer action.",
  },
  {
    label: "local API jargon",
    pattern: /\bAPI\b|\blocal Companion API\b/i,
    suggestion: "Do not expose local service/API wording to customers.",
  },
  {
    label: "release/package jargon",
    pattern:
      /\b(release gate|release check|latest release|customer installer|installer asset|Mac package|package pending|not published)\b/i,
    suggestion: "Show a simple installer status instead.",
  },
  {
    label: "technical setup substep",
    pattern:
      /\b(Check bridge|Check installer|Find VibeTV|Pair device|Discovery needs attention)\b/i,
    suggestion: "Use one Connect VibeTV or Install Mac App action.",
  },
  {
    label: "indirect installer wording",
    pattern: /\b(Checking installer|Mac installer)\b|^Installer is not ready yet\.?$/i,
    suggestion: "Use direct Mac App wording for setup and update states.",
  },
  {
    label: "technical target wording",
    pattern:
      /\b(VibeTV target|Search target|target URL|valid port|username|password|query string|fragment)\b/i,
    suggestion: "Use VibeTV address only.",
  },
  {
    label: "dead action wording",
    pattern: /\b(Installer unavailable|Needs Companion|Protected)\b/i,
    suggestion: "Hide unavailable actions or show a passive status.",
  },
];

const findings = [];

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  for (const item of extractCustomerCopy(sourceFile)) {
    const text = normalizeCopy(item.text);
    if (!text || shouldIgnoreText(text)) {
      continue;
    }
    for (const forbidden of forbiddenPatterns) {
      if (forbidden.pattern.test(text)) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(
          item.pos,
        );
        findings.push({
          column: character + 1,
          file: relative(appRoot, file),
          forbidden,
          line: line + 1,
          text,
        });
      }
    }
  }
}

if (findings.length > 0) {
  for (const finding of findings) {
    const message = `${finding.file}:${finding.line}:${finding.column}: ${finding.forbidden.label}: ${JSON.stringify(finding.text)}. ${finding.forbidden.suggestion}`;
    if (process.env["GITHUB_ACTIONS"]) {
      console.error(
        `::error file=apps/control-center/${finding.file},line=${finding.line},col=${finding.column},title=Customer UI copy jargon::${message}`,
      );
    } else {
      console.error(message);
    }
  }
  console.error(
    `Control Center customer UI copy guard failed with ${findings.length} finding(s).`,
  );
  process.exit(1);
}

console.log("Control Center customer UI copy guard: ok");

function collectFiles(dir) {
  return readdirSync(dir)
    .flatMap((entry) => {
      const path = join(dir, entry);
      const stats = statSync(path);
      if (stats.isDirectory()) {
        return collectFiles(path);
      }
      return [path];
    })
    .sort();
}

function extractCustomerCopy(sourceFile) {
  const items = [];

  function visit(node) {
    if (ts.isStringLiteralLike(node)) {
      items.push({ pos: node.getStart(sourceFile), text: node.text });
    } else if (ts.isNoSubstitutionTemplateLiteral(node)) {
      items.push({ pos: node.getStart(sourceFile), text: node.text });
    } else if (ts.isTemplateExpression(node)) {
      items.push({ pos: node.head.getStart(sourceFile), text: node.head.text });
      for (const span of node.templateSpans) {
        items.push({
          pos: span.literal.getStart(sourceFile),
          text: span.literal.text,
        });
      }
    } else if (node.kind === ts.SyntaxKind.JsxText) {
      items.push({ pos: node.getStart(sourceFile), text: node.getText(sourceFile) });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return items;
}

function normalizeCopy(value) {
  return value.replace(/\s+/g, " ").trim();
}

function shouldIgnoreText(text) {
  if (!text) {
    return true;
  }
  if (text.startsWith("/") || text.startsWith("http://") || text.startsWith("https://")) {
    return true;
  }
  if (text.includes("VibeTV-Companion-API-")) {
    return true;
  }
  if (/^[A-Za-z0-9-]+$/.test(text) && text.includes("-")) {
    return true;
  }
  if (/^[A-Z0-9_]+$/.test(text)) {
    return true;
  }
  if (/^[a-z0-9_.:-]+$/.test(text)) {
    return true;
  }
  return false;
}
