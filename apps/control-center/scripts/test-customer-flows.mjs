import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
const viewport = { width: 390, height: 844 };
const desktopViewport = { width: 1280, height: 900 };
const smokeOnly = process.argv.includes("--smoke");
const migrationScreenshotDir =
  process.env.CONTROL_CENTER_CAPTURE_MIGRATION_SCREENSHOTS?.trim() || "";
let displayStateDir = "";

const catalogFixture = {
  themes: [
    {
      id: "synthwave",
      title: "Fixture Synthwave Theme",
      description:
        "A neon pixel theme with a retro grid, usage bars, and high-contrast desk display previews.",
      downloadUrl: "https://cdn.example.test/synthwave.vibetv-theme",
      compatibleBoards: ["esp8266_smalltv_st7789"],
      requiresFirmware: "1.0.0",
    },
    {
      id: "clippy",
      title: "Fixture Clippy Theme",
      description:
        "A classic desktop-style theme with a windowed usage screen and animated Clippy visuals.",
      downloadUrl: "https://cdn.example.test/clippy.vibetv-theme",
      compatibleBoards: ["esp8266_smalltv_st7789"],
      requiresFirmware: "1.0.0",
    },
    {
      id: "claude-creature",
      title: "Fixture Claude Creature Theme",
      description:
        "A warm pixel display theme built around Claude usage, session state, and reset timing.",
      downloadUrl: "https://cdn.example.test/claude-creature.vibetv-theme",
      compatibleBoards: ["esp8266_smalltv_st7789"],
      requiresFirmware: "1.0.0",
    },
    {
      id: "missing-pack",
      title: "Fixture Missing Pack Theme",
      description:
        "A catalog theme that is visible to customers but is missing its installable pack download URL.",
      compatibleBoards: ["esp8266_smalltv_st7789"],
      requiresFirmware: "1.0.0",
    },
    {
      id: "esp32-only",
      title: "Fixture ESP32 Only Theme",
      description:
        "A catalog theme that is only compatible with the ESP32 VibeTV hardware profile.",
      downloadUrl: "https://cdn.example.test/esp32-only.vibetv-theme",
      compatibleBoards: ["esp32_lilygo_t_display_s3"],
      requiresFirmware: "1.0.0",
    },
    {
      id: "future-firmware",
      title: "Fixture Future Firmware Theme",
      description:
        "A catalog theme that needs newer VibeTV firmware than the connected device currently reports.",
      downloadUrl: "https://cdn.example.test/future-firmware.vibetv-theme",
      compatibleBoards: ["esp8266_smalltv_st7789"],
      requiresFirmware: "9.9.9",
    },
  ],
};

const releaseFixture = {
  tag_name: "v1.0.99",
  assets: [
    {
      name: "VibeTV-Control-Center.dmg",
      state: "uploaded",
      size: 12_345_678,
      browser_download_url:
        "https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1.0.99/VibeTV-Control-Center.dmg",
    },
    {
      name: "install-control-center-companion.sh",
      browser_download_url:
        "https://downloads.example.test/install-control-center-companion.sh",
    },
  ],
};

const scriptOnlyReleaseFixture = {
  tag_name: "v1.0.98",
  assets: [
    {
      name: "install-control-center-companion.sh",
      browser_download_url:
        "https://downloads.example.test/install-control-center-companion.sh",
    },
  ],
};

const missingAssetReleaseFixture = {
  tag_name: "v1.0.96",
  assets: [
    {
      name: "VibeTV-Control-Center.dmg",
      state: "uploaded",
      size: 0,
      browser_download_url:
        "https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1.0.96/VibeTV-Control-Center.dmg",
    },
    {
      name: "release-notes.txt",
      browser_download_url: "https://downloads.example.test/release-notes.txt",
    },
  ],
};

const companionDevice = {
  target: "http://vibetv.local",
  connected: true,
  paired: true,
  ready: true,
  board: "esp8266_smalltv_st7789",
  firmware: "1.0.32",
  activeTheme: "clippy",
  stream: {
    healthy: true,
    running: true,
    lastSentAt: "2026-06-29T10:47:46Z",
  },
  health: { ok: true },
  display: {
    themeSpec: {
      active: true,
      renderOk: true,
    },
  },
};

const reachableUnreadyDevice = {
  ...companionDevice,
  ready: false,
  stream: {
    healthy: false,
    running: true,
    detail: "Waiting for the first accepted display frame.",
  },
};

async function main() {
  await assertCompanionRequestTimeoutContract();
  const fixtureServer = await startFixtureServer();
  const catalogUrl = `http://127.0.0.1:${fixtureServer.port}/theme-packs.json`;
  const failedCatalogUrl = `http://127.0.0.1:${fixtureServer.port}/theme-packs-failed.json`;
  const firmwareUrl = `http://127.0.0.1:${fixtureServer.port}/firmware-manifest.json`;
  const failedFirmwareUrl = `http://127.0.0.1:${fixtureServer.port}/firmware-manifest-failed.json`;
  const completeReleaseUrl = `http://127.0.0.1:${fixtureServer.port}/github-release-complete.json`;
  const scriptOnlyReleaseUrl = `http://127.0.0.1:${fixtureServer.port}/github-release-script-only.json`;
  const missingAssetReleaseUrl = `http://127.0.0.1:${fixtureServer.port}/github-release-missing-assets.json`;
  const failedReleaseUrl = `http://127.0.0.1:${fixtureServer.port}/github-release-failed.json`;
  let app;
  let browser;

  try {
    displayStateDir = await mkdtemp(
      join(tmpdir(), "control-center-display-state-"),
    );
    await writeFile(
      join(displayStateDir, "last-good-frame.json"),
      JSON.stringify({
        savedAt: new Date().toISOString(),
        frame: {
          v: 1,
          provider: "codex",
          label: "Codex",
          session: 27,
          weekly: 63,
          resetSecs: 5400,
        },
      }),
    );
    await runNextBuild({
      catalogUrl,
      firmwareUrl,
      releaseUrl: completeReleaseUrl,
    });
    assert(
      fixtureServer.catalogRequestCount > 0,
      "customer flow build did not read the local catalog fixture",
    );
    browser = await chromium.launch({ headless: true });

    let appContext = await startTestApp({
      catalogUrl,
      releaseUrl: smokeOnly ? missingAssetReleaseUrl : completeReleaseUrl,
    });
    app = appContext.app;
    if (smokeOnly) {
      await testHostedEntryShowsMacAppDownload(
        browser,
        appContext.appUrl,
        { expectDmg: false },
      );
      await testHostedThemeEntryShowsMacAppDownload(
        browser,
        appContext.appUrl,
        { expectDmg: false },
      );
      await testHostedPriorVisitStillShowsMacAppDownload(
        browser,
        appContext.appUrl,
        { expectDmg: false },
      );
      await testLocalFreshAppWaitsForWifiConfirmation(
        browser,
        appContext.appUrl,
      );
      await testLocalReachableWithoutFrameStaysInSetup(
        browser,
        appContext.appUrl,
      );
      await testLocalExistingSetupOpensOverviewWithoutRepair(
        browser,
        appContext.appUrl,
      );
      await testInitialHealthyStatusRaceAvoidsRepair(
        browser,
        appContext.appUrl,
      );
      await testSetupTabsAreLockedUntilSetupComplete(
        browser,
        appContext.appUrl,
      );
      await testSetupUnlocksWhenThemeInstallGateDisabled(
        browser,
        appContext.appUrl,
      );
      await testInstallThemeLinkStaysOnSetupWhenThemeLibraryLocked(
        browser,
        appContext.appUrl,
        { expectDmg: false },
      );
      await testInstallLinkKeepsRequestedTheme(browser, appContext.appUrl);
      await testUpdatesKeepDmgHiddenWithoutVerifiedAsset(
        browser,
        appContext.appUrl,
      );
      console.log("control-center customer smoke tests passed");
      return;
    }
    await testSetupDoesNotRequestBrowserPermission(browser, appContext.appUrl);
    await testHostedEntryShowsMacAppDownload(
      browser,
      appContext.appUrl,
      { expectDmg: true },
    );
    await testHostedThemeEntryShowsMacAppDownload(
      browser,
      appContext.appUrl,
      { expectDmg: true },
    );
    await testHostedPriorVisitStillShowsMacAppDownload(
      browser,
      appContext.appUrl,
      { expectDmg: true },
    );
    await testLocalFreshAppWaitsForWifiConfirmation(
      browser,
      appContext.appUrl,
    );
    await testLocalWifiVerificationOpensOverview(
      browser,
      appContext.appUrl,
    );
    await testLocalWifiVerificationFailureStaysInSetup(
      browser,
      appContext.appUrl,
    );
    await testLocalWifiVerificationWithoutFrameStaysInSetup(
      browser,
      appContext.appUrl,
    );
    await testLocalWifiSearchShowsManualAddressOnlyAfterNoResults(
      browser,
      appContext.appUrl,
    );
    await testLocalWifiSearchHidesFallbackWhileSearching(
      browser,
      appContext.appUrl,
    );
    await testManualAddressRejectsInvalidAndReportsUnreachable(
      browser,
      appContext.appUrl,
    );
    await testLocalWifiSearchLetsCustomerChooseMultipleResults(
      browser,
      appContext.appUrl,
    );
    await testLocalWifiSearchAutoSelectsOnlyKnownResult(
      browser,
      appContext.appUrl,
    );
    await testRunningPairingErrorRepairsAutomaticallyOnce(
      browser,
      appContext.appUrl,
    );
    await testFailedPairingErrorDoesNotLoop(browser, appContext.appUrl);
    await testLocalReachableWithoutFrameStaysInSetup(
      browser,
      appContext.appUrl,
    );
    await testLocalSetupRecoversWhenDeviceBecomesReady(
      browser,
      appContext.appUrl,
    );
    await testLocalExistingSetupOpensOverviewWithoutRepair(
      browser,
      appContext.appUrl,
    );
    await testInitialHealthyStatusRaceAvoidsRepair(
      browser,
      appContext.appUrl,
    );
    await testInstallThemeLinkStaysOnSetupWhenThemeLibraryLocked(
      browser,
      appContext.appUrl,
      { expectDmg: true },
    );
    await testSetupTabsAreLockedUntilSetupComplete(browser, appContext.appUrl);
    await testSetupUnlocksWhenThemeInstallGateDisabled(
      browser,
      appContext.appUrl,
    );
    await testDesktopHeaderDoesNotClaimDeviceDuringSetup(
      browser,
      appContext.appUrl,
    );
    await testUsageShowsCodexCostHistory(browser, appContext.appUrl);
    await testUsageShowsMacAppUpdateForOldMacApp(browser, appContext.appUrl);
    await testRunSetupAgainReturnsToWifiOnboarding(
      browser,
      appContext.appUrl,
    );
    await testSettingsStayCustomerOnly(browser, appContext.appUrl);
    await testUpdatesShowCustomerCompanionAction(browser, appContext.appUrl);
    await testLegacyInstallMigratesToDmgAtSameVersion(
      browser,
      appContext.appUrl,
    );
    await testLegacyMigrationStaysAvailableWhenVibeTVOffline(
      browser,
      appContext.appUrl,
    );
    await testLegacyFeatureFallbackMigratesAtSameVersion(
      browser,
      appContext.appUrl,
    );
    await testDmgInstallStaysUpToDateAtSameVersion(
      browser,
      appContext.appUrl,
    );
    await testUpdatesShowLegacyCompanionReleaseFallback(
      browser,
      appContext.appUrl,
    );
    await testOverviewSeparatesMacAppAndFirmwareVersions(
      browser,
      appContext.appUrl,
    );
    await testOverviewShowsUsageLoadingUntilRealUsage(
      browser,
      appContext.appUrl,
    );
    await testOverviewRendersThemeSpecAssetTypes(browser, appContext.appUrl);
    await testThemeLibraryRendersThemeSpecPreviews(
      browser,
      appContext.appUrl,
    );
    await testFirmwareUpdateShowsCustomerProgress(browser, appContext.appUrl);
    await testSupportReportExportsAppearAfterReportLoads(
      browser,
      appContext.appUrl,
    );
    await testSavedAddressDoesNotBlockConfirmedVibeTVSearch(
      browser,
      appContext.appUrl,
    );
    await testInstallLinkKeepsRequestedTheme(browser, appContext.appUrl);
    await testThemeInstallStatusStaysCustomerOnly(browser, appContext.appUrl);
    await testThemeInstallShowsIntermediateProgress(browser, appContext.appUrl);
    await testCustomerLogsStayCustomerOnly(browser, appContext.appUrl);
    await testUnpairedThemeDeepLinkWaitsForWifiConfirmation(
      browser,
      appContext.appUrl,
    );
    await testThemeWithoutPackUrlStaysLocked(browser, appContext.appUrl);
    await testBoardIncompatibleThemeStaysLocked(browser, appContext.appUrl);
    await testFirmwareIncompatibleThemeStaysLocked(browser, appContext.appUrl);
    await assertCompanionReleaseApi(appContext.appUrl, {
      dmgDownloadAsset: "VibeTV-Control-Center.dmg",
      dmgDownloadStatus: "available",
      latestVersion: "1.0.99",
      status: "available",
      updateAvailable: true,
    });
    await assertFirmwareUpdateApi(appContext.appUrl, {
      board: companionDevice.board,
      firmware: companionDevice.firmware,
      latestFirmware: "1.0.33",
      message: "Firmware update available.",
      status: "update_available",
      updateAvailable: true,
    });
    await assertFirmwareUpdateApi(appContext.appUrl, {
      board: "unknown_board",
      firmware: companionDevice.firmware,
      latestFirmware: null,
      message: "No update is available for this VibeTV.",
      status: "no_board_release",
      updateAvailable: false,
    });
    await stopProcess(app.process);
    app = undefined;

    appContext = await startTestApp({
      catalogUrl,
      previewDmgUrl:
        "https://test.public.blob.vercel-storage.com/preview/test/VibeTV-Control-Center-99.0.24.dmg",
      previewVersion: "99.0.24",
      releaseUrl: completeReleaseUrl,
      vercelEnv: "preview",
    });
    app = appContext.app;
    await assertCompanionReleaseApi(appContext.appUrl, {
      dmgDownloadAsset: "VibeTV-Control-Center-99.0.24.dmg",
      dmgDownloadStatus: "available",
      latestVersion: "99.0.24",
      status: "available",
      updateAvailable: true,
    });
    await stopProcess(app.process);
    app = undefined;

    appContext = await startTestApp({
      catalogUrl,
      dmgDownloadEnabled: false,
      releaseUrl: completeReleaseUrl,
    });
    app = appContext.app;
    await testDisabledDmgFlagHidesSetupAndUpdateLinks(
      browser,
      appContext.appUrl,
    );
    await assertCompanionReleaseApi(appContext.appUrl, {
      dmgDownloadAsset: null,
      dmgDownloadStatus: "disabled",
      latestVersion: "1.0.99",
      status: "available",
      updateAvailable: true,
    });
    await stopProcess(app.process);
    app = undefined;

    appContext = await startTestApp({
      catalogUrl,
      releaseUrl: scriptOnlyReleaseUrl,
    });
    app = appContext.app;
    await testScriptOnlyReleaseShowsSupportFallback(
      browser,
      appContext.appUrl,
      fixtureServer,
    );
    await assertCompanionReleaseApi(appContext.appUrl, {
      dmgDownloadAsset: null,
      dmgDownloadStatus: "missing_asset",
      latestVersion: "1.0.98",
      status: "available",
      updateAvailable: true,
    });
    await stopProcess(app.process);
    app = undefined;

    appContext = await startTestApp({
      catalogUrl,
      releaseUrl: missingAssetReleaseUrl,
    });
    app = appContext.app;
    await testMissingAssetReleaseShowsNoDownloadActions(
      browser,
      appContext.appUrl,
      fixtureServer,
    );
    await testUpdatesKeepDmgHiddenWithoutVerifiedAsset(
      browser,
      appContext.appUrl,
    );
    await testLegacyMigrationDoesNotBlockFirmwareUpdate(
      browser,
      appContext.appUrl,
    );
    await assertCompanionReleaseApi(appContext.appUrl, {
      dmgDownloadAsset: null,
      dmgDownloadStatus: "missing_asset",
      latestVersion: "1.0.96",
      status: "available",
      updateAvailable: true,
    });
    await stopProcess(app.process);
    app = undefined;

    appContext = await startTestApp({
      catalogUrl,
      releaseUrl: failedReleaseUrl,
    });
    app = appContext.app;
    await testReleaseCheckFailureShowsNoDownloadActions(
      browser,
      appContext.appUrl,
      fixtureServer,
    );
    await testLegacyMigrationCanRetryFailedRelease(
      browser,
      appContext.appUrl,
      fixtureServer,
    );
    await testOfflineLegacyMigrationCanRetryFailedRelease(
      browser,
      appContext.appUrl,
      fixtureServer,
    );
    await assertCompanionReleaseApi(appContext.appUrl, {
      dmgDownloadAsset: null,
      dmgDownloadStatus: "check_failed",
      latestVersion: null,
      status: "check_failed",
      updateAvailable: false,
    });
    await stopProcess(app.process);
    app = undefined;

    appContext = await startTestApp({
      catalogUrl: failedCatalogUrl,
      releaseUrl: completeReleaseUrl,
    });
    app = appContext.app;
    await testThemeCatalogApiKeepsCustomerSafeIssue(
      appContext.appUrl,
      fixtureServer,
    );
    await stopProcess(app.process);
    app = undefined;

    appContext = await startTestApp({
      catalogUrl,
      firmwareUrl: failedFirmwareUrl,
      releaseUrl: completeReleaseUrl,
    });
    app = appContext.app;
    await assertFirmwareUpdateApi(appContext.appUrl, {
      board: companionDevice.board,
      firmware: companionDevice.firmware,
      latestFirmware: null,
      message: "Firmware check failed.",
      status: "check_failed",
      updateAvailable: false,
    });
    console.log("control-center customer flow tests passed");
  } finally {
    await browser?.close();
    await stopProcess(app?.process);
    await fixtureServer.close();
    if (displayStateDir) {
      await rm(displayStateDir, { force: true, recursive: true });
    }
  }
}

