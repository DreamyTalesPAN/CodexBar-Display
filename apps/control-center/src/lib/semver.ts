export type ParsedSemVer = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
};

const IDENTIFIER_PATTERN = /^[0-9A-Za-z-]+$/;
const CORE_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;
const NUMERIC_PATTERN = /^\d+$/;

export function parseSemVer(raw: string): ParsedSemVer | null {
  let version = raw.trim().replace(/^v/i, "");
  if (!version) {
    return null;
  }

  const plusIndex = version.indexOf("+");
  if (plusIndex >= 0) {
    version = version.slice(0, plusIndex);
  }

  let core = version;
  let prerelease: string[] = [];
  const dashIndex = version.indexOf("-");
  if (dashIndex >= 0) {
    core = version.slice(0, dashIndex);
    const pre = version.slice(dashIndex + 1);
    if (!pre) {
      return null;
    }
    prerelease = pre.split(".");
    if (prerelease.some((identifier) => !IDENTIFIER_PATTERN.test(identifier))) {
      return null;
    }
  }

  const match = core.match(CORE_PATTERN);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
  };
}

export function compareSemVer(left: ParsedSemVer, right: ParsedSemVer): number {
  if (left.major !== right.major) {
    return left.major < right.major ? -1 : 1;
  }
  if (left.minor !== right.minor) {
    return left.minor < right.minor ? -1 : 1;
  }
  if (left.patch !== right.patch) {
    return left.patch < right.patch ? -1 : 1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

export function compareSemVerStrings(
  left: string,
  right: string,
): number | null {
  const leftParsed = parseSemVer(left);
  const rightParsed = parseSemVer(right);
  if (!leftParsed || !rightParsed) {
    return null;
  }
  return compareSemVer(leftParsed, rightParsed);
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) {
    return 0;
  }
  if (left.length === 0) {
    return 1;
  }
  if (right.length === 0) {
    return -1;
  }

  const limit = Math.min(left.length, right.length);
  for (let index = 0; index < limit; index += 1) {
    const diff = comparePrereleaseIdentifier(left[index], right[index]);
    if (diff !== 0) {
      return diff;
    }
  }

  if (left.length === right.length) {
    return 0;
  }
  return left.length < right.length ? -1 : 1;
}

function comparePrereleaseIdentifier(left: string, right: string): number {
  const leftNumeric = NUMERIC_PATTERN.test(left);
  const rightNumeric = NUMERIC_PATTERN.test(right);
  if (leftNumeric && rightNumeric) {
    const diff = Number(left) - Number(right);
    return diff === 0 ? 0 : diff < 0 ? -1 : 1;
  }
  if (leftNumeric) {
    return -1;
  }
  if (rightNumeric) {
    return 1;
  }
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}
