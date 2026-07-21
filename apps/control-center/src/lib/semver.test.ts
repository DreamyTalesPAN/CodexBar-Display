import { describe, expect, it } from "vitest";
import {
  compareSemVer,
  compareSemVerStrings,
  parseSemVer,
} from "./semver";

describe("parseSemVer", () => {
  it("parses a plain release version", () => {
    expect(parseSemVer("1.0.44")).toEqual({
      major: 1,
      minor: 0,
      patch: 44,
      prerelease: [],
    });
  });

  it("parses a leading v and prerelease identifiers", () => {
    expect(parseSemVer("v1.0.44-rc.16")).toEqual({
      major: 1,
      minor: 0,
      patch: 44,
      prerelease: ["rc", "16"],
    });
  });

  it("ignores build metadata", () => {
    expect(parseSemVer("1.0.44+build.7")).toEqual({
      major: 1,
      minor: 0,
      patch: 44,
      prerelease: [],
    });
    expect(parseSemVer("1.0.44-rc.1+build.7")?.prerelease).toEqual([
      "rc",
      "1",
    ]);
  });

  it("rejects malformed versions instead of degrading to 0.0.0", () => {
    for (const raw of [
      "",
      "  ",
      "1.0",
      "1.0.44.5",
      "banana",
      "1.0.44-",
      "1.0.44-rc..1",
      "1.0.44-rc.1!",
    ]) {
      expect(parseSemVer(raw)).toBeNull();
    }
  });
});

describe("compareSemVer precedence", () => {
  const cases: Array<[string, string, number]> = [
    ["1.0.44-rc.16", "1.0.44", -1],
    ["1.0.36-rc.2", "1.0.36", -1],
    ["1.0.44-beta.3", "1.0.44-rc.1", -1],
    ["1.0.44-rc.2", "1.0.44-rc.10", -1],
    ["1.0.44-alpha", "1.0.44-alpha.1", -1],
    ["1.0.44-1", "1.0.44-alpha", -1],
    ["1.0.44", "1.0.44", 0],
    ["1.0.44+build7", "1.0.44", 0],
    ["v1.0.44", "1.0.44", 0],
    ["1.0.44", "1.0.44-rc.16", 1],
    ["1.0.45-rc.1", "1.0.44", 1],
    ["1.1.0", "1.0.99", 1],
  ];

  it.each(cases)("compare(%s, %s) = %d", (left, right, want) => {
    const leftParsed = parseSemVer(left);
    const rightParsed = parseSemVer(right);
    expect(leftParsed).not.toBeNull();
    expect(rightParsed).not.toBeNull();
    expect(compareSemVer(leftParsed!, rightParsed!)).toBe(want);
  });
});

describe("compareSemVerStrings", () => {
  it("returns null when either side is malformed", () => {
    expect(compareSemVerStrings("banana", "1.0.44")).toBeNull();
    expect(compareSemVerStrings("1.0.44", "")).toBeNull();
  });

  it("offers the final release to an installed RC", () => {
    expect(compareSemVerStrings("1.0.44", "1.0.44-rc.16")).toBe(1);
  });
});