async function startTestApp({
  catalogUrl,
  dmgDownloadEnabled = true,
  firmwareUrl,
  previewDmgUrl,
  previewVersion,
  releaseUrl,
  vercelEnv,
}) {
  const appPort = await findFreePort();
  const appUrl = `http://127.0.0.1:${appPort}`;
  const app = startNext({
    appPort,
    catalogUrl,
    dmgDownloadEnabled,
    firmwareUrl,
    previewDmgUrl,
    previewVersion,
    releaseUrl,
    vercelEnv,
  });
  await waitForHttp(appUrl);
  return { app, appUrl };
}

async function newCustomerPage(browser, appUrl, options) {
  const page = await browser.newPage(options);
  await page.context().grantPermissions(["local-network-access"], {
    origin: appUrl,
  });
  return page;
}

async function testSetupDoesNotRequestBrowserPermission(browser, appUrl) {
  const page = await browser.newPage({ viewport });
  const installRequests = [];
  await routeCompanionMissing(page, installRequests);

  await page.goto(appUrl, {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("heading", { name: "Set up your VibeTV" }).waitFor({
    timeout: 10_000,
  });
  assert(
    (await page.getByRole("button", { name: "Run setup again" }).count()) === 0,
    "Run setup again should stay hidden before setup has been tried",
  );
  assert(
    (await page.getByRole("button", { name: "Fix connection" }).count()) === 0,
    "Fix connection should stay hidden while the Mac App needs setup",
  );
  assert(
    (await page.getByText("Mac App did not answer.").count()) === 0,
    "Mac App errors should stay hidden before the customer checks the Mac App",
  );
  await page
    .getByRole("button", { name: "VibeTV is on WiFi" })
    .waitFor({ timeout: 10_000 });
  await page.getByText("Plug VibeTV into power.").waitFor({ timeout: 10_000 });
  await page
    .getByText("Wait until VibeTV shows VibeTV-Setup.")
    .waitFor({ timeout: 10_000 });
  await page.getByText("Take your phone.").waitFor({ timeout: 10_000 });
  await page
    .getByText("Open WiFi settings and join")
    .waitFor({ timeout: 10_000 });
  await page
    .getByText("If the browser does not open automatically, open")
    .waitFor({ timeout: 10_000 });
  await page.getByText("192.168.4.1").waitFor({ timeout: 10_000 });
  assert(
    (await page.getByRole("button", { name: "Allow access" }).count()) === 0,
    "setup should not request browser permission",
  );
  assert(
    (await page.getByText("Allow browser access").count()) === 0,
    "setup should not show browser access as a setup step",
  );
  assert(
    (await page.getByText("Browser permission needed.").count()) === 0,
    "setup should not show browser permission copy",
  );
  assertNoInstallRequests(installRequests);
  await page.close();
}

async function testLocalWifiVerificationOpensOverview(
  browser,
  appUrl,
) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  const repairRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    device: { connected: false, paired: false },
    onRepair: (postData) => {
      repairRequests.push(postData || "");
      return { ...companionDevice, connected: true, paired: true };
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  const wifiReadyButton = page.getByRole("button", {
    name: "VibeTV is on WiFi",
  });
  await wifiReadyButton.waitFor({
    timeout: 10_000,
  });
  assert(
    repairRequests.length === 0,
    "Local onboarding must not repair or pair before WiFi confirmation",
  );
  await wifiReadyButton.click();
  await page.getByRole("heading", { name: "VibeTV is connected" }).waitFor({
    timeout: 10_000,
  });
  assert(
    repairRequests.length === 1,
    `WiFi confirmation should run exactly one verification, got ${repairRequests.length}`,
  );
  const repairPayload = JSON.parse(repairRequests[0] || "{}");
  assert(
    repairPayload.forcePair == null || repairPayload.forcePair === false,
    `Onboarding must preserve a valid token instead of forcing rotation, got ${repairRequests[0]}`,
  );
  const overviewButton = page.getByRole("button", { name: "Overview" });
  assert(
    (await overviewButton.getAttribute("aria-current")) === "page",
    "Successful native verification should go directly to Overview",
  );
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testLocalWifiVerificationFailureStaysInSetup(
  browser,
  appUrl,
) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  const repairRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    device: { connected: false, paired: false },
    onRequest: (pathname, method) => {
      if (method === "POST" && pathname === "/v1/device/repair") {
        repairRequests.push(pathname);
      }
    },
    repairError: true,
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  const wifiReadyButton = page.getByRole("button", {
    name: "VibeTV is on WiFi",
  });
  await wifiReadyButton.waitFor({ timeout: 10_000 });
  assert(
    repairRequests.length === 0,
    "Failed onboarding must still wait for explicit WiFi confirmation",
  );
  await wifiReadyButton.click();
  await page.getByRole("heading", {
    name: "Verify VibeTV connection",
  }).waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "Try again" }).waitFor({
    timeout: 10_000,
  });
  assert(
    repairRequests.length === 1,
    `Failed verification must not retry automatically, got ${repairRequests.length} attempts`,
  );
  assert(
    (await page.getByRole("button", { name: "Overview" }).isDisabled()) === true,
    "Overview must stay locked after failed verification",
  );
  await assertNoDmgDownloadActions(page);
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testLocalWifiVerificationWithoutFrameStaysInSetup(
  browser,
  appUrl,
) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  const repairRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    device: { connected: false, paired: false, ready: false },
    onRepair: (postData) => {
      repairRequests.push(postData || "");
      return reachableUnreadyDevice;
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  const wifiReadyButton = page.getByRole("button", {
    name: "VibeTV is on WiFi",
  });
  await wifiReadyButton.waitFor({ timeout: 10_000 });
  await wifiReadyButton.click();
  await page.getByRole("heading", {
    name: "Verify VibeTV connection",
  }).waitFor({ timeout: 10_000 });
  await page.getByText("VibeTV screen is not ready yet.").waitFor({
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "Try again" }).waitFor({
    timeout: 10_000,
  });
  assert(
    repairRequests.length === 1,
    `A reachable VibeTV without a display frame must not be accepted or retried automatically, got ${repairRequests.length} attempts`,
  );
  assert(
    await page.getByRole("button", { name: "Overview" }).isDisabled(),
    "Overview must stay locked until the first display frame is rendered",
  );
  assert(
    (await page.getByRole("heading", { name: "VibeTV is connected" }).count()) ===
      0,
    "Setup must not show the green connected state without a rendered display frame",
  );
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testLocalWifiSearchShowsManualAddressOnlyAfterNoResults(
  browser,
  appUrl,
) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  const repairRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    device: { connected: false, paired: false },
    searchDevices: [],
    onRepair: (postData) => {
      repairRequests.push(postData || "");
      return { ...companionDevice, target: "http://192.168.178.88" };
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  assert(
    (await page.getByLabel("VibeTV address").count()) === 0,
    "Manual address must stay hidden before automatic search",
  );
  await page.getByRole("button", { name: "VibeTV is on WiFi" }).click();
  await page.getByText("No VibeTV was found automatically.").waitFor({
    timeout: 10_000,
  });
  const address = page.getByLabel("VibeTV address");
  await address.waitFor({ timeout: 10_000 });
  await address.fill("192.168.178.88");
  await page.getByRole("button", { name: "Connect VibeTV" }).click();
  await page.getByRole("heading", { name: "VibeTV is connected" }).waitFor({
    timeout: 10_000,
  });
  assert(repairRequests.length === 1, "Manual address should repair once");
  assert(
    JSON.parse(repairRequests[0]).target === "http://192.168.178.88",
    `Manual address should be normalized, got ${repairRequests[0]}`,
  );
  assertNoInstallRequests(installRequests);
  await page.close();
}

async function testLocalWifiSearchLetsCustomerChooseMultipleResults(
  browser,
  appUrl,
) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  const repairRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    device: { connected: false, paired: false },
    searchDevices: [
      {
        target: "http://192.168.178.81",
        deviceId: "device-81",
        firmware: "1.0.36",
        networkMode: "station",
      },
      {
        target: "http://192.168.178.82",
        deviceId: "device-82",
        firmware: "1.0.36",
        networkMode: "station",
      },
    ],
    onRepair: (postData) => {
      repairRequests.push(postData || "");
      return { ...companionDevice, target: "http://192.168.178.82" };
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "VibeTV is on WiFi" }).click();
  await page.getByText("More than one VibeTV was found.").waitFor({
    timeout: 10_000,
  });
  assert(
    (await page.getByLabel("VibeTV address").count()) === 0,
    "Multiple results must show device choices, not manual address",
  );
  await page
    .getByRole("button", {
      name: "http://192.168.178.82 · Firmware 1.0.36",
    })
    .click();
  await page.getByRole("heading", { name: "VibeTV is connected" }).waitFor({
    timeout: 10_000,
  });
  assert(repairRequests.length === 1, "Selected device should repair once");
  assert(
    JSON.parse(repairRequests[0]).target === "http://192.168.178.82",
    `Selected address should be passed to repair, got ${repairRequests[0]}`,
  );
  assert(
    JSON.parse(repairRequests[0]).expectedDeviceId === "device-82",
    `Selected identity should stay pinned through repair, got ${repairRequests[0]}`,
  );
  assertNoInstallRequests(installRequests);
  await page.close();
}

async function testLocalWifiSearchHidesFallbackWhileSearching(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    device: { connected: false, paired: false },
    searchDelayMs: 750,
    searchDevices: [],
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "VibeTV is on WiFi" }).click();
  await page.getByText("Searching for VibeTVs on your WiFi...").waitFor({
    timeout: 10_000,
  });
  assert(
    (await page.getByLabel("VibeTV address").count()) === 0,
    "Manual address must stay hidden while search is running",
  );
  assert(
    (await page.getByRole("button", { name: "VibeTV is on WiFi" }).count()) === 0,
    "Search must not show a second WiFi search button",
  );
  await page.getByLabel("VibeTV address").waitFor({ timeout: 10_000 });
  assertNoInstallRequests(installRequests);
  await page.close();
}

async function testManualAddressRejectsInvalidAndReportsUnreachable(
  browser,
  appUrl,
) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  const repairRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    device: { connected: false, paired: false },
    searchDevices: [],
    repairError: true,
    onRequest: (pathname, method) => {
      if (pathname === "/v1/device/repair" && method === "POST") {
        repairRequests.push(pathname);
      }
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "VibeTV is on WiFi" }).click();
  const address = page.getByLabel("VibeTV address");
  await address.waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "Connect VibeTV" }).click();
  await page.getByText("Enter vibetv.local or the IP address shown").waitFor({
    timeout: 10_000,
  });
  await address.fill("not a VibeTV address");
  await page.getByRole("button", { name: "Connect VibeTV" }).click();
  assert(repairRequests.length === 0, "Invalid addresses must not reach Companion");
  await address.fill("192.168.178.250");
  await page.getByRole("button", { name: "Connect VibeTV" }).click();
  await page.getByText("No VibeTV device was found.").waitFor({
    timeout: 10_000,
  });
  assert(repairRequests.length === 1, "Unreachable valid IP should be tried once");
  assertNoInstallRequests(installRequests);
  await page.close();
}

async function testLocalWifiSearchAutoSelectsOnlyKnownResult(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  const repairRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    device: { connected: false, paired: false },
    searchDevices: [
      {
        target: "http://192.168.178.81",
        deviceId: "unknown-81",
        networkMode: "station",
        known: false,
      },
      {
        target: "http://192.168.178.82",
        deviceId: "known-82",
        networkMode: "station",
        known: true,
      },
    ],
    onRepair: (postData) => {
      repairRequests.push(postData || "");
      return { ...companionDevice, target: "http://192.168.178.82" };
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "VibeTV is on WiFi" }).click();
  await page.getByRole("heading", { name: "VibeTV is connected" }).waitFor({
    timeout: 10_000,
  });
  assert(repairRequests.length === 1, "Exactly one known VibeTV should auto-connect");
  const request = JSON.parse(repairRequests[0] || "{}");
  assert(request.target === "http://192.168.178.82", "Known target should win");
  assert(request.expectedDeviceId === "known-82", "Known identity must stay pinned");
  assertNoInstallRequests(installRequests);
  await page.close();
}

async function testRunningPairingErrorRepairsAutomaticallyOnce(
  browser,
  appUrl,
) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  const repairRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    device: {
      ...companionDevice,
      deviceId: "known-device-1",
      paired: false,
      ready: false,
      stream: {
        healthy: false,
        running: true,
        errorCode: "device_pairing_required",
      },
    },
    onRepair: (postData) => {
      repairRequests.push(postData || "");
      return { ...companionDevice, deviceId: "known-device-1" };
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "VibeTV is connected" }).waitFor({
    timeout: 10_000,
  });
  await page.waitForTimeout(5_500);
  assert(
    repairRequests.length === 1,
    `Pairing error should trigger exactly one automatic repair, got ${repairRequests.length}`,
  );
  const repairPayload = JSON.parse(repairRequests[0] || "{}");
  assert(
    repairPayload.forcePair == null || repairPayload.forcePair === false,
    `Automatic pairing repair must not force token rotation, got ${repairRequests[0]}`,
  );
  assert(
    repairPayload.expectedDeviceId === "known-device-1",
    `Automatic repair must pin the saved identity, got ${repairRequests[0]}`,
  );
  assert(
    (await page.getByText("pairing token", { exact: false }).count()) === 0,
    "Customers must never be asked to enter a pairing token",
  );
  assertNoInstallRequests(installRequests);
  await page.close();
}

