export type CustomerPlatform = "macos" | "windows" | "unknown";

type PlatformSource = {
  userAgent?: string;
  userAgentDataPlatform?: string;
};

/**
 * Which download the customer most likely needs. Chrome and Edge report a
 * clean platform name, everything else only leaves the user agent string.
 * A guess that is not obvious stays "unknown" on purpose: the download page
 * then offers both ways instead of pushing the wrong installer.
 */
export function detectCustomerPlatform(
  source: PlatformSource,
): CustomerPlatform {
  const hint = source.userAgentDataPlatform?.trim().toLowerCase() || "";
  if (hint === "windows") {
    return "windows";
  }
  if (hint === "macos") {
    return "macos";
  }
  if (hint) {
    // A named platform we do not build for (Linux, Android, ChromeOS, iOS).
    return "unknown";
  }

  const userAgent = source.userAgent?.trim() || "";
  if (!userAgent) {
    return "unknown";
  }
  // iPhones and iPads carry "Mac OS X" in their user agent but cannot run the
  // Mac App, so they must not be answered with the DMG.
  if (/iphone|ipad|ipod|android/i.test(userAgent)) {
    return "unknown";
  }
  if (/windows nt|win64|wow64/i.test(userAgent)) {
    return "windows";
  }
  if (/mac os x|macintosh/i.test(userAgent)) {
    return "macos";
  }
  return "unknown";
}

export function detectCustomerPlatformFromBrowser(): CustomerPlatform {
  if (typeof navigator === "undefined") {
    return "unknown";
  }
  const userAgentData = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData;
  return detectCustomerPlatform({
    userAgent: navigator.userAgent,
    userAgentDataPlatform: userAgentData?.platform,
  });
}
