import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const componentsDir = path.resolve(here, "../components");
const doc = readFileSync(
  path.resolve(here, "../../../../docs/control-center-accessibility.md"),
  "utf8",
);

it("lists only test files that exist and run an axe check", () => {
  const rows = doc
    .split("\n")
    .filter((line) => /^\| .+ \| `[^|]+\.test\.tsx?`/.test(line));
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    const cell = row.split("|")[2] ?? "";
    for (const [, file] of cell.matchAll(/`([^`]+\.test\.tsx?)`/g)) {
      const full = path.join(componentsDir, file);
      expect(existsSync(full), `${file} is listed but missing`).toBe(true);
      expect(
        readFileSync(full, "utf8"),
        `${file} is listed but has no axe check`,
      ).toContain("expectNoAxeViolations");
    }
  }
});