async function testFailedPairingErrorDoesNotLoop(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  let repairRequests = 0;
  await routeCompanionOnline(page, installRequests, () => {}, {
    device: {
      ...companionDevice,
      deviceId: "known-device-failed",
      paired: false,
      ready: false,
      stream: {
        healthy: false,
        running: true,
        errorCode: "device_pairing_required",
      },
    },
    repairError: true,
    onRequest: (pathname, method) => {
      if (pathname === "/v1/device/repair" && method === "POST") {
        repairRequests += 1;
      }
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByText("VibeTV could not reconnect automatically.").waitFor({
    timeout: 10_000,
  });
  await page.waitForTimeout(6_000);
  assert(
    repairRequests === 1,
    `One pairing error must trigger at most one automatic repair, got ${repairRequests}`,
  );
  assertNoInstallRequests(installRequests);
  await page.close();
}

async function testHostedEntryShowsMacAppDownload(
  browser,
  appUrl,
  { expectDmg, path = "/" },
) {
  const page = await browser.newPage({ viewport });
  const installRequests = [];
  const companionRequests = [];
  await routeHostedAppThroughLocalNext(page, appUrl);
  await routeCompanionMissing(page, installRequests, (pathname) => {
    companionRequests.push(pathname);
  });

  await page.goto(`https://app.vibetv.shop${path}`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("heading", { name: "Get the VibeTV Mac App" }).waitFor({
    timeout: 10_000,
  });
  assert(
    (await page.getByRole("button", { name: "VibeTV is on WiFi" }).count()) ===
      0,
    "Hosted entry must not start the VibeTV WiFi flow",
  );
  assert(
    (await page.getByRole("button", { name: "Mac App is installed" }).count()) ===
      0,
    "Hosted entry should hand off when the customer opens the downloaded app",
  );
  assert(
    (await page.getByRole("button", { name: "Open Control Center" }).count()) ===
      0,
    "First hosted entry must not show a second launch action",
  );
  if (expectDmg) {
    await startVerifiedDmgSetupDownload(page, { startDownload: false });
  } else {
    const unavailable = page.getByRole("button", {
      name: "Mac App download not ready",
    });
    await unavailable.waitFor({ timeout: 10_000 });
    assert(await unavailable.isDisabled(), "Unavailable DMG must stay disabled");
    await assertNoDmgDownloadActions(page);
  }
  assert(
    (await page.getByRole("tab", { name: "Agentic setup" }).count()) === 0 &&
      (await page.getByRole("tab", { name: "Manual setup" }).count()) === 0,
    "Hosted entry must not fall back to Terminal installation",
  );
  assert(
    companionRequests.length === 0,
    `Hosted entry must not probe the local Mac App, got ${JSON.stringify(companionRequests)}`,
  );
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testHostedThemeEntryShowsMacAppDownload(
  browser,
  appUrl,
  { expectDmg },
) {
  await testHostedEntryShowsMacAppDownload(browser, appUrl, {
    expectDmg,
    path: "/install/synthwave",
  });
}

async function testHostedPriorVisitStillShowsMacAppDownload(
  browser,
  appUrl,
  { expectDmg },
) {
  const page = await browser.newPage({ viewport });
  const installRequests = [];
  const companionRequests = [];
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "vibetv.controlCenter.localControlCenterOpened",
      "1",
    );
  });
  await routeHostedAppThroughLocalNext(page, appUrl);
  await routeCompanionMissing(page, installRequests, (pathname) => {
    companionRequests.push(pathname);
  });

  await page.goto("https://app.vibetv.shop/", { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Get the VibeTV Mac App" }).waitFor({
    timeout: 10_000,
  });
  assert(
    (await page.getByRole("button", { name: "Open Control Center" }).count()) ===
      0,
    "A prior visit must not replace the hosted download with a launcher",
  );
  if (expectDmg) {
    await startVerifiedDmgSetupDownload(page, { startDownload: false });
  } else {
    const unavailable = page.getByRole("button", {
      name: "Mac App download not ready",
    });
    await unavailable.waitFor({ timeout: 10_000 });
    assert(await unavailable.isDisabled(), "Unavailable DMG must stay disabled");
    await assertNoDmgDownloadActions(page);
  }
  assert(
    (await page.getByRole("button", { name: "VibeTV is on WiFi" }).count()) ===
      0,
    "A prior hosted visit must not own device onboarding",
  );
  assert(
    companionRequests.length === 0,
    `A prior hosted visit must not probe the local Mac App, got ${JSON.stringify(companionRequests)}`,
  );
  assertNoInstallRequests(installRequests);
  await page.close();
}

async function testLocalFreshAppWaitsForWifiConfirmation(
  browser,
  appUrl,
) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  const repairRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    device: { connected: false },
    onRepair: (postData) => {
      repairRequests.push(postData || "");
      return { connected: false, paired: false };
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Set up your VibeTV" }).waitFor({
    timeout: 10_000,
  });
  await page.getByRole("heading", { name: "Connect VibeTV to WiFi" }).waitFor({
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "VibeTV is on WiFi" }).waitFor({
    timeout: 10_000,
  });
  assert(
    (await page.getByRole("heading", { name: "Download Mac App" }).count()) ===
      0 &&
      (await page.getByRole("link", { name: "Download Mac App" }).count()) ===
        0,
    "Installed Mac App must never show its own download step during onboarding",
  );
  assert(
    repairRequests.length === 0,
    `Fresh local onboarding must wait for WiFi confirmation, got ${JSON.stringify(repairRequests)}`,
  );
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testLocalReachableWithoutFrameStaysInSetup(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, {
    viewport: desktopViewport,
  });
  const installRequests = [];
  const repairRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    device: reachableUnreadyDevice,
    onRepair: (postData) => {
      repairRequests.push(postData || "");
      return reachableUnreadyDevice;
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Set up your VibeTV" }).waitFor({
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "VibeTV is on WiFi" }).waitFor({
    timeout: 10_000,
  });
  assert(
    await page.getByRole("button", { name: "Overview" }).isDisabled(),
    "A reachable and paired VibeTV must stay in Setup while ready is false",
  );
  assert(
    (await page.getByText("Setup needed", { exact: true }).count()) === 1,
    "The desktop status must not turn green before a display frame is rendered",
  );
  assert(
    repairRequests.length === 0,
    "Opening Setup must not automatically retry a reachable but unready VibeTV",
  );
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testLocalSetupRecoversWhenDeviceBecomesReady(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, {
    viewport: desktopViewport,
  });
  const installRequests = [];
  const repairRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    device: reachableUnreadyDevice,
    statusDeviceSequence: [reachableUnreadyDevice, companionDevice],
    onRequest: (pathname, method) => {
      if (pathname === "/v1/device/repair" && method === "POST") {
        repairRequests.push(pathname);
      }
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Set up your VibeTV" }).waitFor({
    timeout: 10_000,
  });
  await page.getByRole("heading", { name: "VibeTV is connected" }).waitFor({
    timeout: 12_000,
  });
  assert(
    repairRequests.length === 0,
    "Setup recovery must use read-only status polling without pairing or repair writes",
  );
  assertNoInstallRequests(installRequests);
  await page.close();
}

async function testLocalExistingSetupOpensOverviewWithoutRepair(
  browser,
  appUrl,
) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  const repairRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    device: companionDevice,
    onRepair: (postData) => {
      repairRequests.push(postData || "");
      return companionDevice;
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "VibeTV is connected" }).waitFor({
    timeout: 10_000,
  });
  assert(
    repairRequests.length === 0,
    `Existing healthy setup must not write or repair on open, got ${JSON.stringify(repairRequests)}`,
  );
  assert(
    (await page.getByRole("button", { name: "VibeTV is on WiFi" }).count()) ===
      0 &&
      (await page.getByRole("link", { name: "Download Mac App" }).count()) ===
        0,
    "Existing setup should open Overview without onboarding or download steps",
  );
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testInitialHealthyStatusRaceAvoidsRepair(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  const repairRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    device: companionDevice,
    firstStatusDelayMs: 250,
    onRequest: (pathname, method) => {
      if (method === "POST" && pathname === "/v1/device/repair") {
        repairRequests.push(pathname);
      }
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  const wifiReadyButton = page.getByRole("button", {
    name: "VibeTV is on WiFi",
  });
  await wifiReadyButton.waitFor({ timeout: 10_000 });
  await wifiReadyButton.click();
  await page.getByRole("heading", { name: "VibeTV is connected" }).waitFor({
    timeout: 10_000,
  });
  assert(
    repairRequests.length === 0,
    `A late healthy status must skip repair, got ${JSON.stringify(repairRequests)}`,
  );
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testInstallThemeLinkStaysOnSetupWhenThemeLibraryLocked(
  browser,
  appUrl,
) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  await routeCompanionMissing(page, installRequests);

  await page.goto(`${appUrl}/install/does-not-exist`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("heading", { name: "Set up your VibeTV" }).waitFor({
    timeout: 10_000,
  });
  await assertThemeLibraryLockedBehindSetup(page);
  await assertNoSetupJargon(page);
  await assertNoDmgDownloadActions(page);
  await page.getByRole("button", { name: "VibeTV is on WiFi" }).click();
  await assertNoDmgDownloadActions(page);

  assert(
    (await page.getByText("Shopify theme link was not found").count()) === 0,
    "locked Theme Library should not show missing-theme notices",
  );
  assert(
    (await page.getByText("Theme not available").count()) === 0,
    "locked Theme Library should not show missing-theme headings",
  );
  assert(
    (await page.getByText("Fixture Synthwave Theme").count()) === 0,
    "locked Theme Library should not show theme rows",
  );
  await assertNoLegacyCompanionDownloadActions(page);
  await assertNoThemeLibraryReleaseDiagnostics(page);
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testSetupTabsAreLockedUntilSetupComplete(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  await routeCompanionMissing(page, installRequests);

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  const settingsButton = page.getByRole("button", {
    name: "Settings",
  });
  const themeLibraryButton = page.getByRole("button", {
    name: "Theme Library",
  });
  const updatesButton = page.getByRole("button", {
    name: "Updates",
  });
  const overviewButton = page.getByRole("button", {
    name: "Overview",
  });
  const supportButton = page.getByRole("button", {
    name: "Support",
  });
  await overviewButton.waitFor({ timeout: 10_000 });
  await settingsButton.waitFor({ timeout: 10_000 });
  await themeLibraryButton.waitFor({ timeout: 10_000 });
  await updatesButton.waitFor({ timeout: 10_000 });
  await supportButton.waitFor({ timeout: 10_000 });
  assert(
    await overviewButton.isDisabled(),
    "Overview tab should stay disabled until setup is complete",
  );
  assert(
    await settingsButton.isDisabled(),
    "Settings tab should stay disabled until setup is complete",
  );
  assert(
    await themeLibraryButton.isDisabled(),
    "Theme Library tab should stay disabled until setup can install themes",
  );
  assert(
    await updatesButton.isDisabled(),
    "Updates tab should stay disabled until setup is complete",
  );
  assert(
    await supportButton.isDisabled(),
    "Support tab should stay disabled until setup is complete",
  );
  assert(
    (await page.getByText("Selected in this app").count()) === 0,
    "locked Theme Library tab should not preselect the first theme",
  );
  assert(
    (await page.getByRole("heading", { name: "Choose a theme" }).count()) === 0,
    "locked Theme Library tab should not navigate to the theme chooser",
  );
  await assertNoSetupJargon(page);
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testSetupUnlocksWhenThemeInstallGateDisabled(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    companionFeatures: { themeInstallEnabled: false },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("nav button")).some(
        (button) =>
          button.textContent?.includes("Overview") && !button.disabled,
      ),
    null,
    { timeout: 20_000 },
  );
  for (const tabName of [
    "Overview",
    "Settings",
    "Theme Library",
    "Updates",
    "Support",
  ]) {
    const button = page.getByRole("button", { name: tabName });
    await button.waitFor({ timeout: 10_000 });
    assert(
      !(await button.isDisabled()),
      `${tabName} tab should be unlocked after paired setup even when theme installs are gated`,
    );
  }
  assert(
    (await page.getByText("needs an update before themes").count()) === 0,
    "setup must not require theme install availability",
  );
  await page.getByRole("button", { name: "Setup", exact: true }).click();
  await page.getByRole("heading", { name: "Setup complete" }).waitFor({
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "Run setup again" }).waitFor({
    timeout: 10_000,
  });
  assert(
    (await page.getByText("Connect VibeTV to WiFi").count()) === 0,
    "completed setup should not show the setup checklist",
  );
  assert(
    (await page.getByRole("button", { name: "Run setup again" }).count()) ===
      1,
    "completed local setup should expose one explicit reset action",
  );
  assert(
    (await page.getByRole("button", { name: "Fix connection" }).count()) === 0,
    "completed setup should not show repair actions while healthy",
  );
  await page.getByRole("button", { name: "Overview" }).click();
  await page.getByRole("heading", { name: "VibeTV is connected" }).waitFor({
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "Theme Library" }).click();
  await page
    .getByRole("heading", { name: "Choose a theme" })
    .waitFor({ timeout: 10_000 });
  await page.getByText("Fixture Synthwave Theme").waitFor({ timeout: 10_000 });
  await page.getByText("Fixture Clippy Theme").waitFor({ timeout: 10_000 });
  assertNoInstallRequests(installRequests);
  await page.close();
}

async function testDesktopHeaderDoesNotClaimDeviceDuringSetup(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, {
    viewport: desktopViewport,
  });
  const installRequests = [];
  await routeCompanionMissing(page, installRequests);

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Set up your VibeTV" }).waitFor({
    timeout: 10_000,
  });

  await page.getByText("Setup needed").waitFor({ timeout: 10_000 });
  assert(
    (await page.getByText("vibetv.local").count()) === 0,
    "desktop header should not show vibetv.local while setup is incomplete",
  );

  assertNoInstallRequests(installRequests);
  await page.close();
}

async function testSettingsStayCustomerOnly(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  let settingsCalls = 0;
  await routeCompanionOnline(page, installRequests, () => {
    settingsCalls += 1;
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await waitForCondition(
    () => settingsCalls >= 1,
    "expected settings refresh before opening Settings",
  );

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("heading", { name: "Display" }).waitFor({
    timeout: 10_000,
  });

  const hiddenCustomerText = [
    "Connection controls",
    "VibeTV target",
    "Device facts",
    "Check Companion",
    "Connect VibeTV",
    "Transport",
    "ThemeSpec",
  ];

  for (const text of hiddenCustomerText) {
    assert(
      (await page.getByText(text).count()) === 0,
      `Settings should not show setup/debug text: ${text}`,
    );
  }

  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testUsageShowsCodexCostHistory(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, {
    viewport: desktopViewport,
  });
  const installRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    usageResponse: {
      ok: true,
      generatedAt: "2026-06-29T10:47:46Z",
      source: "codexbar-display",
      usageMode: "used",
      currentProvider: "codex",
      providers: [
        {
          id: "codex",
          label: "Codex",
          source: "oauth",
          session: 0,
          weekly: 6,
          resetSecs: 17839,
          usageMode: "used",
          sessionTokens: 77_000_000,
          weekTokens: 1_170_913_100,
          totalTokens: 4_289_266_786,
          credits: { remaining: 0, updatedAt: "2026-06-29T10:47:46Z" },
          resetCredits: {
            availableCount: 3,
            nextExpiresAt: "2026-07-12T01:42:57Z",
            updatedAt: "2026-06-29T10:47:46Z",
          },
          cost: {
            currencyCode: "USD",
            updatedAt: "2026-06-29T10:47:46Z",
            todayCostUSD: 72.42,
            last30DaysCostUSD: 3694.16,
            last30DaysTokens: 4_300_000_000,
            latestTokens: 77_000_000,
            topModel: "gpt-5.5",
            daily: [
              {
                day: "2026-06-25",
                totalCostUSD: 210.11,
                totalTokens: 230_000_000,
                models: [
                  {
                    name: "gpt-5.5",
                    totalTokens: 230_000_000,
                    costUSD: 210.11,
                  },
                ],
              },
              {
                day: "2026-06-26",
                totalCostUSD: 165.52,
                totalTokens: 184_000_000,
                models: [
                  {
                    name: "gpt-5.5",
                    totalTokens: 184_000_000,
                    costUSD: 165.52,
                  },
                ],
              },
              {
                day: "2026-06-27",
                totalCostUSD: 1.82,
                totalTokens: 1_800_000,
                models: [
                  { name: "gpt-5.5", totalTokens: 1_800_000, costUSD: 1.82 },
                ],
              },
              {
                day: "2026-06-28",
                totalCostUSD: 1.71,
                totalTokens: 813_455,
                models: [
                  { name: "gpt-5.5", totalTokens: 813_455, costUSD: 1.71 },
                ],
              },
              {
                day: "2026-06-29",
                totalCostUSD: 72.42,
                totalTokens: 77_000_000,
                models: [
                  { name: "gpt-5.5", totalTokens: 77_000_000, costUSD: 72.42 },
                ],
              },
            ],
          },
          usageOverTime: [
            {
              day: "2026-06-08",
              totalCreditsUsed: 1008.691,
              services: [{ service: "Desktop App", creditsUsed: 1008.691 }],
            },
          ],
        },
      ],
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Usage" }).click();
  await page.getByRole("heading", { name: "Limit Reset Credits" }).waitFor({
    timeout: 10_000,
  });
  await page
    .getByText("3 manual resets available")
    .waitFor({ timeout: 10_000 });
  await page
    .getByText("Manual resets expire Jul 12")
    .waitFor({ timeout: 10_000 });
  await page
    .getByText("$72.42", { exact: true })
    .first()
    .waitFor({ timeout: 10_000 });
  await page.getByText("$3,694.16").waitFor({ timeout: 10_000 });
  await page.getByText("4.3B").first().waitFor({ timeout: 10_000 });
  await page.getByText("77M").first().waitFor({ timeout: 10_000 });
  await page.getByText("Top model: gpt-5.5").waitFor({ timeout: 10_000 });
  await page.getByLabel("Jun 29 · $72.42 · 77M").hover();
  await page.getByText("Jun 29 · $72.42 · 77M").waitFor({ timeout: 10_000 });
  await page.getByRole("heading", { name: "Codex" }).waitFor({
    timeout: 10_000,
  });

  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testUsageShowsMacAppUpdateForOldMacApp(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, {
    viewport: desktopViewport,
  });
  const installRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    usageStatus: 404,
    usageResponse: "404 page not found",
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Usage" }).click();
  await page.getByText("Mac App update needed.").waitFor({
    timeout: 10_000,
  });
  await page
    .getByText("Run setup again, then refresh usage.")
    .waitFor({ timeout: 10_000 });
  assert(
    (await page.getByText("No provider usage is available yet.").count()) === 0,
    "Usage must not show empty provider copy when the Mac App is too old",
  );

  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testRunSetupAgainReturnsToWifiOnboarding(
  browser,
  appUrl,
) {
  const page = await newCustomerPage(browser, appUrl, {
    viewport: desktopViewport,
  });
  const installRequests = [];
  const resetRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    onReset: (postData) => {
      resetRequests.push(postData || "");
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Setup", exact: true }).click();
  await page.getByRole("button", { name: "Run setup again" }).click();
  await page.getByRole("heading", { name: "Connect VibeTV to WiFi" }).waitFor({
    timeout: 10_000,
  });
  assert(
    resetRequests.length === 1,
    `Run setup again should reset once, got ${resetRequests.length}`,
  );
  assert(
    (await page.getByRole("heading", { name: "Download Mac App" }).count()) ===
      0,
    "Run setup again must not send the installed app to its own download",
  );

  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testUpdatesShowCustomerCompanionAction(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  const macAppUpdateRequests = [];
  const dmgRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    device: { ...companionDevice, firmware: "1.0.33" },
    onMacAppUpdate: (postData) => {
      macAppUpdateRequests.push(postData);
    },
  });
  await page.route(
    "https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1.0.99/VibeTV-Control-Center.dmg",
    async (route) => {
      dmgRequests.push(route.request().url());
      await route.abort();
    },
  );

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Updates" }).click();
  const dmgUpdateLink = page.getByRole("link", {
    name: "Download new Mac App",
  });
  await dmgUpdateLink.waitFor({
    timeout: 10_000,
  });
  assert(
    assetName(await dmgUpdateLink.getAttribute("href")) ===
      "VibeTV-Control-Center.dmg",
    "Updates should use the verified DMG release asset",
  );
  await page.getByText("Install the new Mac App.").waitFor({ timeout: 10_000 });
  await page.getByText(/choose Replace/).waitFor({ timeout: 10_000 });
  await page.getByText("Installed version").waitFor({ timeout: 10_000 });
  await page.getByText("Latest version").waitFor({ timeout: 10_000 });
  assert(
    (await page.getByRole("button", { name: "Copy update command" }).count()) ===
      0,
    "DMG update must not offer the Terminal updater",
  );
  await assertNoMobileOverflow(page);
  await dmgUpdateLink.click();
  await waitForCondition(
    () => dmgRequests.length === 1,
    "DMG update should start one verified download",
  );
  assert(
    dmgRequests.length === 1,
    `DMG update should start one verified download, got ${dmgRequests.length}`,
  );
  assert(
    macAppUpdateRequests.length === 0,
    "DMG update must never call the legacy /v1/mac-app/update endpoint",
  );
  assertNoInstallRequests(installRequests);
  await page.close();
}

async function testLegacyInstallMigratesToDmgAtSameVersion(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, {
    viewport: desktopViewport,
  });
  const installRequests = [];
  const macAppUpdateRequests = [];
  const dmgRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    companionFeatures: {
      themeInstallEnabled: true,
      macAppSelfUpdateEnabled: false,
    },
    companionVersion: "1.0.99",
    device: { ...companionDevice, firmware: "1.0.33" },
    installationMode: "legacy",
    onRequest: (pathname, method) => {
      if (pathname.startsWith("/v1/mac-app/update")) {
        macAppUpdateRequests.push(`${method} ${pathname}`);
      }
    },
  });
  await page.route(
    "https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1.0.99/VibeTV-Control-Center.dmg",
    async (route) => {
      dmgRequests.push(route.request().url());
      await route.abort();
    },
  );

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await assertCompanionReleaseApi(appUrl, {
    dmgDownloadAsset: "VibeTV-Control-Center.dmg",
    dmgDownloadStatus: "available",
    installedVersion: "1.0.99",
    latestVersion: "1.0.99",
    status: "available",
    updateAvailable: false,
  });
  await page
    .getByRole("heading", { name: "Move to the new Mac App" })
    .waitFor({ timeout: 10_000 });
  const overviewDownload = page.getByRole("link", {
    name: "Download new Mac App",
  });
  await overviewDownload.waitFor({ timeout: 10_000 });
  assert(
    assetName(await overviewDownload.getAttribute("href")) ===
      "VibeTV-Control-Center.dmg",
    "Legacy Overview must use the verified DMG release asset",
  );
  await captureMigrationScreenshot(page, "01-legacy-overview.png");

  await page.getByRole("button", { name: "Updates" }).click();
  await page
    .getByRole("heading", { name: "Move to the new Mac App" })
    .waitFor({ timeout: 10_000 });
  const updatesDownload = page.getByRole("link", {
    name: "Download new Mac App",
  });
  await updatesDownload.waitFor({ timeout: 10_000 });
  await page.getByText("Move to the new Mac App.").waitFor({
    timeout: 10_000,
  });
  await captureMigrationScreenshot(page, "02-legacy-updates.png");
  await updatesDownload.click();
  await waitForCondition(
    () => dmgRequests.length === 1,
    "Legacy migration should start one verified DMG download",
  );
  assert(
    macAppUpdateRequests.length === 0,
    "Legacy migration must never call /v1/mac-app/update",
  );
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testLegacyMigrationStaysAvailableWhenVibeTVOffline(
  browser,
  appUrl,
) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  const macAppUpdateRequests = [];
  const repairRequests = [];
  const companionWriteRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    companionFeatures: {
      themeInstallEnabled: true,
      macAppSelfUpdateEnabled: false,
    },
    companionVersion: "1.0.99",
    device: { connected: false },
    installationMode: "legacy",
    onRepair: (postData) => {
      repairRequests.push(postData || "");
      return { connected: false };
    },
    onRequest: (pathname, method) => {
      if (method !== "GET") {
        companionWriteRequests.push(`${method} ${pathname}`);
      }
      if (pathname.startsWith("/v1/mac-app/update")) {
        macAppUpdateRequests.push(`${method} ${pathname}`);
      }
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("heading", { name: "Move to the new Mac App" })
    .waitFor({ timeout: 10_000 });
  assert(
    (await page.getByRole("button", { name: "VibeTV is on WiFi" }).count()) ===
      1,
    "Legacy migration must keep the existing VibeTV setup flow available",
  );
  await page.getByRole("link", { name: "Download new Mac App" }).waitFor({
    timeout: 10_000,
  });
  await captureMigrationScreenshot(page, "03-legacy-offline-setup.png");
  assert(
    repairRequests.length === 0,
    "Legacy migration must stay available without writing to an offline VibeTV",
  );
  assert(
    companionWriteRequests.length === 0,
    `Opening offline legacy migration must not write to VibeTV: ${companionWriteRequests.join(", ")}`,
  );
  assert(
    macAppUpdateRequests.length === 0,
    "Offline legacy migration must not call the legacy Mac App updater",
  );
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testLegacyFeatureFallbackMigratesAtSameVersion(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  const macAppUpdateRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    companionFeatures: {
      themeInstallEnabled: true,
      macAppSelfUpdateEnabled: true,
    },
    companionVersion: "1.0.99",
    device: { ...companionDevice, firmware: "1.0.33" },
    installationMode: null,
    onRequest: (pathname, method) => {
      if (pathname.startsWith("/v1/mac-app/update")) {
        macAppUpdateRequests.push(`${method} ${pathname}`);
      }
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("heading", { name: "Move to the new Mac App" })
    .waitFor({ timeout: 10_000 });
  assert(
    macAppUpdateRequests.length === 0,
    "Legacy feature fallback must not call the legacy Mac App updater",
  );
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testDmgInstallStaysUpToDateAtSameVersion(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  const macAppUpdateRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    companionFeatures: {
      themeInstallEnabled: true,
      macAppSelfUpdateEnabled: false,
    },
    companionVersion: "1.0.99",
    device: { ...companionDevice, firmware: "1.0.33" },
    installationMode: "dmg",
    onRequest: (pathname, method) => {
      if (pathname.startsWith("/v1/mac-app/update")) {
        macAppUpdateRequests.push(`${method} ${pathname}`);
      }
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "VibeTV is connected" }).waitFor({
    timeout: 10_000,
  });
  assert(
    (await page.getByRole("heading", { name: "Move to the new Mac App" }).count()) ===
      0,
    "DMG Overview must not show the legacy migration card",
  );
  await page.getByRole("button", { name: "Updates" }).click();
  await page.getByRole("heading", { name: "Up to date" }).waitFor({
    timeout: 10_000,
  });
  assert(
    (await page.getByRole("link", { name: "Download new Mac App" }).count()) ===
      0,
    "Current DMG install must not show a migration download",
  );
  assert(
    (await page.getByRole("link", { name: "Download new Mac App" }).count()) ===
      0,
    "Current DMG install must not show an update download",
  );
  assert(
    macAppUpdateRequests.length === 0,
    "Current DMG install must never call /v1/mac-app/update",
  );
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testLegacyMigrationCanRetryFailedRelease(
  browser,
  appUrl,
  fixtureServer,
) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  const macAppUpdateRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    companionFeatures: {
      themeInstallEnabled: true,
      macAppSelfUpdateEnabled: false,
    },
    companionVersion: "1.0.41",
    device: { ...companionDevice, firmware: "1.0.33" },
    installationMode: "legacy",
    onRequest: (pathname, method) => {
      if (pathname.startsWith("/v1/mac-app/update")) {
        macAppUpdateRequests.push(`${method} ${pathname}`);
      }
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Updates" }).click();
  await page.getByRole("heading", { name: "Update check failed" }).waitFor({
    timeout: 10_000,
  });
  const retry = page.getByRole("button", { name: "Check again" });
  await retry.waitFor({ timeout: 10_000 });
  assert(await retry.isEnabled(), "Failed DMG check must offer an active retry");
  const requestsBeforeRetry = fixtureServer.failedReleaseRequestCount;
  await retry.click();
  await waitForCondition(
    () => fixtureServer.failedReleaseRequestCount > requestsBeforeRetry,
    "Check again should repeat the hosted DMG release request",
  );
  await page.getByRole("heading", { name: "Update check failed" }).waitFor({
    timeout: 10_000,
  });
  assert(
    await page.getByRole("button", { name: "Check again" }).isEnabled(),
    "A repeated hosted release failure must leave retry available",
  );
  assert(
    macAppUpdateRequests.length === 0,
    "DMG release retry must not call the legacy Mac App updater",
  );
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testOfflineLegacyMigrationCanRetryFailedRelease(
  browser,
  appUrl,
  fixtureServer,
) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  const companionWriteRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    companionFeatures: {
      themeInstallEnabled: true,
      macAppSelfUpdateEnabled: false,
    },
    companionVersion: "1.0.41",
    device: {
      ...companionDevice,
      connected: false,
      ready: false,
      stream: { healthy: false, running: false },
    },
    installationMode: "legacy",
    onRequest: (pathname, method) => {
      if (method !== "GET") {
        companionWriteRequests.push(`${method} ${pathname}`);
      }
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("heading", { name: "Move to the new Mac App" })
    .waitFor({ timeout: 10_000 });
  const retry = page.getByRole("button", { name: "Check again" });
  await retry.waitFor({ timeout: 10_000 });
  assert(
    await retry.isEnabled(),
    "Offline legacy migration must expose the hosted release retry",
  );
  const requestsBeforeRetry = fixtureServer.failedReleaseRequestCount;
  await retry.click();
  await waitForCondition(
    () => fixtureServer.failedReleaseRequestCount > requestsBeforeRetry,
    "Offline Check again should repeat the hosted DMG release request",
  );
  await page.getByRole("button", { name: "Check again" }).waitFor({
    timeout: 10_000,
  });
  assert(
    await page.getByRole("button", { name: "Check again" }).isEnabled(),
    "Offline hosted release failure must leave retry available",
  );
  assert(
    companionWriteRequests.length === 0,
    `Offline release retry must not write to VibeTV: ${companionWriteRequests.join(", ")}`,
  );
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testUpdatesShowLegacyCompanionReleaseFallback(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    legacyCompanionRelease: true,
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Updates" }).click();
  await page
    .getByRole("link", { name: "Download new Mac App" })
    .waitFor({ timeout: 10_000 });
  const macAppSection = page.locator("section.border-b").filter({
    has: page.getByRole("heading", { name: "Mac App" }),
  });
  await macAppSection
    .getByText("1.0.32", { exact: true })
    .waitFor({ timeout: 10_000 });
  await macAppSection
    .getByText("1.0.99", { exact: true })
    .waitFor({ timeout: 10_000 });

  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testFirmwareUpdateShowsCustomerProgress(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  const updateRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    companionVersion: "1.0.99",
    onUpdate: (postData) => {
      updateRequests.push(postData);
    },
    dropBoardAfterFirmwareUpdate: true,
    updateStatusSequence: [
      {
        phase: "installing",
        message: "Updating VibeTV.",
        progress: 65,
        logs: [
          "Preparing VibeTV update.",
          "Checking VibeTV.",
          "Checking update.",
          "Update downloaded.",
          "Updating VibeTV.",
        ],
      },
      {
        phase: "complete",
        message: "Update complete.",
        progress: 100,
        logs: [
          "Preparing VibeTV update.",
          "Checking VibeTV.",
          "Checking update.",
          "Update downloaded.",
          "Updating VibeTV.",
          "Restarting VibeTV.",
          "Update complete.",
        ],
        result: { firmware: "1.0.33" },
      },
    ],
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Updates" }).click();
  const firmwareSection = page.locator("section.border-b").filter({
    has: page.getByRole("heading", { name: "Firmware update" }),
  });
  await page.getByRole("button", { name: "Update now" }).waitFor({
    timeout: 10_000,
  });
  assert(
    (await page.getByRole("button", { name: "Update now" }).count()) === 1,
    "Updates should show one primary Update now button",
  );
  await page.getByRole("button", { name: "Update now" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Updating VibeTV" })
    .waitFor({ timeout: 10_000 });
  await page
    .getByRole("status")
    .filter({ hasText: "Update complete" })
    .waitFor({ timeout: 10_000 });
  await page.getByText("Firmware 1.0.33 is installed.").waitFor({
    timeout: 10_000,
  });
  await firmwareSection.getByText("Up to date").waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "Check for updates" }).waitFor({
    timeout: 10_000,
  });
  assert(
    (await page.getByRole("button", { name: "Checking updates" }).count()) ===
      0,
    "firmware update button should not stay in checking state after success",
  );
  assert(
    (await firmwareSection.getByText("Checking", { exact: true }).count()) ===
      0,
    "firmware rows should not stay in checking state after success",
  );
  assert(updateRequests.length === 1, "firmware update should start once");

  for (const text of ["sha256", "/update/firmware", "firmwareUrl"]) {
    assert(
      (await page.getByText(text, { exact: false }).count()) === 0,
      `Firmware update progress should not show technical text: ${text}`,
    );
  }

  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testUpdatesKeepDmgHiddenWithoutVerifiedAsset(
  browser,
  appUrl,
) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  const macAppUpdateRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    companionFeatures: {
      themeInstallEnabled: true,
      macAppSelfUpdateEnabled: false,
    },
    companionVersion: "1.0.96",
    device: { ...companionDevice, firmware: "1.0.33" },
    installationMode: "legacy",
    onRequest: (pathname, method) => {
      if (pathname.startsWith("/v1/mac-app/update")) {
        macAppUpdateRequests.push(`${method} ${pathname}`);
      }
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await assertCompanionReleaseApi(appUrl, {
    dmgDownloadAsset: null,
    dmgDownloadStatus: "missing_asset",
    installedVersion: "1.0.96",
    latestVersion: "1.0.96",
    status: "available",
    updateAvailable: false,
  });
  await page
    .getByRole("heading", { name: "New Mac App is being prepared" })
    .waitFor({ timeout: 10_000 });
  const overviewUnavailableButton = page.getByRole("button", {
    name: "New Mac App not ready",
  });
  await overviewUnavailableButton.waitFor({ timeout: 10_000 });
  assert(
    await overviewUnavailableButton.isDisabled(),
    "Legacy Overview must keep an unavailable DMG disabled",
  );
  await page.getByRole("button", { name: "Updates" }).click();
  const unavailableButton = page.getByRole("button", {
    name: "New Mac App not ready",
  });
  await unavailableButton.waitFor({ timeout: 10_000 });
  assert(await unavailableButton.isDisabled(), "Unavailable DMG must stay disabled");
  assert(
    (await page.getByRole("link", { name: "Download new Mac App" }).count()) ===
      0,
    "Updates must not show a DMG link without a verified asset",
  );
  assert(
    (await page.getByRole("button", { name: "Copy update command" }).count()) ===
      0,
    "Updates must not fall back to the Terminal updater",
  );
  assert(
    macAppUpdateRequests.length === 0,
    "Unavailable DMG must never call the legacy Mac App updater",
  );

  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testLegacyMigrationDoesNotBlockFirmwareUpdate(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  const macAppUpdateRequests = [];
  const firmwareUpdateRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    companionFeatures: {
      themeInstallEnabled: true,
      macAppSelfUpdateEnabled: false,
    },
    companionVersion: "1.0.96",
    device: { ...companionDevice, firmware: "1.0.32" },
    installationMode: "legacy",
    onRequest: (pathname, method) => {
      if (pathname.startsWith("/v1/mac-app/update")) {
        macAppUpdateRequests.push(`${method} ${pathname}`);
      }
    },
    onUpdate: (postData) => {
      firmwareUpdateRequests.push(postData);
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Updates" }).click();
  await page.getByRole("heading", { name: "Update available" }).waitFor({
    timeout: 10_000,
  });
  const updateNow = page.getByRole("button", { name: "Update now" });
  await updateNow.waitFor({ timeout: 10_000 });
  assert(
    await updateNow.isEnabled(),
    "Unavailable DMG migration must not disable a VibeTV firmware update",
  );
  await page.getByText("New Mac App is not ready yet.").waitFor({
    timeout: 10_000,
  });
  await updateNow.click();
  await waitForCondition(
    () => firmwareUpdateRequests.length === 1,
    "Firmware update should start while the migration DMG is unavailable",
  );
  assert(
    macAppUpdateRequests.length === 0,
    "Firmware update must not call the legacy Mac App updater",
  );
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testSupportReportExportsAppearAfterReportLoads(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  await routeCompanionOnline(page, installRequests);

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Support" }).click();
  await page.getByRole("heading", { name: "Support report" }).waitFor({
    timeout: 10_000,
  });

  assert(
    (await page.getByRole("button", { name: "Copy report" }).count()) === 0,
    "Support report should not show Copy before a report is loaded",
  );
  assert(
    (await page.getByRole("button", { name: "Download report" }).count()) === 0,
    "Support report should not show Download before a report is loaded",
  );

  await page.getByRole("button", { name: "Create report" }).click();
  await page.getByRole("button", { name: "Copy report" }).waitFor({
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "Download report" }).waitFor({
    timeout: 10_000,
  });
  await page.getByText("VibeTV address", { exact: true }).waitFor({
    timeout: 10_000,
  });
  assert(
    (await page.getByText("Companion", { exact: false }).count()) === 0,
    "Support report should not show internal Companion naming",
  );
  assert(
    (await page.getByText("Target", { exact: true }).count()) === 0,
    "Support report should use customer language for the VibeTV address",
  );
  const hiddenSupportText = [
    "Companion",
    "API",
    "target",
    "http://vibetv.local",
    "COMPANION_UNREACHABLE",
  ];
  for (const text of hiddenSupportText) {
    assert(
      (await page.getByText(text, { exact: false }).count()) === 0,
      `Support report should not show internal diagnostic text: ${text}`,
    );
  }

  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testSavedAddressDoesNotBlockConfirmedVibeTVSearch(
  browser,
  appUrl,
) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  const repairRequests = [];
  let settingsCalls = 0;
  await routeCompanionOnline(
    page,
    installRequests,
    () => {
      settingsCalls += 1;
    },
    {
      device: {
        ...companionDevice,
        target: "http://192.168.178.163",
        connected: false,
        paired: true,
        ready: false,
        stream: { healthy: false, running: true },
      },
      searchDevices: [
        {
          target: "http://vibetv.local",
          deviceId: "fixture-device-1",
          networkMode: "station",
          known: true,
        },
      ],
      onRepair: (postData) => {
        repairRequests.push(postData || "");
        return {
          ...companionDevice,
          target: "http://vibetv.local",
          connected: true,
          paired: true,
        };
      },
    },
  );
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "vibetv.controlCenter.deviceTarget",
      "http://192.168.178.163",
    );
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  const wifiReadyButton = page.getByRole("button", {
    name: "VibeTV is on WiFi",
  });
  await wifiReadyButton.waitFor({ timeout: 10_000 });
  assert(
    repairRequests.length === 0,
    "A stale saved address must not trigger repair before WiFi confirmation",
  );
  await wifiReadyButton.click();
  await page.getByText("VibeTV is connected").waitFor({ timeout: 10_000 });
  await waitForCondition(
    () => repairRequests.length === 1,
    "expected one confirmed VibeTV repair to run",
  );

  const repairPayload = JSON.parse(repairRequests[0] || "{}");
  assert(
    repairPayload.target === "http://vibetv.local",
    `confirmed repair should use the fresh search result, got ${repairRequests[0]}`,
  );
  assert(
    repairPayload.forcePair == null || repairPayload.forcePair === false,
    `confirmed repair should preserve a valid pairing token, got ${repairRequests[0]}`,
  );
  assert(
    settingsCalls >= 1,
    "confirmed repair should continue into settings refresh after finding VibeTV",
  );
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testOverviewSeparatesMacAppAndFirmwareVersions(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, {
    viewport: desktopViewport,
  });
  const installRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    companionVersion: "1.0.33",
    device: {
      ...companionDevice,
      activeTheme: "synthwave",
      firmware: "1.0.32",
    },
    usageResponse: {
      ok: true,
      generatedAt: "2026-06-29T10:47:46Z",
      source: "codexbar-display",
      usageMode: "used",
      currentProvider: "codex",
      providers: [
        {
          id: "codex",
          label: "Codex",
          source: "oauth",
          session: 27,
          weekly: 63,
          resetSecs: 5400,
          usageMode: "used",
          activity: "coding",
          sessionTokens: 77_000_000,
        },
      ],
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByText("VibeTV is connected").waitFor({ timeout: 10_000 });
  await page.getByText("Mac App").waitFor({ timeout: 10_000 });
  await page.getByText("Online 1.0.33").waitFor({ timeout: 10_000 });
  await page.getByText("VibeTV firmware").waitFor({ timeout: 10_000 });
  await page.getByText("1.0.32").waitFor({ timeout: 10_000 });
  await page
    .getByRole("img", {
      name: /Rendered VibeTV theme synthwave showing Codex, 27% session used, 63% weekly used/,
    })
    .waitFor({ timeout: 10_000 });
  const renderedTheme = page.getByRole("img", {
    name: /Rendered VibeTV theme synthwave/,
  });
  await renderedTheme.getByText("USAGE").waitFor({ timeout: 10_000 });
  await renderedTheme
    .getByText("SESSION used")
    .waitFor({ timeout: 10_000 });
  await renderedTheme
    .getByText("WEEKLY used")
    .waitFor({ timeout: 10_000 });
  await renderedTheme.getByText("27%").waitFor({ timeout: 10_000 });
  await renderedTheme.getByText("63%").waitFor({ timeout: 10_000 });
  const previewFigure = page.locator("figure").filter({ has: renderedTheme });
  assert(
    (await previewFigure.locator('[data-testid="vibetv-case"]').count()) === 1,
    "Overview preview should render the VibeTV case shell",
  );
  assert(
    (await previewFigure.getByText("VIBETV", { exact: true }).count()) === 0,
    "Overview preview should render the theme without device chrome",
  );
  assert(
    (await page
      .getByAltText("VibeTV device showing the current usage theme")
      .count()) === 0,
    "Overview should not render the old static VibeTV image",
  );
  assert(
    (await page.locator("figcaption").count()) === 0,
    "Overview preview should not render the theme caption",
  );

  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testOverviewShowsUsageLoadingUntilRealUsage(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, {
    viewport: desktopViewport,
  });
  const installRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    companionVersion: "1.0.33",
    displayFrameStatus: 404,
    device: {
      ...companionDevice,
      activeTheme: "synthwave",
      firmware: "1.0.32",
      stream: {
        healthy: true,
        running: true,
      },
      display: {
        themeSpec: {
          active: true,
          renderOk: true,
        },
      },
    },
    usageResponse: {
      ok: true,
      generatedAt: "2026-06-29T10:47:46Z",
      source: "codexbar-display",
      usageMode: "used",
      currentProvider: "codex",
      providers: [
        {
          id: "codex",
          label: "Codex",
          source: "oauth",
          session: 27,
          weekly: 63,
          resetSecs: 5400,
          usageMode: "used",
        },
      ],
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByText("VibeTV is connected").waitFor({ timeout: 10_000 });
  const loadingPreview = page.getByRole("img", {
    name: "Loading VibeTV usage preview",
  });
  await loadingPreview.waitFor({ timeout: 10_000 });
  await loadingPreview.getByText("Loading usage").waitFor({ timeout: 10_000 });
  assert(
    (await page
      .getByRole("img", { name: /Rendered VibeTV theme synthwave/ })
      .count()) === 0,
    "Overview preview should not render fake theme usage before real usage arrives",
  );
  assert(
    !(await page.locator("figure").innerText()).includes("100%"),
    "Overview preview should not show fake 100% usage while usage is loading",
  );
  assert(
    !(await page.locator("figure").innerText()).includes("27%") &&
      !(await page.locator("figure").innerText()).includes("63%"),
    "Overview preview must not substitute provider usage when no display frame exists",
  );

  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testOverviewRendersThemeSpecAssetTypes(browser, appUrl) {
  const cases = [
    { id: "mini-classic", kind: "gif" },
    { id: "clippy", kind: "animated-sprite" },
    { id: "cozy-meadow", kind: "static-sprite" },
    { id: "synthwave", kind: "static-sprite" },
    { id: "claude-creature", kind: "animated-sprite" },
  ];

  for (const theme of cases) {
    const page = await newCustomerPage(browser, appUrl, {
      viewport: desktopViewport,
    });
    const installRequests = [];
    await routeCompanionOnline(page, installRequests, () => {}, {
      companionVersion: "1.0.33",
      device: {
        ...companionDevice,
        activeTheme: theme.id,
        firmware: "1.0.32",
        stream: {
          healthy: true,
          running: true,
        },
        display: {
          themeSpec: {
            active: true,
            renderOk: true,
          },
        },
      },
      usageResponse: {
        ok: true,
        generatedAt: "2026-06-29T10:47:46Z",
        source: "codexbar-display",
        usageMode: "used",
        currentProvider: "codex",
        providers: [
          {
            id: "codex",
            label: "Codex",
            source: "oauth",
            session: 27,
            weekly: 63,
            resetSecs: 5400,
            usageMode: "used",
            activity: "coding",
          },
        ],
      },
    });

    await page.goto(appUrl, { waitUntil: "domcontentloaded" });
    const renderedTheme = page.getByRole("img", {
      name: new RegExp(
        `Rendered VibeTV theme ${theme.id} showing Codex, 27% session used, 63% weekly used`,
      ),
    });
    await renderedTheme.waitFor({ timeout: 10_000 });
    await renderedTheme.getByText("Codex").waitFor({ timeout: 10_000 });
    assert(
      (await page.getByText("ThemeSpec not available").count()) === 0,
      `${theme.id} preview should load its ThemeSpec`,
    );

    if (theme.kind === "gif") {
      assert(
        (await renderedTheme.locator("image").count()) >= 1,
        `${theme.id} preview should render GIF assets`,
      );
    } else {
      assert(
        (await renderedTheme.locator("rect").count()) > 10,
        `${theme.id} preview should render sprite primitives`,
      );
    }

    if (theme.kind === "animated-sprite") {
      const firstRender = await renderedTheme.evaluate(
        (node) => node.innerHTML,
      );
      await page.waitForTimeout(650);
      const secondRender = await renderedTheme.evaluate(
        (node) => node.innerHTML,
      );
      assert(
        firstRender !== secondRender,
        `${theme.id} animated sprite should advance frames`,
      );
    }

    assertNoInstallRequests(installRequests);
    await assertNoMobileOverflow(page);
    await page.close();
  }
}

async function testThemeLibraryRendersThemeSpecPreviews(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, {
    viewport: desktopViewport,
  });
  const installRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    companionVersion: "1.0.33",
    device: {
      ...companionDevice,
      firmware: "1.0.32",
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Theme Library" }).click();
  const synthwavePreview = page.getByRole("img", {
    name: /Rendered VibeTV theme synthwave showing VibeTV, 62% session remaining, 62% weekly remaining/,
  });
  await synthwavePreview.waitFor({ timeout: 10_000 });
  assert(
    (await synthwavePreview.locator("rect").count()) > 10,
    "Theme Library preview should render sprite primitives",
  );

  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testInstallLinkKeepsRequestedTheme(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  let settingsCalls = 0;
  await routeCompanionOnline(page, installRequests, () => {
    settingsCalls += 1;
  });

  await page.goto(`${appUrl}/install/synthwave`, { waitUntil: "domcontentloaded" });
  await waitForCondition(
    () => settingsCalls >= 1,
    "expected settings refresh during initial connected Companion check",
  );

  await assertSelectedThemeRow(page, "Fixture Synthwave Theme");
  await assertThemeRowNotSelected(page, "Fixture Clippy Theme");
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testThemeInstallStatusStaysCustomerOnly(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  let settingsCalls = 0;
  await routeCompanionOnline(page, installRequests, () => {
    settingsCalls += 1;
  });

  await page.goto(`${appUrl}/install/synthwave`, { waitUntil: "domcontentloaded" });
  await waitForCondition(
    () => settingsCalls >= 1,
    "expected settings refresh before theme install status check",
  );

  const installButton = page
    .locator("li")
    .filter({ hasText: "Fixture Synthwave Theme" })
    .getByRole("button", { name: "Install" });
  await installButton.waitFor({ timeout: 10_000 });
  await installButton.click();
  await page
    .getByText("Install failed", { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "Try again" }).waitFor({
    timeout: 10_000,
  });

  const hiddenInstallText = [
    "log lines",
    "Pack URL",
    "Install request sent to Companion",
    "cdn.example.test",
  ];
  for (const text of hiddenInstallText) {
    assert(
      (await page.getByText(text).count()) === 0,
      `Theme install status should not show technical text: ${text}`,
    );
  }

  assert(
    installRequests.length === 1,
    `expected one mocked install request, got ${installRequests.length}`,
  );
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testThemeInstallShowsIntermediateProgress(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  let settingsCalls = 0;
  await routeCompanionOnline(
    page,
    installRequests,
    () => {
      settingsCalls += 1;
    },
    {
      installStatusSequence: [
        {
          phase: "installing",
          message: "Uploading theme files.",
          progress: 40,
          logs: ["Preparing theme files.", "Uploading theme files."],
        },
        {
          phase: "installing",
          message: "Uploaded theme file 1.",
          progress: 46,
          logs: [
            "Preparing theme files.",
            "Uploading theme files.",
            "Uploaded theme file 1.",
          ],
        },
        {
          phase: "complete",
          message: "Theme is active on VibeTV.",
          progress: 100,
          logs: [
            "Preparing theme files.",
            "Uploading theme files.",
            "Uploaded theme file 1.",
            "Theme is active on VibeTV.",
          ],
          result: {
            themeId: "synthwave",
            packId: "synthwave",
            name: "Synthwave",
            activePath: "/themes/u/synthwave.json",
            themeRev: 1,
          },
        },
      ],
    },
  );

  await page.goto(`${appUrl}/install/synthwave`, { waitUntil: "domcontentloaded" });
  await waitForCondition(
    () => settingsCalls >= 1,
    "expected settings refresh before theme install progress check",
  );

  const installButton = page
    .locator("li")
    .filter({ hasText: "Fixture Synthwave Theme" })
    .getByRole("button", { name: "Install" });
  await installButton.waitFor({ timeout: 10_000 });
  await installButton.click();
  await page.getByText("Uploading theme files.").waitFor({ timeout: 10_000 });
  await page.getByText("Uploaded theme file 1.").waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "Installed" }).waitFor({
    timeout: 10_000,
  });

  assert(
    installRequests.length === 1,
    `expected one mocked install request, got ${installRequests.length}`,
  );
  assert(
    installRequests[0]?.includes('"async":true'),
    `theme install should request async progress, got ${installRequests[0]}`,
  );
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testCustomerLogsStayCustomerOnly(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  let settingsCalls = 0;
  await routeCompanionOnline(page, installRequests, () => {
    settingsCalls += 1;
  });

  await page.goto(`${appUrl}/install/synthwave`, { waitUntil: "domcontentloaded" });
  await waitForCondition(
    () => settingsCalls >= 1,
    "expected settings refresh before customer log copy check",
  );

  const installButton = page
    .locator("li")
    .filter({ hasText: "Fixture Synthwave Theme" })
    .getByRole("button", { name: "Install" });
  await installButton.waitFor({ timeout: 10_000 });
  await installButton.click();
  await page
    .getByText("Install failed", { exact: true })
    .waitFor({ timeout: 10_000 });

  await page.getByRole("button", { name: "Support" }).click();
  await page.getByRole("heading", { name: "Recent activity" }).waitFor({
    timeout: 10_000,
  });

  const hiddenLogText = [
    "target",
    "protected",
    "Pack URL",
    "Install request sent to Companion",
    "cdn.example.test",
  ];
  for (const text of hiddenLogText) {
    assert(
      (await page.getByText(text, { exact: false }).count()) === 0,
      `Support should not show technical text: ${text}`,
    );
  }

  assert(
    installRequests.length === 1,
    `expected one mocked install request, got ${installRequests.length}`,
  );
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testUnpairedThemeDeepLinkWaitsForWifiConfirmation(
  browser,
  appUrl,
) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  const pairRequests = [];
  let settingsCalls = 0;
  await routeCompanionOnline(
    page,
    installRequests,
    () => {
      settingsCalls += 1;
    },
    {
      device: {
        ...companionDevice,
        paired: false,
        ready: false,
        stream: { healthy: false, running: true },
      },
      onPair: (postData, currentDevice) => {
        pairRequests.push(postData);
        return { ...currentDevice, ...companionDevice, paired: true };
      },
    },
  );

  await page.goto(`${appUrl}/install/synthwave`, { waitUntil: "domcontentloaded" });
  const wifiReadyButton = page.getByRole("button", {
    name: "VibeTV is on WiFi",
  });
  await wifiReadyButton.waitFor({ timeout: 10_000 });
  assert(
    pairRequests.length === 0,
    "An unpaired saved target must not pair before WiFi confirmation",
  );
  await wifiReadyButton.click();
  await page.getByRole("heading", { name: "VibeTV is connected" }).waitFor({
    timeout: 10_000,
  });
  assert(
    (await page
      .getByRole("button", { name: "Overview" })
      .getAttribute("aria-current")) === "page",
    "Successful verification must open Overview even from a theme link",
  );
  await waitForCondition(
    () => settingsCalls >= 1,
    "expected settings refresh after pairing",
  );
  await page.getByRole("button", { name: "Theme Library" }).click();
  await assertSelectedThemeRow(page, "Fixture Synthwave Theme");
  const installButton = page
    .locator("li")
    .filter({ hasText: "Fixture Synthwave Theme" })
    .getByRole("button", { name: "Install" });
  await installButton.waitFor({ timeout: 10_000 });
  assert(
    await installButton.isEnabled(),
    "paired VibeTV should unlock install",
  );
  assert(pairRequests.length === 1, "pairing should call Companion once");
  assert(
    !pairRequests[0]?.includes('"forcePair":true'),
    `explicit verification should not force token rotation: ${pairRequests[0]}`,
  );
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testThemeWithoutPackUrlStaysLocked(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  await routeCompanionMissing(page, installRequests);

  await page.goto(`${appUrl}/install/missing-pack`, {
    waitUntil: "domcontentloaded",
  });

  await page.getByRole("heading", { name: "Set up your VibeTV" }).waitFor({
    timeout: 10_000,
  });
  await assertThemeLibraryLockedBehindSetup(page);
  await assertNoSetupJargon(page);
  assert(
    (await page.getByText("Theme pack missing").count()) === 0,
    "locked Theme Library should not show theme pack diagnostics",
  );
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testBoardIncompatibleThemeStaysLocked(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  let settingsCalls = 0;
  await routeCompanionOnline(page, installRequests, () => {
    settingsCalls += 1;
  });

  await page.goto(`${appUrl}/install/esp32-only`, {
    waitUntil: "domcontentloaded",
  });
  await waitForCondition(
    () => settingsCalls >= 1,
    "expected settings refresh for board compatibility readiness check",
  );

  await assertSelectedThemeRow(page, "Fixture ESP32 Only Theme");

  const lockedButton = page
    .locator("li")
    .filter({ hasText: "Fixture ESP32 Only Theme" })
    .getByRole("button", { name: "Not Supported" });
  await lockedButton.waitFor({ timeout: 10_000 });
  assert(
    await lockedButton.isDisabled(),
    "board-incompatible theme should keep the install button disabled",
  );
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testFirmwareIncompatibleThemeStaysLocked(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  let settingsCalls = 0;
  await routeCompanionOnline(page, installRequests, () => {
    settingsCalls += 1;
  });

  await page.goto(`${appUrl}/install/future-firmware`, {
    waitUntil: "domcontentloaded",
  });
  await waitForCondition(
    () => settingsCalls >= 1,
    "expected settings refresh for firmware compatibility readiness check",
  );

  await assertSelectedThemeRow(page, "Fixture Future Firmware Theme");

  const lockedButton = page
    .locator("li")
    .filter({ hasText: "Fixture Future Firmware Theme" })
    .getByRole("button", { name: "Update Needed" });
  await lockedButton.waitFor({ timeout: 10_000 });
  assert(
    await lockedButton.isDisabled(),
    "firmware-incompatible theme should keep the install button disabled",
  );
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testDisabledDmgFlagHidesSetupAndUpdateLinks(browser, appUrl) {
  let page = await browser.newPage({ viewport });
  const setupInstallRequests = [];
  await routeHostedAppThroughLocalNext(page, appUrl);
  await routeCompanionMissing(page, setupInstallRequests);

  await page.goto("https://app.vibetv.shop/", { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Mac App download not ready" }).waitFor({
    timeout: 10_000,
  });
  const setupUnavailableButton = page.getByRole("button", {
    name: "Mac App download not ready",
  });
  assert(
    await setupUnavailableButton.isDisabled(),
    "Disabled DMG flag must keep hosted download unavailable",
  );
  await assertNoLegacyCompanionDownloadActions(page);
  await assertNoDmgDownloadActions(page);
  assertNoInstallRequests(setupInstallRequests);
  await page.close();

  page = await newCustomerPage(browser, appUrl, { viewport });
  const updateInstallRequests = [];
  const macAppUpdateRequests = [];
  await routeCompanionOnline(page, updateInstallRequests, () => {}, {
    device: { ...companionDevice, firmware: "1.0.33" },
    onMacAppUpdate: (postData) => {
      macAppUpdateRequests.push(postData);
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Updates" }).click();
  const unavailableButton = page.getByRole("button", {
    name: "New Mac App not ready",
  });
  await unavailableButton.waitFor({ timeout: 10_000 });
  assert(await unavailableButton.isDisabled(), "Disabled DMG flag must stay disabled");
  await assertNoLegacyCompanionDownloadActions(page);
  await assertNoDmgDownloadActions(page);
  assert(
    macAppUpdateRequests.length === 0,
    "Disabled DMG flag must not call the legacy Mac App updater",
  );
  assertNoInstallRequests(updateInstallRequests);
  await page.close();
}

async function testScriptOnlyReleaseShowsSupportFallback(browser, appUrl) {
  await testHostedEntryShowsMacAppDownload(browser, appUrl, {
    expectDmg: false,
    path: "/install/synthwave",
  });
}

async function testReleaseCheckFailureShowsNoDownloadActions(browser, appUrl) {
  await testHostedEntryShowsMacAppDownload(browser, appUrl, {
    expectDmg: false,
    path: "/install/synthwave",
  });
}

async function testMissingAssetReleaseShowsNoDownloadActions(browser, appUrl) {
  await testHostedEntryShowsMacAppDownload(browser, appUrl, {
    expectDmg: false,
    path: "/install/synthwave",
  });
}

async function assertCompanionReleaseApi(
  appUrl,
  {
    dmgDownloadAsset,
    dmgDownloadStatus,
    installedVersion = "1.0.32",
    latestVersion,
    status,
    updateAvailable,
  },
) {
  const response = await fetch(
    `${appUrl}/api/companion/latest?version=${encodeURIComponent(installedVersion)}`,
  );
  assert(
    response.ok,
    `expected Companion release API HTTP 200, got ${response.status}`,
  );
  const payload = await response.json();

  assert(
    payload.status === status,
    `release API status=${payload.status}, expected ${status}`,
  );
  assert(
    payload.updateAvailable === updateAvailable,
    `release API updateAvailable=${payload.updateAvailable}, expected ${updateAvailable}`,
  );
  assert(
    (payload.latestVersion || null) === latestVersion,
    `release API latestVersion=${payload.latestVersion}, expected ${latestVersion}`,
  );
  assert(
    payload.installedVersion === installedVersion,
    `release API installedVersion=${payload.installedVersion}, expected ${installedVersion}`,
  );
  assertCustomerApiMessage(payload.message);
  assert(
    payload.dmgDownloadStatus === dmgDownloadStatus,
    `release API dmgDownloadStatus=${payload.dmgDownloadStatus}, expected ${dmgDownloadStatus}`,
  );
  assert(
    response.headers.get("access-control-allow-origin") === "*",
    "release API must allow the embedded local UI to read the hosted DMG check",
  );

  if (dmgDownloadAsset) {
    assert(
      assetName(payload.dmgDownloadUrl) === dmgDownloadAsset,
      `release API DMG asset=${assetName(
        payload.dmgDownloadUrl,
      )}, expected ${dmgDownloadAsset}`,
    );
  } else {
    assert(
      !payload.dmgDownloadUrl,
      `release API should not expose DMG URL, got ${payload.dmgDownloadUrl}`,
    );
  }
}

async function assertFirmwareUpdateApi(
  appUrl,
  { board, firmware, latestFirmware, message, status, updateAvailable },
) {
  const params = new URLSearchParams({ board, firmware });
  const response = await fetch(`${appUrl}/api/firmware/latest?${params}`);
  assert(response.ok, `expected firmware API HTTP 200, got ${response.status}`);
  const payload = await response.json();

  assert(
    payload.status === status,
    `firmware API status=${payload.status}, expected ${status}`,
  );
  assert(
    payload.updateAvailable === updateAvailable,
    `firmware API updateAvailable=${payload.updateAvailable}, expected ${updateAvailable}`,
  );
  assert(
    (payload.latestFirmware || null) === latestFirmware,
    `firmware API latestFirmware=${payload.latestFirmware}, expected ${latestFirmware}`,
  );
  assert(
    payload.installedFirmware === firmware,
    `firmware API installedFirmware=${payload.installedFirmware}, expected ${firmware}`,
  );
  assert(
    payload.message === message,
    `firmware API message=${payload.message}, expected ${message}`,
  );
  assertCustomerFirmwareMessage(payload.message);
}

async function testThemeCatalogApiKeepsCustomerSafeIssue(
  appUrl,
  fixtureServer,
) {
  const initialCatalogRequests = fixtureServer.failedCatalogRequestCount;
  const response = await fetch(`${appUrl}/api/themes`);
  assert(
    response.ok,
    `expected theme catalog API HTTP 200, got ${response.status}`,
  );
  const payload = await response.json();
  assert(
    Array.isArray(payload.themes) && payload.themes.length === 0,
    `theme catalog API should return an empty theme list, got ${JSON.stringify(
      payload.themes,
    )}`,
  );
  assert(
    payload.issue === "Themes are not available right now.",
    `theme catalog API issue=${payload.issue}`,
  );
  assertCustomerThemeCatalogIssue(payload.issue);
  assert(
    fixtureServer.failedCatalogRequestCount > initialCatalogRequests,
    "failed theme catalog flow did not read the local catalog fixture",
  );
}

function assertCustomerApiMessage(message) {
  assert(
    typeof message === "string" && message.trim().length > 0,
    "release API must include a customer-safe message",
  );
  const forbidden = [
    "Companion",
    "latest release",
    "release check",
    "package asset",
    "customer installer",
    "not published",
  ];
  for (const text of forbidden) {
    assert(
      !message.includes(text),
      `release API message should not expose ${text}: ${message}`,
    );
  }
}

function assertCustomerFirmwareMessage(message) {
  assert(
    typeof message === "string" && message.trim().length > 0,
    "firmware API must include a customer-safe message",
  );
  const forbidden = [
    "release check",
    "firmware release",
    "manifest",
    "API",
    "HTTP",
    "board",
  ];
  for (const text of forbidden) {
    assert(
      !message.toLowerCase().includes(text.toLowerCase()),
      `firmware API message should not expose ${text}: ${message}`,
    );
  }
}

function assertCustomerThemeCatalogIssue(issue) {
  assert(
    typeof issue === "string" && issue.trim().length > 0,
    "theme catalog API must include a customer-safe issue",
  );
  const forbidden = [
    "Shopify",
    "Storefront",
    "API",
    "HTTP",
    "SHOPIFY_",
    "TOKEN",
    "configured",
    "configuration",
    "environment",
  ];
  for (const text of forbidden) {
    assert(
      !issue.includes(text),
      `theme catalog API issue should not expose ${text}: ${issue}`,
    );
  }
}

async function routeCompanionMissing(
  page,
  installRequests,
  onRequest = () => {},
) {
  const handler = async (route) => {
    const pathname = companionPath(route);
    onRequest(pathname);
    if (pathname.includes("/v1/themes/install")) {
      installRequests.push(route.request().postData());
    }
    await route.abort("failed");
  };
  await routeCompanionPaths(page, handler);
}

async function routeCompanionOnline(
  page,
  installRequests,
  onSettings = () => {},
  {
    companionFeatures = {
      themeInstallEnabled: true,
      macAppSelfUpdateEnabled: false,
    },
    companionVersion = "1.0.32",
    installationMode = "dmg",
    legacyCompanionRelease = false,
    device = companionDevice,
    onDiscover,
    onPair,
    onRepair,
    onSearch,
    onRequest = () => {},
    onReset,
    onUpdate,
    onMacAppUpdate,
    installStatusSequence,
    updateStatusSequence,
    macAppUpdateStatusSequence,
    macAppUpdateStatusFailures = 0,
    macAppUpdateReconnectVersion,
    dropBoardAfterFirmwareUpdate = false,
    usageResponse,
    usageStatus = 200,
    displayFrameStatus = 200,
    repairError = false,
    searchDevices,
    searchDelayMs = 0,
    firstStatusDelayMs = 0,
    statusDeviceSequence,
  } = {},
) {
  let currentDevice = device;
  let currentCompanionVersion = companionVersion;
  let activeInstallJobId = "";
  let installStatusIndex = 0;
  let activeUpdateJobId = "";
  let updateStatusIndex = 0;
  let activeMacAppUpdateJobId = "";
  let macAppUpdateStatusIndex = 0;
  let macAppUpdateStatusFailuresRemaining = macAppUpdateStatusFailures;
  let statusRequestCount = 0;
  const handler = async (route) => {
    const pathname = companionPath(route);
    onRequest(pathname, route.request().method());
    if (pathname === "/v1/mac-app/update/status") {
      if (macAppUpdateStatusFailuresRemaining > 0) {
        macAppUpdateStatusFailuresRemaining -= 1;
        if (macAppUpdateReconnectVersion) {
          currentCompanionVersion = macAppUpdateReconnectVersion;
        }
        await route.abort("failed");
        return;
      }
      const fallbackStatus = {
        phase: "complete",
        message: "Mac App updated.",
        progress: 100,
        logs: [
          "Preparing Mac App update.",
          "Downloading Mac App update.",
          "Installing Mac App.",
          "Restarting Mac App.",
          "Mac App updated.",
        ],
        result: { version: "1.0.99" },
      };
      const sequence =
        Array.isArray(macAppUpdateStatusSequence) &&
        macAppUpdateStatusSequence.length > 0
          ? macAppUpdateStatusSequence
          : [fallbackStatus];
      const nextStatus =
        sequence[Math.min(macAppUpdateStatusIndex, sequence.length - 1)] ||
        fallbackStatus;
      macAppUpdateStatusIndex += 1;
      if (nextStatus.phase === "complete" && nextStatus.result?.version) {
        currentCompanionVersion = nextStatus.result.version;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          job: {
            id: activeMacAppUpdateJobId || "mac-app-update-job-1",
            startedAt: "2026-06-23T12:00:00.000Z",
            ...nextStatus,
          },
        }),
      });
      return;
    }
    if (pathname === "/v1/mac-app/update") {
      const postData = route.request().postData() || "";
      onMacAppUpdate?.(postData);
      activeMacAppUpdateJobId = "mac-app-update-job-1";
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          job: {
            id: activeMacAppUpdateJobId,
            phase: "installing",
            message: "Preparing Mac App update.",
            progress: 5,
            startedAt: "2026-06-23T12:00:00.000Z",
            logs: ["Preparing Mac App update."],
          },
        }),
      });
      return;
    }
    if (pathname === "/v1/updates/install/status") {
      const fallbackStatus = {
        phase: "complete",
        message: "Update complete.",
        progress: 100,
        logs: [
          "Preparing VibeTV update.",
          "Checking VibeTV.",
          "Updating VibeTV.",
          "Update complete.",
        ],
        result: { firmware: "1.0.33" },
      };
      const sequence =
        Array.isArray(updateStatusSequence) && updateStatusSequence.length > 0
          ? updateStatusSequence
          : [fallbackStatus];
      const nextStatus =
        sequence[Math.min(updateStatusIndex, sequence.length - 1)] ||
        fallbackStatus;
      updateStatusIndex += 1;
      if (nextStatus.phase === "complete" && nextStatus.result?.firmware) {
        currentDevice = {
          ...currentDevice,
          firmware: nextStatus.result.firmware,
        };
        if (dropBoardAfterFirmwareUpdate) {
          currentDevice = { ...currentDevice, board: undefined };
        }
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          job: {
            id: activeUpdateJobId || "update-job-1",
            startedAt: "2026-06-23T12:00:00.000Z",
            ...nextStatus,
          },
        }),
      });
      return;
    }
    if (pathname === "/v1/updates/install") {
      const postData = route.request().postData() || "";
      onUpdate?.(postData, currentDevice);
      activeUpdateJobId = "update-job-1";
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          job: {
            id: activeUpdateJobId,
            phase: "installing",
            message: "Preparing VibeTV update.",
            progress: 5,
            startedAt: "2026-06-23T12:00:00.000Z",
            logs: ["Preparing VibeTV update."],
          },
        }),
      });
      return;
    }
    if (pathname === "/v1/themes/install/status") {
      const fallbackStatus = {
        phase: "error",
        message: "Theme install failed.",
        progress: 100,
        logs: [
          "Preparing theme files.",
          "Uploading theme files.",
          "Theme install failed.",
        ],
        error: {
          code: "theme_install_failed",
          message: "Theme install failed.",
          nextAction: "Keep VibeTV powered on and retry the install.",
        },
      };
      const sequence =
        Array.isArray(installStatusSequence) && installStatusSequence.length > 0
          ? installStatusSequence
          : [fallbackStatus];
      const nextStatus =
        sequence[Math.min(installStatusIndex, sequence.length - 1)] ||
        fallbackStatus;
      installStatusIndex += 1;
      if (nextStatus.phase === "complete" && nextStatus.result?.themeId) {
        currentDevice = {
          ...currentDevice,
          activeTheme: nextStatus.result.themeId,
        };
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          job: {
            id: activeInstallJobId || "install-job-1",
            startedAt: "2026-06-23T12:00:00.000Z",
            ...nextStatus,
          },
        }),
      });
      return;
    }
    if (pathname === "/v1/themes/install") {
      const postData = route.request().postData() || "";
      installRequests.push(postData);
      const parsed = parseJSON(postData);
      if (parsed?.async) {
        activeInstallJobId = "install-job-1";
        await route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            job: {
              id: activeInstallJobId,
              phase: "installing",
              message: "Preparing theme files.",
              progress: 10,
              startedAt: "2026-06-23T12:00:00.000Z",
              logs: ["Preparing theme files."],
            },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false }),
      });
      return;
    }
    if (pathname === "/v1/display-frame/latest") {
      if (displayFrameStatus !== 200) {
        await route.fulfill({
          status: displayFrameStatus,
          contentType: "application/json",
          body: JSON.stringify({ ok: false }),
        });
        return;
      }
      const frame = displayFrameFromUsageResponse(usageResponse);
      if (!frame) {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ ok: false }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          savedAt: usageResponse?.generatedAt || "2026-06-29T10:47:46Z",
          source: "last-good-frame",
          frame,
        }),
      });
      return;
    }
    if (pathname === "/v1/usage") {
      if (usageStatus !== 200) {
        await route.fulfill({
          status: usageStatus,
          contentType:
            typeof usageResponse === "string"
              ? "text/plain"
              : "application/json",
          body:
            typeof usageResponse === "string"
              ? usageResponse
              : JSON.stringify(usageResponse || { ok: false }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          usageResponse || {
            ok: true,
            generatedAt: "2026-06-29T10:47:46Z",
            source: "codexbar-display",
            usageMode: "used",
            currentProvider: "codex",
            providers: [
              {
                id: "codex",
                label: "Codex",
                source: "oauth",
                session: 12,
                weekly: 34,
                usageMode: "used",
              },
            ],
          },
        ),
      });
      return;
    }
    if (pathname === "/v1/device/pair") {
      const nextDevice = onPair?.(
        route.request().postData() || "",
        currentDevice,
      ) || { ...currentDevice, paired: true };
      currentDevice = nextDevice;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, device: currentDevice }),
      });
      return;
    }
    if (pathname === "/v1/device/search") {
      if (searchDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, searchDelayMs));
      }
      const devices =
        onSearch?.(currentDevice) ||
        searchDevices || [
          {
            target: currentDevice?.target || companionDevice.target,
            deviceId: currentDevice?.deviceId || "fixture-device-1",
            board: currentDevice?.board || companionDevice.board,
            firmware: currentDevice?.firmware || companionDevice.firmware,
            networkMode: "station",
            known: Boolean(currentDevice?.target),
          },
        ];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, devices }),
      });
      return;
    }
    if (pathname === "/v1/device/repair") {
      if (repairError) {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({
            ok: false,
            error: {
              code: "device_not_found",
              message: "No VibeTV device was found.",
              nextAction:
                "Make sure VibeTV is powered on and run Fix connection again.",
            },
          }),
        });
        return;
      }
      const postData = route.request().postData() || "";
      const parsed = parseJSON(postData);
      let nextDevice =
        onRepair?.(postData, currentDevice) ||
        (parsed?.forcePair || !currentDevice?.paired
          ? onPair?.(postData, currentDevice) || {
              ...currentDevice,
              paired: true,
            }
          : currentDevice);
      nextDevice = {
        ...nextDevice,
        connected: true,
        paired: Boolean(nextDevice.paired),
      };
      currentDevice = nextDevice;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, device: currentDevice }),
      });
      return;
    }
    if (pathname === "/v1/setup/reset") {
      onReset?.(route.request().postData() || "", currentDevice);
      currentDevice = { connected: false };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          companion: companionPayload(
            currentCompanionVersion,
            companionFeatures,
            legacyCompanionRelease,
            installationMode,
          ),
          device: currentDevice,
        }),
      });
      return;
    }
    if (pathname === "/v1/device/discover") {
      const nextDevice =
        onDiscover?.(route.request().postData() || "", currentDevice) ||
        currentDevice;
      currentDevice = nextDevice;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, device: nextDevice }),
      });
      return;
    }
    if (pathname === "/v1/status") {
      statusRequestCount += 1;
      if (Array.isArray(statusDeviceSequence) && statusDeviceSequence.length > 0) {
        currentDevice =
          statusDeviceSequence[
            Math.min(statusRequestCount - 1, statusDeviceSequence.length - 1)
          ];
      }
      if (statusRequestCount === 1 && firstStatusDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, firstStatusDelayMs));
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          companion: companionPayload(
            currentCompanionVersion,
            companionFeatures,
            legacyCompanionRelease,
            installationMode,
          ),
          device: currentDevice,
        }),
      });
      return;
    }
    if (pathname === "/v1/device") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, device: currentDevice }),
      });
      return;
    }
    if (pathname === "/v1/settings") {
      onSettings();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          settings: { display: { brightnessPercent: 50 } },
          device: currentDevice,
        }),
      });
      return;
    }
    if (pathname === "/v1/diagnostics") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          generatedAt: "2026-06-19T12:00:00.000Z",
          companion: companionPayload(
            currentCompanionVersion,
            companionFeatures,
            legacyCompanionRelease,
            installationMode,
          ),
          device: currentDevice,
          checks: [
            {
              name: "companion",
              status: "pass",
              detail: "Companion API target http://vibetv.local is reachable.",
              nextAction: "No action needed for COMPANION_UNREACHABLE.",
            },
            {
              name: "vibetv",
              status: "pass",
              detail: "VibeTV is connected.",
            },
          ],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ ok: false }),
    });
  };
  await routeCompanionPaths(page, handler);
}

async function routeCompanionPaths(page, handler) {
  await page.route("http://127.0.0.1:47832/v1/**", handler);
  await page.route("**/api/local-companion/v1/**", handler);
}

async function routeHostedAppThroughLocalNext(page, appUrl) {
  await page.addInitScript(() => {
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click() {
      if (this.href.startsWith("vibetv://")) {
        globalThis.__recordVibeTVNativeLaunch?.(this.href);
        return;
      }
      return originalClick.call(this);
    };
  });
  await page.route("https://app.vibetv.shop/**", async (route) => {
    const request = route.request();
    const sourceUrl = new URL(request.url());
    const targetUrl = `${appUrl}${sourceUrl.pathname}${sourceUrl.search}`;
    const response = await fetch(targetUrl, {
      method: request.method(),
      headers: request.headers(),
      body: request.method() === "GET" ? undefined : request.postDataBuffer(),
    });
    const headers = {};
    response.headers.forEach((value, key) => {
      if (
        !["content-encoding", "content-length", "transfer-encoding"].includes(
          key,
        )
      ) {
        headers[key] = value;
      }
    });
    await route.fulfill({
      status: response.status,
      headers,
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
}

function displayFrameFromUsageResponse(usageResponse) {
  const fallback = {
    ok: true,
    generatedAt: "2026-06-29T10:47:46Z",
    source: "codexbar-display",
    usageMode: "used",
    currentProvider: "codex",
    providers: [
      {
        id: "codex",
        label: "Codex",
        source: "oauth",
        session: 12,
        weekly: 34,
        usageMode: "used",
      },
    ],
  };
  const usage =
    usageResponse && typeof usageResponse === "object" ? usageResponse : fallback;
  const providers = Array.isArray(usage.providers) ? usage.providers : [];
  const provider =
    providers.find((entry) => entry?.id === usage.currentProvider) ||
    providers[0];
  if (!provider) {
    return null;
  }
  const usageMode =
    provider.usageMode === "remaining" || usage.usageMode === "remaining"
      ? "remaining"
      : "used";
  return {
    provider: provider.id,
    label: provider.label || provider.id,
    session: clampPercent(provider.session),
    weekly: clampPercent(provider.weekly),
    resetSecs: nonNegativeInteger(provider.resetSecs),
    usageMode,
    activity: provider.activity || "idle",
    sessionTokens: nonNegativeInteger(provider.sessionTokens),
    weekTokens: nonNegativeInteger(provider.weekTokens),
    totalTokens: nonNegativeInteger(provider.totalTokens),
  };
}

function clampPercent(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : 0;
}

function nonNegativeInteger(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined;
}

function parseJSON(raw) {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return null;
  }
}

function companionPath(route) {
  const pathname = new URL(route.request().url()).pathname;
  const proxyPrefix = "/api/local-companion/";
  if (pathname.startsWith(proxyPrefix)) {
    return `/${pathname.slice(proxyPrefix.length)}`;
  }
  return pathname;
}

function companionPayload(
  version,
  features,
  legacyRelease = false,
  installationMode = "dmg",
) {
  const payload = {
    version,
    features,
  };
  if (installationMode) {
    payload.installationMode = installationMode;
  }
  if (!legacyRelease) {
    payload.update = macAppReleaseInfo(version);
  }
  return payload;
}

function macAppReleaseInfo(installedVersion) {
  const latestVersion = "1.0.99";
  const updateAvailable = compareSemver(latestVersion, installedVersion) > 0;
  return {
    checkedAt: "2026-06-23T12:00:00.000Z",
    status: "available",
    release: `v${latestVersion}`,
    latestVersion,
    installedVersion,
    updateAvailable,
    message: updateAvailable
      ? "Mac App update is available."
      : "Mac App is up to date.",
  };
}

function compareSemver(left, right) {
  const leftParts = parseSemver(left);
  const rightParts = parseSemver(right);
  for (let index = 0; index < 3; index += 1) {
    const diff = leftParts[index] - rightParts[index];
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function parseSemver(version) {
  const match = String(version || "")
    .trim()
    .replace(/^v/i, "")
    .match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return [0, 0, 0];
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

async function startFixtureServer() {
  let catalogRequestCount = 0;
  let failedCatalogRequestCount = 0;
  let releaseRequestCount = 0;
  let scriptOnlyReleaseRequestCount = 0;
  let missingAssetReleaseRequestCount = 0;
  let failedReleaseRequestCount = 0;
  const server = createServer((request, response) => {
    if (request.url === "/theme-packs.json") {
      catalogRequestCount += 1;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(catalogFixture));
      return;
    }
    if (request.url === "/theme-packs-failed.json") {
      failedCatalogRequestCount += 1;
      response.writeHead(503, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ message: "theme catalog unavailable" }));
      return;
    }
    if (request.url === "/firmware-manifest.json") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          release: "v1.0.99",
          artifacts: [
            {
              board: companionDevice.board,
              firmwareVersion: "1.0.33",
              message: "Firmware update available.",
            },
          ],
        }),
      );
      return;
    }
    if (request.url === "/firmware-manifest-failed.json") {
      response.writeHead(503, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ message: "firmware unavailable" }));
      return;
    }
    if (request.url === "/github-release-complete.json") {
      releaseRequestCount += 1;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(releaseFixture));
      return;
    }
    if (request.url === "/github-release-script-only.json") {
      scriptOnlyReleaseRequestCount += 1;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(scriptOnlyReleaseFixture));
      return;
    }
    if (request.url === "/github-release-missing-assets.json") {
      missingAssetReleaseRequestCount += 1;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(missingAssetReleaseFixture));
      return;
    }
    if (request.url === "/github-release-failed.json") {
      failedReleaseRequestCount += 1;
      response.writeHead(503, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ message: "release unavailable" }));
      return;
    }
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("not found");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return {
    port: address.port,
    get catalogRequestCount() {
      return catalogRequestCount;
    },
    get failedCatalogRequestCount() {
      return failedCatalogRequestCount;
    },
    get releaseRequestCount() {
      return releaseRequestCount;
    },
    get scriptOnlyReleaseRequestCount() {
      return scriptOnlyReleaseRequestCount;
    },
    get missingAssetReleaseRequestCount() {
      return missingAssetReleaseRequestCount;
    },
    get failedReleaseRequestCount() {
      return failedReleaseRequestCount;
    },
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function startNext({
  appPort,
  catalogUrl,
  dmgDownloadEnabled,
  firmwareUrl,
  previewDmgUrl,
  previewVersion,
  releaseUrl,
  vercelEnv,
}) {
  const child = spawn(
    process.execPath,
    [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(appPort)],
    {
      cwd: root,
      env: testEnv(
        catalogUrl,
        firmwareUrl,
        releaseUrl,
        dmgDownloadEnabled,
        previewDmgUrl,
        previewVersion,
        vercelEnv,
      ),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));

  return { process: child };
}

async function runNextBuild({ catalogUrl, firmwareUrl, releaseUrl }) {
  await runCommand(process.execPath, [nextBin, "build"], {
    cwd: root,
    env: testEnv(catalogUrl, firmwareUrl, releaseUrl, true),
  });
}

async function runCommand(command, args, options) {
  const child = spawn(command, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  const [code, signal] = await once(child, "exit");
  if (code !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with ${
        signal ? `signal ${signal}` : `exit code ${code}`
      }`,
    );
  }
}

function testEnv(
  catalogUrl,
  firmwareUrl,
  releaseUrl,
  dmgDownloadEnabled = true,
  previewDmgUrl = "",
  previewVersion = "",
  vercelEnv = "",
) {
  const resolvedFirmwareUrl =
    firmwareUrl || catalogUrl.replace(/\/[^/]+$/, "/firmware-manifest.json");
  return {
    ...process.env,
    CONTROL_CENTER_ALLOW_CATALOG_FALLBACK: "1",
    CONTROL_CENTER_COMPANION_RELEASE_API_URL: releaseUrl,
    CONTROL_CENTER_ENABLE_MAC_APP_DMG_DOWNLOAD: dmgDownloadEnabled ? "1" : "0",
    CONTROL_CENTER_FIRMWARE_MANIFEST_URL: resolvedFirmwareUrl,
    CONTROL_CENTER_GITHUB_TOKEN: "",
    CONTROL_CENTER_PREVIEW_MAC_APP_DMG_URL: previewDmgUrl,
    CONTROL_CENTER_PREVIEW_MAC_APP_VERSION: previewVersion,
    GITHUB_TOKEN: "",
    SHOPIFY_STORE_DOMAIN: "",
    SHOPIFY_SHOP_DOMAIN: "",
    SHOPIFY_STOREFRONT_ACCESS_TOKEN: "",
    SHOPIFY_STOREFRONT_PRIVATE_TOKEN: "",
    CONTROL_CENTER_DISPLAY_STATE_DIR: displayStateDir,
    THEME_PACK_CATALOG_URL: catalogUrl,
    VERCEL_ENV: vercelEnv,
  };
}

async function findFreePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

async function waitForHttp(url) {
  const deadline = Date.now() + 20_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Next app did not become ready: ${lastError?.message}`);
}

async function stopProcess(child) {
  if (!child || child.killed || child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
  }
}

function assertNoInstallRequests(installRequests) {
  assert(
    installRequests.length === 0,
    `customer readiness flow triggered install request: ${JSON.stringify(
      installRequests,
    )}`,
  );
}

function assetName(raw) {
  if (!raw) {
    return "";
  }
  return new URL(raw).pathname.split("/").pop() || "";
}

async function assertNoMobileOverflow(page) {
  const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
  const viewportWidth = page.viewportSize().width;
  assert(
    bodyWidth <= viewportWidth + 1,
    `mobile overflow: body=${bodyWidth}, viewport=${viewportWidth}`,
  );
}

async function startVerifiedDmgSetupDownload(
  page,
  { startDownload = true } = {},
) {
  const dmgDownload = page.getByRole("link", { name: "Download Mac App" });
  await dmgDownload.waitFor({ timeout: 10_000 });
  assert(
    assetName(await dmgDownload.getAttribute("href")) ===
      "VibeTV-Control-Center.dmg",
    "Setup should only expose the verified DMG asset",
  );
  assert(
    (await page.getByRole("tab", { name: "Agentic setup" }).count()) === 0,
    "Verified DMG setup must hide the Agentic Terminal installer",
  );
  assert(
    (await page.getByRole("tab", { name: "Manual setup" }).count()) === 0,
    "Verified DMG setup must hide the manual Terminal installer",
  );
  assert(
    (await page.getByRole("button", { name: "Copy terminal command" }).count()) ===
      0,
    "Verified DMG setup must not expose the Terminal install command",
  );
  assert(
    (await page.locator("code").count()) === 0,
    "Verified DMG setup must not render a hidden Terminal install command",
  );

  if (startDownload) {
    await dmgDownload.evaluate((element) => {
      element.addEventListener(
        "click",
        (event) => event.preventDefault(),
        { once: true },
      );
      element.click();
    });
    await page.waitForTimeout(0);
  }

  return dmgDownload;
}

async function assertThemeLibraryLockedBehindSetup(page) {
  const themeLibraryButton = page.getByRole("button", {
    name: "Theme Library",
  });
  const settingsButton = page.getByRole("button", {
    name: "Settings",
  });
  const updatesButton = page.getByRole("button", {
    name: "Updates",
  });
  await settingsButton.waitFor({ timeout: 10_000 });
  await themeLibraryButton.waitFor({ timeout: 10_000 });
  await updatesButton.waitFor({ timeout: 10_000 });
  assert(
    await settingsButton.isDisabled(),
    "Settings tab should stay disabled until setup is complete",
  );
  assert(
    await themeLibraryButton.isDisabled(),
    "Theme Library tab should stay disabled until setup can install themes",
  );
  assert(
    await updatesButton.isDisabled(),
    "Updates tab should stay disabled until setup is complete",
  );
  assert(
    (await page.getByRole("heading", { name: "Choose a theme" }).count()) === 0,
    "locked Theme Library tab should not show the theme chooser",
  );
  assert(
    (await page.getByText("Fixture Synthwave Theme").count()) === 0,
    "locked Theme Library tab should not show theme rows",
  );
  assert(
    (await page.getByText("Selected in this app").count()) === 0,
    "locked Theme Library tab should not show selected theme state",
  );
  assert(
    (await page.getByText("Theme browsing works here").count()) === 0,
    "locked Theme Library tab should not show setup helper copy",
  );
}

async function assertSelectedThemeRow(page, themeTitle) {
  const row = page.locator("li").filter({ hasText: themeTitle });
  await row.waitFor({ timeout: 10_000 });
  const background = await row.evaluate(
    (element) => window.getComputedStyle(element).backgroundColor,
  );
  assert(
    background === "rgb(238, 238, 238)",
    `${themeTitle} should be the selected theme row`,
  );
}

async function assertThemeRowNotSelected(page, themeTitle) {
  const row = page.locator("li").filter({ hasText: themeTitle });
  await row.waitFor({ timeout: 10_000 });
  const background = await row.evaluate(
    (element) => window.getComputedStyle(element).backgroundColor,
  );
  assert(
    background !== "rgb(238, 238, 238)",
    `${themeTitle} should not be the selected theme row`,
  );
}

async function assertNoSetupJargon(page) {
  const hiddenSetupText = [
    "Check Companion",
    "Check bridge",
    "Check installer",
    "Checking installer",
    "Mac installer",
    "Installer is not ready yet",
    "Install the Mac App on this computer",
    "This page keeps checking",
    "Bridge",
    "127.0.0.1",
    "local Companion API",
    "release gate",
    "write",
    "Last events",
    "Installer unavailable",
    "Mac package pending",
    "Needs Companion",
    "Protected",
  ];

  for (const text of hiddenSetupText) {
    assert(
      (await page.getByText(text).count()) === 0,
      `setup should not show internal text: ${text}`,
    );
  }
}

async function assertNoLegacyCompanionDownloadActions(page) {
  const legacyActions = [
    "Install Apple silicon",
    "Install Intel Mac",
    "Support install script",
    "Mac package pending",
    "Check failed",
  ];

  for (const label of legacyActions) {
    const role =
      label === "Mac package pending" || label === "Check failed"
        ? "button"
        : "link";
    assert(
      (await page.getByRole(role, { name: label }).count()) === 0,
      `Theme Library should not show legacy Companion action: ${label}`,
    );
  }
}

async function assertNoDmgDownloadActions(page) {
  assert(
    (await page.getByRole("link", { name: "Download Mac App" }).count()) === 0,
    "Setup must not show a DMG link without an enabled, verified asset",
  );
  assert(
    (await page.getByRole("link", { name: "Download new Mac App" }).count()) ===
      0,
    "Updates must not show a DMG link without an enabled, verified asset",
  );
  assert(
    (await page.getByRole("link", { name: "Download new Mac App" }).count()) ===
      0,
    "Legacy migration must not show a DMG link without an enabled, verified asset",
  );
}

async function assertNoThemeLibraryReleaseDiagnostics(page) {
  const diagnostics = [
    "Companion installer is not published",
    "Customers cannot install Companion",
    "Companion release check failed. Check your connection",
  ];

  for (const text of diagnostics) {
    assert(
      (await page.getByText(text).count()) === 0,
      `Theme Library should not show release diagnostic: ${text}`,
    );
  }
}

async function waitForCondition(predicate, message, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

async function assertCompanionRequestTimeoutContract() {
  const source = await readFile(
    join(root, "src/components/control-center-app.tsx"),
    "utf8",
  );
  assert(
    source.includes("const COMPANION_REQUEST_TIMEOUT_MS = 45_000;"),
    "Ordinary Mac App requests must keep the 45 second timeout",
  );
  assert(
    source.includes("const COMPANION_REPAIR_REQUEST_TIMEOUT_MS = 90_000;"),
    "Device repair requests must allow up to 90 seconds",
  );
  assert(
    source.includes("options?.timeoutMs ?? COMPANION_REQUEST_TIMEOUT_MS"),
    "Mac App requests must use an explicit timeout override when provided",
  );
  const repairTimeoutUses =
    source.match(/timeoutMs: COMPANION_REPAIR_REQUEST_TIMEOUT_MS/g) || [];
  assert(
    repairTimeoutUses.length === 2,
    `Exactly repair and reload-display must use the 90 second timeout, got ${repairTimeoutUses.length} uses`,
  );
}

async function captureMigrationScreenshot(page, name) {
  if (!migrationScreenshotDir) {
    return;
  }
  await mkdir(migrationScreenshotDir, { recursive: true });
  await page.screenshot({
    fullPage: true,
    path: join(migrationScreenshotDir, name),
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
