import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
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
const themeStudioViewport = { width: 1180, height: 820 };
const smokeOnly = process.argv.includes("--smoke");
const migrationScreenshotDir =
  process.env.CONTROL_CENTER_CAPTURE_MIGRATION_SCREENSHOTS?.trim() || "";
const themeStudioSafetyOnly = process.argv.includes("--theme-studio-safety");
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
  target: "http://192.168.178.163",
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

const reconnectingDevice = {
  ...companionDevice,
  connected: false,
  ready: false,
  connectionState: "reconnecting",
  lastSeenAt: "2026-07-15T10:00:00Z",
  stream: {
    healthy: false,
    running: true,
    detail: "Display stream is reconnecting.",
  },
};

function readyProviderSetup() {
  return {
    status: "ready",
    checkedAt: "2026-07-17T17:00:00Z",
    engine: {
      status: "ready",
      version: "0.44.0",
      path: "/Users/customer/Applications/CodexBar.app",
      source: "bundled",
      configWritable: true,
    },
    providers: [
      {
        id: "codex",
        label: "Codex",
        enabled: true,
        status: "ready",
      },
    ],
  };
}

async function main() {
  await assertCompanionRequestTimeoutContract();
  await assertLocalCompanionProxySafetyContract();
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
    await testStartupStateMachine(browser, appContext.appUrl);
    if (themeStudioSafetyOnly) {
      await testThemeStudioUsesLocalRenderAndCompanionInstall(
        browser,
        appContext.appUrl,
      );
      await testAIThemeBuilderCandidateFlow(browser, appContext.appUrl);
      console.log("control-center Theme Studio safety test passed");
      return;
    }
    if (smokeOnly) {
      await testHostedEntryShowsMacAppDownload(browser, appContext.appUrl, {
        expectDmg: false,
      });
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
      await testLocalFreshAppSearchesBeforeWifiSetup(
        browser,
        appContext.appUrl,
      );
      await testLocalReachableWithoutFrameOpensOverview(
        browser,
        appContext.appUrl,
      );
      await testConfiguredDeviceShowsReconnectingWithoutSetup(
        browser,
        appContext.appUrl,
      );
      await testRunningDeviceOutageKeepsControlCenterOpen(
        browser,
        appContext.appUrl,
      );
      await testRunningCompanionOutageBlocksControlCenter(
        browser,
        appContext.appUrl,
      );
      await testKnownDeviceCompanionOutageSurvivesReloadAndSecondWindow(
        browser,
        appContext.appUrl,
      );
      await testKnownDeviceCompanionRecoveryRehydratesStatusAndUsage(
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
    await testHostedEntryShowsMacAppDownload(browser, appContext.appUrl, {
      expectDmg: true,
    });
    await testHostedThemeEntryShowsMacAppDownload(browser, appContext.appUrl, {
      expectDmg: true,
    });
    await testHostedPriorVisitStillShowsMacAppDownload(
      browser,
      appContext.appUrl,
      { expectDmg: true },
    );
    await testLocalFreshAppSearchesBeforeWifiSetup(browser, appContext.appUrl);
    await testLocalWifiVerificationOpensOverview(browser, appContext.appUrl);
    await testLocalWifiVerificationFailureStaysInSetup(
      browser,
      appContext.appUrl,
    );
    await testLocalWifiVerificationWithoutFrameOpensOverview(
      browser,
      appContext.appUrl,
    );
    await testLocalWifiSetupRescansAfterNoResults(browser, appContext.appUrl);
    await testLocalWifiSearchHidesFallbackWhileSearching(
      browser,
      appContext.appUrl,
    );
    await testOfflineActiveDeviceOffersExplicitReplacement(
      browser,
      appContext.appUrl,
    );
    await testOfflineActiveDeviceReconnectsWithoutPrompt(
      browser,
      appContext.appUrl,
    );
    await testLegacyTargetDoesNotAutoconnectDiscoveredIdentity(
      browser,
      appContext.appUrl,
    );
    await testRunningPairingErrorRepairsAutomaticallyOnce(
      browser,
      appContext.appUrl,
    );
    await testFailedPairingErrorDoesNotLoop(browser, appContext.appUrl);
    await testLocalReachableWithoutFrameOpensOverview(
      browser,
      appContext.appUrl,
    );
    await testConfiguredDeviceShowsReconnectingWithoutSetup(
      browser,
      appContext.appUrl,
    );
    await testRunningDeviceOutageKeepsControlCenterOpen(
      browser,
      appContext.appUrl,
    );
    await testRunningCompanionOutageBlocksControlCenter(
      browser,
      appContext.appUrl,
    );
    await testKnownDeviceCompanionOutageSurvivesReloadAndSecondWindow(
      browser,
      appContext.appUrl,
    );
    await testKnownDeviceCompanionRecoveryRehydratesStatusAndUsage(
      browser,
      appContext.appUrl,
    );
    await testLocalOverviewRecoversWhenDeviceBecomesReady(
      browser,
      appContext.appUrl,
    );
    await testLocalExistingSetupOpensOverviewWithoutRepair(
      browser,
      appContext.appUrl,
    );
    await testInitialHealthyStatusRaceAvoidsRepair(browser, appContext.appUrl);
    await testDelayedSettingsDoesNotResetActiveTab(browser, appContext.appUrl);
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
    await testUsagePrioritizesProviderTokenHistory(browser, appContext.appUrl);
    await testUsageShowsMacAppUpdateForOldMacApp(browser, appContext.appUrl);
    await testRunSetupAgainReturnsToWifiOnboarding(browser, appContext.appUrl);
    await testSettingsStayCustomerOnly(browser, appContext.appUrl);
    await testUpdatesShowCustomerCompanionAction(browser, appContext.appUrl);
    await testNativeMacAppUpdateUsesSparkleAction(browser, appContext.appUrl);
    await testLegacyInstallMigratesToDmgAtSameVersion(
      browser,
      appContext.appUrl,
    );
    await testLegacyFeatureFallbackMigratesAtSameVersion(
      browser,
      appContext.appUrl,
    );
    await testDmgInstallStaysUpToDateAtSameVersion(browser, appContext.appUrl);
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
    await testOverviewRejectsInvalidDisplayFrame(browser, appContext.appUrl);
    await testProviderReadinessCustomerStates(browser, appContext.appUrl);
    await testOverviewKeepsTransientConnectionCustomerFriendly(
      browser,
      appContext.appUrl,
    );
    await testOverviewRendersThemeSpecAssetTypes(browser, appContext.appUrl);
    await testThemeLibraryRendersThemeSpecPreviews(browser, appContext.appUrl);
    await testReloadRestoresRunningFirmwareUpdate(browser, appContext.appUrl);
    await testReloadRestoresRunningThemeInstall(browser, appContext.appUrl);
    await testFirmwareUpdateShowsCustomerProgress(browser, appContext.appUrl);
    await testFirmwareAttentionDoesNotOfferSecondFlash(
      browser,
      appContext.appUrl,
    );
    await testFirmwarePowerCycleErrorDoesNotOfferSecondFlash(
      browser,
      appContext.appUrl,
    );
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

async function testStartupStateMachine(browser, appUrl) {
  await testFreshLaunchConnectsTheOnlyVibeTV(browser, appUrl);
  await testMultipleVibeTVsRequireAChoice(browser, appUrl);
  await testMissingVibeTVOffersRetry(browser, appUrl);
  await testDeniedLocalNetworkShowsRecovery(browser, appUrl);
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
  assert(
    (await page.evaluate(() =>
      window.localStorage.getItem("vibetv.controlCenter.deviceTarget"),
    )) === null,
    "A genuine fresh setup must not invent known-device context",
  );
  assertNoInstallRequests(installRequests);
  await page.close();
}

async function testLocalWifiVerificationOpensOverview(browser, appUrl) {
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
  await page.getByRole("heading", { name: "VibeTV is connected" }).waitFor({
    timeout: 10_000,
  });
  assert(
    repairRequests.length === 1,
    `A single discovered VibeTV should connect exactly once, got ${repairRequests.length}`,
  );
  const repairPayload = JSON.parse(repairRequests[0] || "{}");
  assert(
    repairPayload.forcePair == null || repairPayload.forcePair === false,
    `Onboarding must preserve a valid token instead of forcing rotation, got ${repairRequests[0]}`,
  );
  const overviewButton = await getNavigationButton(page, "Overview");
  assert(
    (await overviewButton.getAttribute("aria-current")) === "page",
    "Successful native verification should go directly to Overview",
  );
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testLocalWifiVerificationFailureStaysInSetup(browser, appUrl) {
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
  await page.getByRole("heading", { name: "VibeTV could not connect" }).waitFor({
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "Search again" }).waitFor({
    timeout: 10_000,
  });
  assert(
    repairRequests.length === 1,
    `Failed verification must not retry automatically, got ${repairRequests.length} attempts`,
  );
  assert(
    (await page.getByRole("navigation", { name: "Control Center" }).count()) ===
      0,
    "Control Center must stay hidden after failed verification",
  );
  await assertNoDmgDownloadActions(page);
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testLocalWifiVerificationWithoutFrameOpensOverview(
  browser,
  appUrl,
) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  const repairRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    device: { connected: false, paired: false, ready: false },
    repairError: true,
    repairErrorDevice: {
      ...reachableUnreadyDevice,
      deviceId: "fixture-device-1",
    },
    onRequest: (pathname, method) => {
      if (method === "POST" && pathname === "/v1/device/repair") {
        repairRequests.push(pathname);
      }
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "VibeTV is connected" }).waitFor({
    timeout: 10_000,
  });
  await page.getByText("Waiting for first image", { exact: true }).waitFor({
    timeout: 10_000,
  });
  assert(
    (await page
      .getByRole("heading", { name: "VibeTV was not found" })
      .count()) === 0,
    "A paired VibeTV waiting for usage must not be reported as missing",
  );
  assert(
    (await page.getByRole("button", { name: "Search again" }).count()) === 0,
    "A paired VibeTV waiting for usage must keep polling instead of asking for another scan",
  );
  assert(
    repairRequests.length === 1,
    `A reachable VibeTV without a display frame must not retry automatically, got ${repairRequests.length} attempts`,
  );
  assert(
    (await page.getByTestId("device-startup-screen").count()) === 0,
    "A connected VibeTV should show the Control Center while the first display frame is pending",
  );
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testLocalWifiSetupRescansAfterNoResults(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  const repairRequests = [];
  let searchRequests = 0;
  await routeCompanionOnline(page, installRequests, () => {}, {
    device: { connected: false, paired: false },
    onSearch: () => {
      searchRequests += 1;
      return searchRequests === 1
        ? []
        : [
            {
              target: "http://192.168.178.88",
              deviceId: "device-88",
              networkMode: "station",
              known: false,
              active: false,
            },
          ];
    },
    onRepair: (postData) => {
      repairRequests.push(postData || "");
      return { ...companionDevice, target: "http://192.168.178.88" };
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Connect VibeTV to WiFi" }).waitFor();
  assert(
    (await page.getByLabel("VibeTV address").count()) === 0,
    "No-result setup must show the WiFi guide instead of a manual address",
  );
  assert(searchRequests === 1, "Fresh setup should search automatically once");
  await page.getByRole("button", { name: "VibeTV is on WiFi" }).click();
  await page.getByRole("heading", { name: "Looking for your VibeTV" }).waitFor({
    timeout: 10_000,
  });
  await page.getByRole("heading", { name: "VibeTV is connected" }).waitFor({
    timeout: 10_000,
  });
  assert(searchRequests === 2, "WiFi confirmation should start a fresh scan");
  assert(
    repairRequests.length === 1,
    "The discovered VibeTV should connect once",
  );
  assert(
    JSON.parse(repairRequests[0]).target === "http://192.168.178.88",
    `The discovered target should stay pinned, got ${repairRequests[0]}`,
  );
  assertNoInstallRequests(installRequests);
  await page.close();
}

async function testFreshLaunchConnectsTheOnlyVibeTV(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, {
    viewport: desktopViewport,
  });
  const requests = [];
  await routeCompanionOnline(page, [], () => {}, {
    device: { connected: false, paired: false },
    searchDevices: [
      {
        target: companionDevice.target,
        deviceId: "customer-device",
        board: companionDevice.board,
        firmware: companionDevice.firmware,
        networkMode: "station",
        known: false,
        active: false,
      },
    ],
    onRepair: () => ({ ...companionDevice, deviceId: "customer-device" }),
    onRequest: (pathname, method) => requests.push(`${method} ${pathname}`),
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("navigation", { name: "Control Center" }).waitFor({
    timeout: 15_000,
  });
  assert(
    requests.filter((request) => request === "POST /v1/device/search")
      .length === 1,
    `A fresh launch must run one automatic search, got ${JSON.stringify(requests)}`,
  );
  assert(
    (await page.getByRole("button", { name: "Setup", exact: true }).count()) ===
      0,
    "The connected Control Center must not show a second Setup tab",
  );
  assert(
    (await page.getByTestId("provider-startup-screen").count()) === 0,
    "Provider readiness must not add another startup flow",
  );
  await page.close();
}

async function testMultipleVibeTVsRequireAChoice(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, {
    viewport: desktopViewport,
  });
  await routeCompanionOnline(page, [], () => {}, {
    device: { connected: false, paired: false },
    searchDevices: [
      {
        target: "http://192.0.2.10",
        deviceId: "vibetv-a",
        board: companionDevice.board,
        firmware: companionDevice.firmware,
        networkMode: "station",
        known: true,
        active: false,
      },
      {
        target: "http://192.0.2.11",
        deviceId: "vibetv-b",
        board: companionDevice.board,
        firmware: companionDevice.firmware,
        networkMode: "station",
        known: true,
        active: false,
      },
    ],
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Choose a VibeTV" }).waitFor({
    timeout: 10_000,
  });
  assert(
    (await page
      .getByRole("button", { name: "Connect this VibeTV" })
      .count()) === 2,
    "Every discovered VibeTV must be selectable",
  );
  assert(
    (await page.getByRole("button", { name: "Not now" }).count()) === 0,
    "Device setup must not be bypassed",
  );
  await page.close();
}

async function testMissingVibeTVOffersRetry(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, {
    viewport: desktopViewport,
  });
  await routeCompanionOnline(page, [], () => {}, {
    device: { connected: false, paired: false },
    searchDevices: [],
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Connect VibeTV to WiFi" }).waitFor({
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "VibeTV is on WiFi" }).waitFor({
    timeout: 10_000,
  });
  assert(
    (await page.getByRole("button", { name: "Not now" }).count()) === 0,
    "The not-found screen must only offer another search",
  );
  await page.close();
}

async function testDeniedLocalNetworkShowsRecovery(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, {
    viewport: desktopViewport,
  });
  await routeCompanionOnline(page, [], () => {}, {
    device: { connected: false, paired: false },
    searchError: {
      code: "local_network_access_denied",
      message: "Local Network access is off for VibeTV Control Center.",
      nextAction:
        "Open System Settings > Privacy & Security > Local Network, allow VibeTV Control Center, then try again.",
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page
    .getByText("Local Network access is off for VibeTV Control Center.", {
      exact: true,
    })
    .waitFor({ timeout: 10_000 });
  await page
    .getByText(
      "Open System Settings > Privacy & Security > Local Network, allow VibeTV Control Center, then try again.",
      { exact: true },
    )
    .waitFor({ timeout: 10_000 });
  await page.close();
}

async function testProviderReadinessCustomerStates(browser, appUrl) {
  const cases = [
    {
      status: "auth_required",
      expected: "Sign in to Claude in CodexBar, then check again.",
    },
    {
      status: "permission_required",
      expected:
        "Claude needs permission to read your sign-in. Open CodexBar and allow access, then check again.",
    },
    {
      status: "no_usage_available",
      expected:
        "Claude is connected, but this account does not expose usage limits. Choose another provider.",
    },
    {
      status: "config_error",
      expected:
        "CodexBar could not save its provider settings. Open CodexBar and finish provider setup there.",
    },
    {
      status: "not_configured",
      expected: "No usable AI provider is configured yet.",
    },
  ];

  for (const fixture of cases) {
    const page = await newCustomerPage(browser, appUrl, { viewport });
    const requests = [];
    await routeCompanionOnline(page, [], () => {}, {
      device: reachableUnreadyDevice,
      onRequest: (path, method) => requests.push(`${method} ${path}`),
      providerSetup: providerSetupFixture(fixture.status),
    });

    await page.goto(appUrl, { waitUntil: "domcontentloaded" });
    await page
      .getByRole("heading", { name: "VibeTV is connected" })
      .waitFor({ timeout: 10_000 });
    await page
      .getByText("Waiting for first image", { exact: true })
      .waitFor({ timeout: 10_000 });
    await page
      .getByText("Start using any AI provider.", { exact: true })
      .waitFor({ timeout: 10_000 });
    assert(
      (await page.getByText("AI provider", { exact: true }).count()) === 0,
      "Overview must not guess or show an AI provider",
    );
    assert(
      (await page.getByText("Claude", { exact: true }).count()) === 0,
      "Overview must not present the first provider as the active provider",
    );
    assert(
      (await page
        .getByText("Waiting for the first accepted display frame.", {
          exact: true,
        })
        .count()) === 0,
      "Overview must not show technical stream details",
    );

    await clickNavigation(page, "Usage");
    await page
      .getByRole("heading", { name: "Connect an AI provider" })
      .first()
      .waitFor({ timeout: 10_000 });
    await page.getByText(fixture.expected).first().waitFor({ timeout: 10_000 });
    assert(
      (await page.getByText("VibeTV screen is not ready").count()) === 0,
      `${fixture.status} must not be presented as a VibeTV screen problem`,
    );
    assert(
      (await page.getByRole("button", { name: "Fix connection" }).count()) ===
        0,
      `${fixture.status} must not offer Fix connection`,
    );
    assert(
      (await page.getByRole("button", { name: "Repair CodexBar" }).count()) ===
        (fixture.status === "not_configured" ? 1 : 0),
      `${fixture.status} must expose CodexBar repair only when the engine is missing`,
    );

    if (fixture.status === "auth_required") {
      await page.getByRole("button", { name: "Open CodexBar" }).click();
      await page.getByRole("button", { name: "Check again" }).click();
      assert(
        requests.includes("POST /v1/providers/open-codexbar"),
        "Open CodexBar must call the provider action",
      );
      assert(
        requests.includes("POST /v1/providers/retry"),
        "Check again must retry provider detection",
      );

      await clickNavigation(page, "Overview");
      await page
        .getByRole("heading", { name: "VibeTV is connected" })
        .waitFor({ timeout: 10_000 });
      assert(
        (await page
          .getByRole("heading", { name: "Connect an AI provider" })
          .count()) === 0,
        "Provider setup belongs on Usage, not Overview",
      );

      await clickNavigation(page, "Usage");
      await page
        .getByRole("heading", { name: "Connect an AI provider" })
        .first()
        .waitFor({ timeout: 10_000 });
      assert(
        (await page
          .getByText("No provider usage is available yet.")
          .count()) === 0,
        "Provider setup must replace the generic empty usage state",
      );
    }

    await assertNoMobileOverflow(page);
    await page.close();
  }

  const readyPage = await newCustomerPage(browser, appUrl, { viewport });
  await routeCompanionOnline(readyPage, [], () => {}, {
    device: companionDevice,
    providerSetup: readyProviderSetup(),
  });
  await readyPage.goto(appUrl, { waitUntil: "domcontentloaded" });
  await readyPage
    .getByRole("heading", { name: "VibeTV is connected" })
    .waitFor({ timeout: 10_000 });
  assert(
    (await readyPage
      .getByRole("heading", { name: "Connect an AI provider" })
      .count()) === 0,
    "Ready providers must not show provider setup",
  );
  assert(
    (await readyPage.getByText("AI provider", { exact: true }).count()) === 0,
    "Overview must not show a provider row even when providers are ready",
  );
  await readyPage.close();
}

async function testOverviewKeepsTransientConnectionCustomerFriendly(
  browser,
  appUrl,
) {
  const page = await newCustomerPage(browser, appUrl, {
    viewport: desktopViewport,
  });
  const technicalStreamDetail =
    "Display stream could not find VibeTV and is reconnecting.";
  await routeCompanionOnline(page, [], () => {}, {
    device: {
      ...reachableUnreadyDevice,
      deviceId: "vibetv-customer",
      connectionState: "reconnecting",
      stream: {
        healthy: false,
        running: true,
        detail: technicalStreamDetail,
      },
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("heading", { name: "VibeTV is connected" })
    .waitFor({ timeout: 10_000 });
  await page
    .getByText("VibeTV connected", { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByText("Waiting for first image", { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByText("Start using any AI provider.", { exact: true })
    .waitFor({ timeout: 10_000 });
  assert(
    (await page.getByText("VibeTV unavailable", { exact: true }).count()) === 0,
    "A connected VibeTV must not be labelled unavailable during first-frame startup",
  );
  assert(
    (await page.getByText(technicalStreamDetail, { exact: true }).count()) ===
      0,
    "Overview must keep reconnect details in Support",
  );

  await assertNoMobileOverflow(page);
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
  await page.getByRole("heading", { name: "Looking for your VibeTV" }).waitFor({
    timeout: 10_000,
  });
  assert(
    (await page.getByLabel("VibeTV address").count()) === 0,
    "Manual address must stay hidden while search is running",
  );
  assert(
    (await page.getByRole("button", { name: "VibeTV is on WiFi" }).count()) ===
      0,
    "Search must not show a second WiFi search button",
  );
  await page.getByRole("button", { name: "VibeTV is on WiFi" }).waitFor({
    timeout: 10_000,
  });
  await page.getByText("Plug VibeTV into power.").waitFor();
  await page.getByText("Wait until VibeTV shows VibeTV-Setup.").waitFor();
  await page.getByText("192.168.4.1").waitFor();
  assert(
    (await page.getByRole("navigation", { name: "Control Center" }).count()) ===
      0,
    "The WiFi guide must stay inside the full-screen startup experience",
  );
  assertNoInstallRequests(installRequests);
  await page.close();
}

async function testOfflineActiveDeviceOffersExplicitReplacement(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  const deviceWriteRequests = [];
  const selectRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    device: {
      target: "http://192.168.178.70",
      deviceId: "device-70",
      connected: false,
      paired: true,
      ready: false,
    },
    searchDevices: [
      {
        target: "http://192.168.178.82",
        deviceId: "device-82",
        firmware: "1.0.36",
        networkMode: "station",
        known: true,
        active: true,
      },
    ],
    onSelect: (postData) => {
      selectRequests.push(postData || "");
      return {
        ...companionDevice,
        target: "http://192.168.178.82",
        deviceId: "device-82",
      };
    },
    onRequest: (pathname, method) => {
      if (
        method === "POST" &&
        (pathname === "/v1/device/select" || pathname === "/v1/device/repair")
      ) {
        deviceWriteRequests.push(pathname);
      }
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Another VibeTV was found" }).waitFor({
    timeout: 10_000,
  });
  assert(
    (await page.getByRole("navigation", { name: "Control Center" }).count()) ===
      0,
    "Cold-start reconnect must run before the Control Center shell",
  );
  assert(
    (await page
      .getByRole("heading", { name: "Set up your VibeTV" })
      .count()) === 0,
    "Cold-start reconnect must not appear inside Setup",
  );
  assert(
    (await page.getByText("VibeTV device-82", { exact: true }).count()) === 1,
    "The replacement VibeTV must be shown before selection",
  );
  assert(
    deviceWriteRequests.length === 0,
    `Automatic search must remain read-only, got ${deviceWriteRequests}`,
  );
  await page.getByRole("button", { name: "Connect this VibeTV" }).click();
  await page.getByRole("heading", { name: "VibeTV is connected" }).waitFor({
    timeout: 10_000,
  });
  assert(
    deviceWriteRequests.length === 1 &&
      deviceWriteRequests[0] === "/v1/device/select",
    `Explicit selection must make one select write, got ${deviceWriteRequests}`,
  );
  assert(
    selectRequests.length === 1 &&
      JSON.parse(selectRequests[0] || "{}").expectedDeviceId === "device-82",
    `Explicit selection must pin the replacement identity, got ${selectRequests}`,
  );
  assertNoInstallRequests(installRequests);
  await page.close();
}

async function testOfflineActiveDeviceReconnectsWithoutPrompt(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  const repairRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    device: {
      target: "http://192.168.178.70",
      deviceId: "known-82",
      connected: false,
      paired: true,
      ready: false,
    },
    searchDevices: [
      {
        target: "http://192.168.178.81",
        deviceId: "unknown-81",
        networkMode: "station",
        known: false,
        active: false,
      },
      {
        target: "http://192.168.178.82",
        deviceId: "known-82",
        networkMode: "station",
        known: true,
        active: true,
      },
    ],
    onRepair: (postData) => {
      repairRequests.push(postData || "");
      return { ...companionDevice, target: "http://192.168.178.82" };
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "VibeTV is connected" }).waitFor({
    timeout: 10_000,
  });
  assert(
    repairRequests.length === 1,
    "The active VibeTV should reconnect once",
  );
  const request = JSON.parse(repairRequests[0] || "{}");
  assert(
    request.target === "http://192.168.178.82",
    "Active target should win",
  );
  assert(
    request.expectedDeviceId === "known-82",
    "Active identity must stay pinned",
  );
  assertNoInstallRequests(installRequests);
  await page.close();
}

async function testLegacyTargetDoesNotAutoconnectDiscoveredIdentity(
  browser,
  appUrl,
) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  const repairRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    device: {
      target: "http://192.168.178.70",
      connected: false,
      paired: true,
      ready: false,
    },
    searchDevices: [
      {
        target: "http://192.168.178.70",
        deviceId: "migrated-device-70",
        networkMode: "station",
        known: false,
        active: false,
      },
    ],
    onRepair: (postData) => {
      repairRequests.push(postData || "");
      return {
        ...companionDevice,
        target: "http://192.168.178.70",
        deviceId: "migrated-device-70",
      };
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Another VibeTV was found" }).waitFor({
    timeout: 10_000,
  });
  assert(
    repairRequests.length === 0,
    "A legacy target must not automatically adopt a newly discovered identity",
  );
  assertNoInstallRequests(installRequests);
  await page.close();
}

async function testRunningCompanionOutageBlocksControlCenter(
  browser,
  appUrl,
) {
  const page = await newCustomerPage(browser, appUrl, {
    viewport: desktopViewport,
  });
  const installRequests = [];
  let settingsResponses = 0;
  await routeCompanionOnline(page, installRequests, () => {}, {
    device: {
      ...companionDevice,
      connectionState: "ready",
      deviceId: "known-device-1",
    },
    settingsDelayMs: 7_000,
    onSettingsResponse: () => {
      settingsResponses += 1;
    },
    statusFailuresAfter: 1,
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Overview", exact: true }).waitFor({
    timeout: 10_000,
  });
  await page
    .getByRole("heading", { name: "VibeTV Control Center needs attention" })
    .waitFor({
      timeout: 12_000,
    });
  assert(
    (await page.getByRole("navigation", { name: "Control Center" }).count()) ===
      0,
    "A running session must block Control Center navigation when the background service stops answering",
  );
  assert(
    (await page.getByTestId("device-startup-screen").count()) === 0,
    "A background service outage must not return a running session to VibeTV startup",
  );
  await waitForCondition(
    () => settingsResponses > 0,
    "The delayed settings response should arrive after the outage",
  );
  await page.waitForTimeout(250);
  assert(
    (await page.getByTestId("mac-app-recovery-screen").count()) === 1,
    "A stale settings response must not dismiss background service recovery",
  );
  assertNoInstallRequests(installRequests);
  await page.close();
}

async function testKnownDeviceCompanionOutageSurvivesReloadAndSecondWindow(
  browser,
  appUrl,
) {
  const context = await browser.newContext({ viewport: desktopViewport });
  await context.grantPermissions(["local-network-access"], { origin: appUrl });
  const firstPage = await context.newPage();
  const installRequests = [];
  const knownDevice = {
    ...companionDevice,
    connectionState: "ready",
    deviceId: "known-reload-device",
  };
  await routeCompanionOnline(firstPage, installRequests, () => {}, {
    device: knownDevice,
  });

  await firstPage.goto(appUrl, { waitUntil: "domcontentloaded" });
  await firstPage
    .getByRole("heading", { name: "VibeTV is connected" })
    .waitFor({ timeout: 10_000 });
  await firstPage.unrouteAll({ behavior: "ignoreErrors" });
  await routeCompanionMissing(firstPage, installRequests);
  await firstPage.reload({ waitUntil: "domcontentloaded" });
  await assertKnownDeviceMacAppOutage(firstPage);

  const secondPage = await context.newPage();
  await routeCompanionMissing(secondPage, installRequests);
  await secondPage.goto(appUrl, { waitUntil: "domcontentloaded" });
  await assertKnownDeviceMacAppOutage(secondPage);

  assertNoInstallRequests(installRequests);
  await context.close();
}

async function testKnownDeviceCompanionRecoveryRehydratesStatusAndUsage(
  browser,
  appUrl,
) {
  const page = await newCustomerPage(browser, appUrl, {
    viewport: desktopViewport,
  });
  const installRequests = [];
  const deviceWriteRequests = [];
  const knownDevice = {
    ...companionDevice,
    connectionState: "ready",
    deviceId: "known-recovery-device",
  };
  await routeCompanionOnline(page, installRequests, () => {}, {
    device: knownDevice,
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("heading", { name: "VibeTV is connected" })
    .waitFor({ timeout: 10_000 });
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await routeCompanionMissing(page, installRequests);
  await page.reload({ waitUntil: "domcontentloaded" });
  await assertKnownDeviceMacAppOutage(page);

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await routeCompanionOnline(page, installRequests, () => {}, {
    device: knownDevice,
    onRequest: (pathname, method) => {
      if (method === "POST" && pathname.startsWith("/v1/device/")) {
        deviceWriteRequests.push(pathname);
      }
    },
  });
  await page
    .getByRole("button", { name: "Try automatic repair again" })
    .click();
  await page
    .getByRole("heading", { name: "VibeTV is connected" })
    .waitFor({ timeout: 10_000 });
  await clickNavigation(page, "Usage");
  await page.getByRole("heading", { name: "Usage", exact: true }).waitFor();
  await page.getByText("Codex", { exact: true }).first().waitFor();
  assert(
    (await page.evaluate(() =>
      window.localStorage.getItem("vibetv.controlCenter.deviceTarget"),
    )) === knownDevice.target,
    "Companion recovery must keep the saved VibeTV target",
  );
  assert(
    deviceWriteRequests.length === 0,
    `Companion recovery should rehydrate from status without device writes, got ${deviceWriteRequests}`,
  );
  assertNoInstallRequests(installRequests);
  await page.close();
}

async function assertKnownDeviceMacAppOutage(page) {
  await page
    .getByRole("heading", { name: "VibeTV Control Center needs attention" })
    .waitFor({ timeout: 10_000 });
  await page
    .getByRole("button", { name: "Restart Control Center" })
    .waitFor();
  await page
    .getByRole("button", { name: "Try automatic repair again" })
    .waitFor();
  assert(
    (await page.getByRole("navigation", { name: "Control Center" }).count()) ===
      0,
    "A known-device Mac App outage must block Control Center navigation",
  );
  assert(
    (await page.getByTestId("mac-app-recovery-screen").count()) === 1,
    "A known-device Mac App outage must render the focused recovery screen",
  );
  assert(
    (await page
      .getByRole("heading", { name: "Set up your VibeTV" })
      .count()) === 0,
    "A known-device Mac App outage must not render first-run setup",
  );
  assert(
    (await page.getByText("Plug VibeTV into power.").count()) === 0,
    "A known-device Mac App outage must not show WiFi onboarding",
  );
  assert(
    Boolean(
      await page.evaluate(() =>
        window.localStorage.getItem("vibetv.controlCenter.deviceTarget"),
      ),
    ),
    "A known-device Mac App outage must preserve the saved VibeTV target",
  );
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
  await page.getByRole("heading", { name: "VibeTV is connected" }).waitFor({
    timeout: 10_000,
  });
  await waitForCondition(
    () => repairRequests === 1,
    "The pairing error should trigger one automatic repair",
  );
  await page.waitForTimeout(6_000);
  assert(
    repairRequests === 1,
    `One pairing error must trigger at most one automatic repair, got ${repairRequests}`,
  );
  assert(
    (await page.getByTestId("device-startup-screen").count()) === 0,
    "A failed pairing repair must not reopen first-run setup for a known VibeTV",
  );
  assertNoInstallRequests(installRequests);
  await page.close();
}

function providerSetupFixture(status) {
  const engineProblem = [
    "config_error",
    "not_configured",
    "engine_error",
  ].includes(status);
  const codexBarProblem = ["not_configured", "engine_error"].includes(status);
  return {
    status: "setup_required",
    checkedAt: "2026-07-17T17:00:00Z",
    engine: {
      status: engineProblem ? status : "ready",
      version: "0.44.0",
      path: "/Users/customer/Applications/CodexBar.app",
      source: "bundled",
      configWritable: status !== "config_error",
    },
    providers: [
      {
        id: codexBarProblem ? "codexbar" : "claude",
        label: codexBarProblem ? "CodexBar" : "Claude",
        enabled: true,
        status,
        detail: codexBarProblem
          ? "No usable AI provider is configured yet."
          : undefined,
      },
    ],
  };
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
  await page.getByRole("button", { name: "Create report" }).waitFor({
    timeout: 10_000,
  });
  assert(
    (await page.getByRole("button", { name: "VibeTV is on WiFi" }).count()) ===
      0,
    "Hosted entry must not start the VibeTV WiFi flow",
  );
  assert(
    (await page
      .getByRole("button", { name: "Mac App is installed" })
      .count()) === 0,
    "Hosted entry should hand off when the customer opens the downloaded app",
  );
  assert(
    (await page
      .getByRole("button", { name: "Open Control Center" })
      .count()) === 0,
    "First hosted entry must not show a second launch action",
  );
  if (expectDmg) {
    await startVerifiedDmgSetupDownload(page, { startDownload: false });
  } else {
    const unavailable = page.getByRole("button", {
      name: "Mac App download not ready",
    });
    await unavailable.waitFor({ timeout: 10_000 });
    assert(
      await unavailable.isDisabled(),
      "Unavailable DMG must stay disabled",
    );
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
  await page.getByRole("button", { name: "Create report" }).click();
  await page.getByRole("button", { name: "Copy report" }).waitFor({
    timeout: 10_000,
  });
  assert(
    companionRequests.some((pathname) => pathname === "/v1/diagnostics"),
    "Creating a hosted setup report should try the local Mac App once",
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

  await page.goto("https://app.vibetv.shop/", {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("heading", { name: "Get the VibeTV Mac App" }).waitFor({
    timeout: 10_000,
  });
  assert(
    (await page
      .getByRole("button", { name: "Open Control Center" })
      .count()) === 0,
    "A prior visit must not replace the hosted download with a launcher",
  );
  if (expectDmg) {
    await startVerifiedDmgSetupDownload(page, { startDownload: false });
  } else {
    const unavailable = page.getByRole("button", {
      name: "Mac App download not ready",
    });
    await unavailable.waitFor({ timeout: 10_000 });
    assert(
      await unavailable.isDisabled(),
      "Unavailable DMG must stay disabled",
    );
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

async function testLocalFreshAppSearchesBeforeWifiSetup(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  const repairRequests = [];
  let searchRequests = 0;
  await routeCompanionOnline(page, installRequests, () => {}, {
    device: { connected: false },
    searchDelayMs: 300,
    onSearch: () => {
      searchRequests += 1;
      return [];
    },
    onRepair: (postData) => {
      repairRequests.push(postData || "");
      return { connected: false, paired: false };
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Looking for your VibeTV" }).waitFor({
    timeout: 10_000,
  });
  assert(
    (await page
      .getByRole("heading", { name: "Set up your VibeTV" })
      .count()) === 0,
    "Fresh local onboarding must never show the old Setup screen",
  );
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
    `A scan without results must not repair or pair, got ${JSON.stringify(repairRequests)}`,
  );
  assert(
    searchRequests === 1,
    "Fresh local onboarding must search automatically",
  );
  await page.getByRole("button", { name: "VibeTV is on WiFi" }).click();
  await page.getByRole("heading", { name: "Looking for your VibeTV" }).waitFor({
    timeout: 10_000,
  });
  await page.getByRole("heading", { name: "Connect VibeTV to WiFi" }).waitFor({
    timeout: 10_000,
  });
  assert(
    (await page.getByRole("navigation", { name: "Control Center" }).count()) ===
      0,
    "The Control Center navigation must stay hidden throughout WiFi onboarding",
  );
  assert(searchRequests === 2, "WiFi confirmation must start another scan");
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testLocalReachableWithoutFrameOpensOverview(browser, appUrl) {
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
  await page.getByRole("navigation", { name: "Control Center" }).waitFor({
    timeout: 10_000,
  });
  await page.getByRole("heading", { name: "VibeTV is connected" }).waitFor({
    timeout: 10_000,
  });
  await page.getByText("Waiting for first image", { exact: true }).waitFor({
    timeout: 10_000,
  });
  assert(
    (await page.getByTestId("device-startup-screen").count()) === 0,
    "A reachable and paired VibeTV should open Control Center while the first image is pending",
  );
  assert(
    (await page.getByRole("button", { name: "Setup", exact: true }).count()) ===
      0,
    "The installed app must not expose a Setup tab",
  );
  assert(
    repairRequests.length === 0,
    "Opening Control Center must not automatically retry a reachable but unready VibeTV",
  );
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testConfiguredDeviceShowsReconnectingWithoutSetup(
  browser,
  appUrl,
) {
  const page = await newCustomerPage(browser, appUrl, {
    viewport: desktopViewport,
  });
  const installRequests = [];
  const repairRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    device: { ...reconnectingDevice, deviceId: "known-device-1" },
    searchDelayMs: 500,
    searchDevices: [],
    onRequest: (pathname, method) => {
      if (pathname === "/v1/device/repair" && method === "POST") {
        repairRequests.push(pathname);
      }
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Looking for your VibeTV" }).waitFor({
    timeout: 10_000,
  });
  assert(
    (await page
      .getByRole("heading", { name: "Set up your VibeTV" })
      .count()) === 0,
    "Setup must stay hidden while the automatic scan is still running",
  );
  assert(
    (await page.getByRole("navigation", { name: "Control Center" }).count()) ===
      0,
    "Reconnect and search must finish before Overview or Setup is rendered",
  );
  await page.getByRole("heading", { name: "VibeTV was not found" }).waitFor();
  await page.getByRole("button", { name: "Open Control Center" }).waitFor();
  assert(
    repairRequests.length === 0,
    "The browser must let the Companion own bounded automatic recovery",
  );
  assert(
    (await page.getByText("Plug VibeTV into power.").count()) === 0,
    "A configured VibeTV must not fall back to first-run WiFi instructions",
  );
  await page.getByRole("button", { name: "Open Control Center" }).click();
  await page.getByRole("navigation", { name: "Control Center" }).waitFor();
  await page.getByRole("heading", { name: "VibeTV status" }).waitFor();
  await page
    .locator('[data-slot="item-title"]')
    .filter({ hasText: /^Not connected$/ })
    .waitFor();
  assert(
    (await page.getByTestId("device-startup-screen").count()) === 0,
    "Opening Control Center for a configured VibeTV must keep the shell visible",
  );
  assertNoInstallRequests(installRequests);
  await page.close();
}

async function testRunningDeviceOutageKeepsControlCenterOpen(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, {
    viewport: desktopViewport,
  });
  const installRequests = [];
  const statusRequests = [];
  const deviceWriteRequests = [];
  const configuredReadyDevice = {
    ...companionDevice,
    connectionState: "ready",
    deviceId: "known-device-1",
  };
  await routeCompanionOnline(page, installRequests, () => {}, {
    device: configuredReadyDevice,
    onRequest: (pathname, method) => {
      if (pathname === "/v1/status" && method === "GET") {
        statusRequests.push(pathname);
      }
      if (
        method === "POST" &&
        pathname !== "/v1/device/search" &&
        pathname.startsWith("/v1/device/")
      ) {
        deviceWriteRequests.push(pathname);
      }
    },
    searchDevices: [],
    statusDeviceSequence: [
      configuredReadyDevice,
      { connected: false, paired: false },
      { ...reconnectingDevice, deviceId: "known-device-1" },
      { ...reconnectingDevice, deviceId: "known-device-1" },
      configuredReadyDevice,
    ],
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Overview", exact: true }).waitFor({
    timeout: 10_000,
  });
  await clickNavigation(page, "Usage");
  await page.getByRole("heading", { name: "Usage", exact: true }).waitFor();
  await page.getByText("VibeTV not connected", { exact: true }).waitFor({
    timeout: 12_000,
  });
  assert(
    (await page.getByRole("button", { name: "Overview", exact: true }).count()) === 1,
    "A running session must keep the Control Center shell during an outage",
  );
  await page.getByRole("heading", { name: "Usage", exact: true }).waitFor();
  assert(
    (await page.getByTestId("device-startup-screen").count()) === 0,
    "A running session must not return to the startup screen",
  );
  await waitForCondition(
    () => statusRequests.length >= 5,
    `Running recovery should poll status at least five times, got ${statusRequests.length}`,
    20_000,
  );
  await page.waitForTimeout(250);
  await page.getByText("VibeTV connected", { exact: true }).waitFor({
    timeout: 5_000,
  });
  await page.getByRole("heading", { name: "Usage", exact: true }).waitFor();
  assert(
    deviceWriteRequests.length === 0,
    `Running recovery must stay read-only while VibeTV is offline, got ${deviceWriteRequests}`,
  );
  assertNoInstallRequests(installRequests);
  await page.close();
}

async function testLocalOverviewRecoversWhenDeviceBecomesReady(
  browser,
  appUrl,
) {
  const page = await newCustomerPage(browser, appUrl, {
    viewport: desktopViewport,
  });
  const installRequests = [];
  const repairRequests = [];
  const deviceReadRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    device: reachableUnreadyDevice,
    statusDeviceSequence: [reachableUnreadyDevice, companionDevice],
    onRequest: (pathname, method) => {
      if (pathname === "/v1/device/repair" && method === "POST") {
        repairRequests.push(pathname);
      }
      if (pathname === "/v1/device" && method === "GET") {
        deviceReadRequests.push(pathname);
      }
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "VibeTV is connected" }).waitFor({
    timeout: 10_000,
  });
  await page.getByText("Live", { exact: true }).waitFor({
    timeout: 12_000,
  });
  assert(
    repairRequests.length === 0,
    "Setup recovery must use read-only status polling without pairing or repair writes",
  );
  assert(
    deviceReadRequests.length === 0,
    `Setup recovery must use the /v1/status device payload without redundant /v1/device reads, got ${deviceReadRequests.length}`,
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
    firstStatusDelayMs: 2_000,
    onRequest: (pathname, method) => {
      if (method === "POST" && pathname === "/v1/device/repair") {
        repairRequests.push(pathname);
      }
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Starting Control Center" }).waitFor({
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "Create report" }).waitFor({
    timeout: 10_000,
  });
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

async function testDelayedSettingsDoesNotResetActiveTab(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  let settingsRequests = 0;
  await routeCompanionOnline(
    page,
    installRequests,
    () => {
      settingsRequests += 1;
    },
    {
      device: companionDevice,
      settingsDelayMs: 700,
    },
  );

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  const updatesButton = await getNavigationButton(page, "Updates");
  await updatesButton.waitFor({ timeout: 10_000 });
  await updatesButton.click();
  await page.waitForTimeout(900);
  assert(settingsRequests > 0, "The delayed settings response must be tested");
  const activeUpdatesButton = await getNavigationButton(page, "Updates");
  assert(
    (await activeUpdatesButton.getAttribute("aria-current")) === "page",
    "A late settings response must not reset the active tab to Overview",
  );
  assert(
    (await page.getByTestId("device-startup-screen").count()) === 0,
    "A late settings response must keep the Control Center mounted",
  );
  assertNoInstallRequests(installRequests);
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
  await page.getByRole("heading", { name: "Set up your VibeTV" }).waitFor({
    timeout: 10_000,
  });
  assert(
    (await page.getByRole("navigation", { name: "Control Center" }).count()) ===
      0,
    "Control Center navigation must stay hidden until startup is complete",
  );
  assert(
    (await page.getByRole("button", { name: "Setup", exact: true }).count()) ===
      0,
    "The installed app must not expose a Setup tab before startup is complete",
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
  await (await getNavigationButton(page, "Overview")).waitFor({ timeout: 20_000 });
  for (const tabName of [
    "Overview",
    "Settings",
    "Theme Library",
    "Updates",
    "Support",
  ]) {
    const button = await getNavigationButton(page, tabName);
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
  assert(
    (await page.getByRole("button", { name: "Setup", exact: true }).count()) ===
      0,
    "The ready Control Center must not expose a Setup tab",
  );
  assert(
    (await page.getByRole("button", { name: "Run setup again" }).count()) === 0,
    "The removed Setup tab must not leave its reset action in the ready Control Center",
  );
  assert(
    (await page.getByRole("button", { name: "Fix connection" }).count()) === 0,
    "completed setup should not show repair actions while healthy",
  );
  await clickNavigation(page, "Overview");
  await page.getByRole("heading", { name: "VibeTV is connected" }).waitFor({
    timeout: 10_000,
  });
  await clickNavigation(page, "Theme Library");
  await page
    .getByRole("heading", { name: "Themes" })
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

  assert(
    (await page.getByRole("navigation", { name: "Control Center" }).count()) ===
      0,
    "The Control Center header and navigation must stay hidden during startup",
  );
  assert(
    (await page.getByText("192.168.178.163").count()) === 0,
    "desktop header should not show a device IP while setup is incomplete",
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

  await clickNavigation(page, "Settings");
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

  await captureMigrationScreenshot(page, "04-settings-mobile.png");
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testUsagePrioritizesProviderTokenHistory(browser, appUrl) {
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
        {
          id: "claude",
          label: "Claude",
          source: "oauth",
          session: 0,
          weekly: 6,
          resetSecs: 10_800,
          usageMode: "used",
          weekTokens: 19_176_330,
          totalTokens: 19_176_330,
          cost: {
            currencyCode: "USD",
            updatedAt: "2026-06-29T10:47:46Z",
            last30DaysTokens: 19_176_330,
            daily: [
              {
                day: "2026-06-29",
                totalCostUSD: 8.69,
                totalTokens: 19_176_330,
                models: [
                  {
                    name: "claude-opus-4-8",
                    totalTokens: 19_176_330,
                    costUSD: 8.69,
                  },
                ],
              },
            ],
          },
        },
      ],
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await clickNavigation(page, "Usage");
  const tokenChartHeading = page.getByRole("heading", {
    name: "Tokens used over time",
  });
  await tokenChartHeading.waitFor({
    timeout: 10_000,
  });
  await page
    .getByText("4,319,176,330", { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByText(
      "four billion three hundred nineteen million one hundred seventy-six thousand three hundred thirty tokens",
      { exact: true },
    )
    .waitFor({ timeout: 10_000 });
  assert(
    (await page.getByText("Daily tokens by provider", { exact: false }).count()) ===
      0,
    "Usage should not show the removed token chart subtitle",
  );
  const providerHeading = page.getByRole("heading", { name: "Codex" });
  await providerHeading.waitFor({
    timeout: 10_000,
  });
  assert(
    (await page.getByRole("heading", { name: "Limit Reset Credits" }).count()) ===
      0,
    "Usage should not show Codex-specific reset credits",
  );
  assert(
    (await page.getByText("3 manual resets available").count()) === 0,
    "Usage should not show manual reset metadata",
  );
  assert(
    (await page.getByText("Top model: gpt-5.5").count()) === 0,
    "Usage should not show the removed Codex cost summary",
  );
  const tokenChartBox = await tokenChartHeading.boundingBox();
  const providerBox = await providerHeading.boundingBox();
  assert(
    tokenChartBox && providerBox && tokenChartBox.y < providerBox.y,
    "The provider-neutral token chart should be the primary Usage metric",
  );

  await captureMigrationScreenshot(page, "05-usage-desktop.png");
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
  await clickNavigation(page, "Usage");
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

async function testRunSetupAgainReturnsToWifiOnboarding(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, {
    viewport: desktopViewport,
  });
  const installRequests = [];
  const resetRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    searchDelayMs: 300,
    searchDevices: [],
    onReset: (postData) => {
      resetRequests.push(postData || "");
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "VibeTV is connected" }).waitFor({
    timeout: 10_000,
  });
  assert(
    (await page.getByRole("button", { name: "Setup", exact: true }).count()) ===
      0,
    "The ready Control Center must not expose a Setup tab",
  );
  assert(
    (await page.getByRole("button", { name: "Run setup again" }).count()) === 0,
    "Removing the Setup tab must also remove its reset action",
  );
  assert(
    resetRequests.length === 0,
    `Opening the ready Control Center must not reset setup, got ${resetRequests.length}`,
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
  await clickNavigation(page, "Updates");
  const dmgUpdateLink = page.getByRole("link", {
    name: "Update",
  });
  await dmgUpdateLink.waitFor({
    timeout: 10_000,
  });
  const updateCardBadges = page.locator(
    '[data-slot="card-action"] [data-slot="badge"]',
  );
  const updateCardBadgeLabels = await updateCardBadges.allTextContents();
  assert(
    updateCardBadgeLabels.length > 0 &&
      updateCardBadgeLabels.every(
        (label) => label.trim() === "Update available",
      ),
    `Update cards must only show Update available badges, got ${JSON.stringify(updateCardBadgeLabels)}`,
  );
  assert(
    assetName(await dmgUpdateLink.getAttribute("href")) ===
      "VibeTV-Control-Center.dmg",
    "Updates should use the verified DMG release asset",
  );
  assert(
    (await page
      .getByText(/DMG|Applications|choose Replace|second copy/i)
      .count()) === 0,
    "Updates must not expose manual Mac App installation mechanics",
  );
  await page.getByText("Installed", { exact: true }).waitFor({ timeout: 10_000 });
  await page.getByText("Available", { exact: true }).waitFor({ timeout: 10_000 });
  assert(
    (await page
      .getByRole("button", { name: "Copy update command" })
      .count()) === 0,
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

async function testNativeMacAppUpdateUsesSparkleAction(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    companionVersion: "1.0.44",
    companionApp: {
      version: "1.0.32",
      build: "132",
      path: "/Applications/VibeTV Control Center.app",
      installationMode: "dmg",
      installedInApplications: true,
    },
    companionRuntime: {
      version: "1.0.44",
      commit: "abcdef1234567890",
      pid: 174,
      listenerOwner: "shop.vibetv.control-center.runtime",
    },
    device: { ...companionDevice, firmware: "1.0.33" },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await clickNavigation(page, "Updates");
  const updateLink = page.getByRole("link", {
    name: "Update",
  });
  await updateLink.waitFor({ timeout: 10_000 });
  assert(
    (await updateLink.getAttribute("href")) === "vibetv://check-for-updates",
    "Installed native Mac Apps must hand updates to the exact Sparkle URL action",
  );
  await page.getByText("1.0.32").waitFor({ timeout: 10_000 });
  await page.getByText("Installed", { exact: true }).waitFor({ timeout: 10_000 });
  await page.getByText("Available", { exact: true }).waitFor({ timeout: 10_000 });
  assert(
    (await page.getByText("Status", { exact: true }).count()) === 0 &&
      (await page.getByText("App build", { exact: true }).count()) === 0 &&
      (await page.getByText("Background version", { exact: true }).count()) === 0 &&
      (await page.getByText("Background service", { exact: true }).count()) === 0 &&
      (await page.getByText("shop.vibetv.control-center.runtime").count()) === 0 &&
      (await page.getByText("PID 174").count()) === 0 &&
      (await page.getByText("abcdef12").count()) === 0,
    "Updates must omit status and internal Mac App details from customer copy",
  );
  assert(
    (await page.getByRole("link", { name: "Update" }).count()) === 1,
    "Native Sparkle updates must show exactly one Update action",
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
    .getByRole("heading", { name: "Update available" })
    .waitFor({ timeout: 10_000 });
  const overviewDownload = page.getByRole("link", {
    name: "Update",
  });
  await overviewDownload.waitFor({ timeout: 10_000 });
  assert(
    assetName(await overviewDownload.getAttribute("href")) ===
      "VibeTV-Control-Center.dmg",
    "Legacy Overview must use the verified DMG release asset",
  );
  await captureMigrationScreenshot(page, "01-legacy-overview.png");

  await clickNavigation(page, "Updates");
  await page
    .getByRole("heading", { name: "Update available" })
    .waitFor({ timeout: 10_000 });
  const updatesDownload = page.getByRole("link", {
    name: "Update",
  });
  await updatesDownload.waitFor({ timeout: 10_000 });
  assert(
    (await page
      .getByText(/DMG|Applications|choose Replace|second copy/i)
      .count()) === 0,
    "Legacy Updates must not expose manual installation mechanics",
  );
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
    .getByRole("heading", { name: "Update available" })
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
    (await page.getByRole("heading", { name: "Update available" }).count()) ===
      0,
    "DMG Overview must not show the legacy migration card",
  );
  await clickNavigation(page, "Updates");
  await page.getByRole("heading", { name: "Up to date" }).waitFor({
    timeout: 10_000,
  });
  assert(
    (await page
      .locator('[data-slot="card-action"] [data-slot="badge"]')
      .count()) === 0,
    "Up-to-date cards must not show status badges",
  );
  assert(
    (await page.getByRole("link", { name: "Update" }).count()) === 0,
    "Current DMG install must not show a migration download",
  );
  assert(
    (await page.getByRole("link", { name: "Update" }).count()) === 0,
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
  await clickNavigation(page, "Updates");
  await page.getByRole("heading", { name: "Update check failed" }).waitFor({
    timeout: 10_000,
  });
  const retry = page.getByRole("button", { name: "Check again" });
  await retry.waitFor({ timeout: 10_000 });
  assert(
    await retry.isEnabled(),
    "Failed DMG check must offer an active retry",
  );
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

async function testUpdatesShowLegacyCompanionReleaseFallback(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    legacyCompanionRelease: true,
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await clickNavigation(page, "Updates");
  await page
    .getByRole("link", { name: "Update" })
    .waitFor({ timeout: 10_000 });
  const macAppSection = page.locator('[data-slot="card"]').filter({
    has: page.getByRole("heading", { name: "Mac App" }),
  });
  await macAppSection
    .getByText("1.0.32", { exact: true })
    .first()
    .waitFor({ timeout: 10_000 });
  await macAppSection
    .getByText("1.0.99", { exact: true })
    .waitFor({ timeout: 10_000 });

  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testReloadRestoresRunningFirmwareUpdate(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, {
    viewport: desktopViewport,
  });
  const installRequests = [];
  const recoveryWrites = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    device: {
      ...companionDevice,
      deviceId: "firmware-device-1",
    },
    onRequest: (pathname, method) => {
      if (
        method === "POST" &&
        (pathname === "/v1/device/search" || pathname === "/v1/setup/reset")
      ) {
        recoveryWrites.push(pathname);
      }
    },
    statusFirmwareUpdateJob: {
      id: "update-job-from-another-window",
      phase: "installing",
      stage: "waiting_for_device",
      message: "Restarting VibeTV.",
      progress: 85,
      startedAt: "2026-07-17T12:00:00.000Z",
      logs: [
        "Preparing VibeTV update.",
        "Updating VibeTV.",
        "Restarting VibeTV.",
      ],
    },
    statusDeviceSequence: [
      { ...companionDevice, deviceId: "firmware-device-1" },
      {
        ...reconnectingDevice,
        deviceId: "firmware-device-1",
        paired: true,
      },
    ],
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("status")
    .filter({ hasText: "Restarting VibeTV" })
    .waitFor({ timeout: 10_000 });
  assert(
    (await page
      .getByRole("button", { name: /^Updates/ })
      .getAttribute("aria-current")) === "page",
    "A reloaded app must reopen the active firmware update",
  );
  await page.getByText("VibeTV not connected", { exact: true }).waitFor();
  await clickNavigation(page, "Overview");
  assert(
    (await page.getByRole("button", { name: "Search for VibeTV" }).count()) ===
      0 &&
      (await page
        .getByRole("button", { name: "Set up another VibeTV" })
        .count()) === 0,
    "A restored firmware update must hide every recovery write",
  );
  assert(
    recoveryWrites.length === 0,
    `A reload during firmware update must stay read-only, got ${recoveryWrites}`,
  );
  assertNoInstallRequests(installRequests);
  await page.close();
}

async function testReloadRestoresRunningThemeInstall(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, {
    viewport: desktopViewport,
  });
  const installRequests = [];
  let installStatusRequests = 0;
  await routeCompanionOnline(page, installRequests, () => {}, {
    onRequest: (pathname) => {
      if (pathname === "/v1/themes/install/status") {
        installStatusRequests += 1;
      }
    },
    statusThemeInstallJob: {
      id: "theme-job-from-closed-window",
      themeId: "synthwave",
      themeName: "Fixture Synthwave Theme",
      phase: "installing",
      message: "Uploading theme files.",
      progress: 40,
      startedAt: "2026-07-18T12:00:00.000Z",
      logs: ["Preparing theme files.", "Uploading theme files."],
    },
    installStatusSequence: [
      {
        phase: "installing",
        message: "Uploaded theme file 1.",
        progress: 55,
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
          name: "Fixture Synthwave Theme",
          activePath: "/themes/u/synthwave.json",
          themeRev: 1,
        },
      },
    ],
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByText("Uploaded theme file 1.", { exact: true }).waitFor({
    timeout: 10_000,
  });
  assert(
    (await page
      .getByRole("button", { name: /^(Themes|Theme Library)$/ })
      .getAttribute("aria-current")) === "page",
    "A reopened app must return to the running theme install",
  );
  await page
    .getByText("Theme is active on VibeTV.", { exact: true })
    .waitFor({ timeout: 10_000 });
  assert(
    installStatusRequests >= 2,
    `A reopened app must resume polling the existing theme job, got ${installStatusRequests} polls`,
  );
  assert(
    installRequests.length === 0,
    "Restoring a theme install must not start a second install request",
  );
  await page.close();
}

async function testFirmwareUpdateShowsCustomerProgress(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  const updateRequests = [];
  const reloadRequests = [];
  let firmwareStatusRequests = 0;
  await routeCompanionOnline(page, installRequests, () => {}, {
    companionVersion: "1.0.99",
    onRequest: (pathname, method) => {
      if (pathname === "/v1/device/reload-display" && method === "POST") {
        reloadRequests.push(pathname);
      }
      if (pathname === "/v1/status" && updateRequests.length > 0) {
        firmwareStatusRequests += 1;
      }
    },
    onUpdate: (postData) => {
      updateRequests.push(postData);
    },
    dropBoardAfterFirmwareUpdate: true,
    deviceAfterFirmwareUpdate: {
      ...companionDevice,
      connectionState: "ready",
      deviceId: "firmware-device-1",
      firmware: "1.0.33",
    },
    firmwareStatusDeviceSequence: [
      {
        ...reconnectingDevice,
        deviceId: "firmware-device-1",
      },
      {
        ...companionDevice,
        connectionState: "ready",
        deviceId: "firmware-device-1",
        firmware: "1.0.33",
      },
    ],
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
        phase: "installing",
        message: "Restarting VibeTV.",
        progress: 85,
        logs: [
          "Preparing VibeTV update.",
          "Checking VibeTV.",
          "Checking update.",
          "Update downloaded.",
          "Updating VibeTV.",
          "Restarting VibeTV.",
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
  await clickNavigation(page, "Updates");
  const firmwareSection = page.locator('[data-slot="card"]').filter({
    has: page.getByRole("heading", { name: "Firmware update" }),
  });
  await page.getByRole("button", { name: "Update", exact: true }).waitFor({
    timeout: 10_000,
  });
  assert(
    (await page
      .getByRole("button", { name: "Update", exact: true })
      .count()) === 1,
    "Updates should show one primary Update button",
  );
  await page.getByRole("button", { name: "Update", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Updating VibeTV" })
    .waitFor({ timeout: 10_000 });
  const offlineDeadline = Date.now() + 5_000;
  while (firmwareStatusRequests < 1 && Date.now() < offlineDeadline) {
    await page.waitForTimeout(25);
  }
  assert(
    firmwareStatusRequests >= 1,
    "Firmware progress must include a reconnecting status response",
  );
  const activeUpdatesDuringReconnect = await getNavigationButton(page, "Updates");
  assert(
    (await activeUpdatesDuringReconnect.getAttribute("aria-current")) === "page",
    "The Updates tab must stay active while VibeTV is reconnecting",
  );
  assert(
    (await page.getByTestId("device-startup-screen").count()) === 0,
    "Firmware reconnecting must not open the startup screen",
  );
  await clickNavigation(page, "Overview");
  assert(
    (await page.getByRole("button", { name: "Search for VibeTV" }).count()) ===
      0 &&
      (await page
        .getByRole("button", { name: "Set up another VibeTV" })
        .count()) === 0,
    "Recovery writes must stay unavailable while firmware is updating",
  );
  await clickNavigation(page, "Updates");
  await page
    .getByRole("status")
    .filter({ hasText: /Updating VibeTV|Restarting VibeTV/ })
    .waitFor({ timeout: 10_000 });
  await page
    .getByRole("status")
    .filter({ hasText: "Update complete" })
    .waitFor({ timeout: 10_000 });
  await page.getByText("Firmware 1.0.33 is installed.").waitFor({
    timeout: 10_000,
  });
  const readyDeadline = Date.now() + 5_000;
  while (firmwareStatusRequests < 2 && Date.now() < readyDeadline) {
    await page.waitForTimeout(25);
  }
  assert(
    firmwareStatusRequests >= 2,
    "Firmware progress must verify ready → reconnecting → ready status",
  );
  assert(
    (await page.locator("main.control-center-shell").count()) === 1,
    "Firmware reboot must keep the Control Center shell visible",
  );
  const activeUpdatesAfterReboot = await getNavigationButton(page, "Updates");
  assert(
    (await activeUpdatesAfterReboot.getAttribute("aria-current")) === "page",
    "Firmware reboot must keep the Updates tab active",
  );
  assert(
    (await page.getByTestId("device-startup-screen").count()) === 0,
    "Firmware reboot must not open the startup screen",
  );
  assert(
    (await firmwareSection.getByText("Checking", { exact: true }).count()) ===
      0,
    "firmware rows should not stay in checking state after success",
  );
  assert(updateRequests.length === 1, "firmware update should start once");
  assert(
    reloadRequests.length === 0,
    "Firmware reboot must not trigger an image reload while VibeTV is offline",
  );

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

async function testFirmwareAttentionDoesNotOfferSecondFlash(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    companionVersion: "1.0.99",
    updateStatusSequence: [
      {
        phase: "attention",
        stage: "verifying_render",
        outcome: "firmware_current_render_attention",
        message: "Firmware is current, but the picture could not be verified.",
        progress: 100,
        logs: [
          "Updating VibeTV.",
          "Restarting VibeTV.",
          "Checking the picture.",
        ],
        result: {
          firmware: "1.0.33",
          deviceId: "device-174",
          artifactValidated: true,
          uploadAccepted: true,
          helloVerified: true,
          healthVerified: true,
          streamVerified: true,
          renderVerified: false,
        },
      },
    ],
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await clickNavigation(page, "Updates");
  await page.getByRole("button", { name: "Update", exact: true }).click();
  await page
    .getByText("Firmware current — attention needed")
    .waitFor({ timeout: 10_000 });
  await page
    .getByText("Firmware is current, but the picture could not be verified.")
    .waitFor({ timeout: 10_000 });
  assert(
    (await page.getByRole("button", { name: "Try again" }).count()) === 0,
    "Attention after a verified firmware install must not offer a second flash",
  );
  await page.getByRole("button", { name: "Create report" }).waitFor({
    timeout: 10_000,
  });
  assertNoInstallRequests(installRequests);
  await page.close();
}

async function testFirmwarePowerCycleErrorDoesNotOfferSecondFlash(
  browser,
  appUrl,
) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    companionVersion: "1.0.99",
    updateStatusSequence: [
      {
        phase: "error",
        stage: "uploading",
        retryPolicy: "power_cycle",
        message: "Update failed.",
        progress: 100,
        logs: ["Updating VibeTV.", "Update failed."],
        error: {
          code: "firmware_update_restart_required",
          message: "VibeTV must restart before another update attempt.",
          nextAction:
            "Disconnect VibeTV from power for 10 seconds, reconnect it, and wait until the picture returns before trying again.",
        },
      },
    ],
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await clickNavigation(page, "Updates");
  await page.getByRole("button", { name: "Update", exact: true }).click();
  await page.getByText("Update failed", { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page
    .getByText("Disconnect VibeTV from power", { exact: false })
    .waitFor({
      timeout: 10_000,
    });
  assert(
    (await page.getByRole("button", { name: "Try again" }).count()) === 0,
    "Unsafe firmware failure must not offer a same-boot retry",
  );
  await page.getByRole("button", { name: "Create report" }).waitFor({
    timeout: 10_000,
  });
  assertNoInstallRequests(installRequests);
  await page.close();
}

async function testUpdatesKeepDmgHiddenWithoutVerifiedAsset(browser, appUrl) {
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
    .getByRole("heading", { name: "Update not ready" })
    .waitFor({ timeout: 10_000 });
  assert(
    (await page
      .getByRole("button", { name: "Update", exact: true })
      .count()) === 0,
    "Legacy Overview must hide an unavailable update action",
  );
  await clickNavigation(page, "Updates");
  const unavailableButton = page.getByRole("button", {
    name: "Update",
    exact: true,
  });
  await unavailableButton.waitFor({ timeout: 10_000 });
  assert(
    await unavailableButton.isDisabled(),
    "Unavailable DMG must stay disabled",
  );
  assert(
    (await page.getByRole("link", { name: "Update" }).count()) === 0,
    "Updates must not show a DMG link without a verified asset",
  );
  assert(
    (await page
      .getByRole("button", { name: "Copy update command" })
      .count()) === 0,
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
  await clickNavigation(page, "Updates");
  await page.getByRole("heading", { name: "Update available" }).waitFor({
    timeout: 10_000,
  });
  const update = page.getByRole("button", { name: "Update", exact: true });
  await update.waitFor({ timeout: 10_000 });
  assert(
    await update.isEnabled(),
    "Unavailable DMG migration must not disable a VibeTV firmware update",
  );
  await update.click();
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
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value) => {
          globalThis.__copiedSupportReport = value;
        },
      },
    });
  });
  const installRequests = [];
  await routeCompanionOnline(page, installRequests);

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await clickNavigation(page, "Support");
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
  await page.getByText("VibeTVs on WiFi", { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByText("1 found", { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page
    .getByRole("region", { name: "VibeTVs found on this WiFi" })
    .getByText("wifi-vibetv", { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "Copy report" }).click();
  const copiedReport = await page.evaluate(
    () => globalThis.__copiedSupportReport || "",
  );
  for (const secret of [
    "raw-token",
    "raw-api-key",
    "raw-basic",
    "raw-header",
    "raw-env",
    "raw-query",
    "raw-userinfo",
  ]) {
    assert(
      !copiedReport.includes(secret),
      `Copied support report leaked synthetic secret ${secret}`,
    );
  }
  assert(
    copiedReport.includes('"token": "[redacted]"') &&
      copiedReport.includes('"apiKey": "[redacted]"'),
    "Copied support report should replace synthetic secrets with redaction markers",
  );
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
    "http://192.168.178.163",
    "COMPANION_UNREACHABLE",
  ];
  for (const text of hiddenSupportText) {
    assert(
      (await page.getByText(text, { exact: false }).count()) === 0,
      `Support report should not show internal diagnostic text: ${text}`,
    );
  }

  await captureMigrationScreenshot(page, "06-support-mobile.png");
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
        deviceId: "fixture-device-1",
        connected: false,
        paired: true,
        ready: false,
        stream: { healthy: false, running: true },
      },
      searchDevices: [
        {
          target: "http://192.168.178.163",
          deviceId: "fixture-device-1",
          networkMode: "station",
          known: true,
          active: true,
        },
      ],
      onRepair: (postData) => {
        repairRequests.push(postData || "");
        return {
          ...companionDevice,
          target: "http://192.168.178.163",
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
  await page.getByText("VibeTV is connected").waitFor({ timeout: 10_000 });
  await waitForCondition(
    () => repairRequests.length === 1,
    "expected one automatic VibeTV repair to run",
  );

  const repairPayload = JSON.parse(repairRequests[0] || "{}");
  assert(
    repairPayload.target === "http://192.168.178.163",
    `automatic repair should use the fresh search result, got ${repairRequests[0]}`,
  );
  assert(
    repairPayload.forcePair == null || repairPayload.forcePair === false,
    `automatic repair should preserve a valid pairing token, got ${repairRequests[0]}`,
  );
  assert(
    settingsCalls >= 1,
    "automatic repair should continue into settings refresh after finding VibeTV",
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
      ready: false,
      stream: {
        healthy: false,
        running: false,
      },
    },
    displayFrameUnavailableResponses: 1,
    displayFrameResponse: {
      ok: true,
      savedAt: "2026-06-29T10:47:46Z",
      source: "last-sent-frame",
      frame: {
        v: 1,
        provider: "codex",
        label: "Codex",
        weekly: 63,
        resetSecs: 5400,
        usageMode: "used",
        activity: "coding",
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
      name: /Rendered VibeTV theme synthwave showing Codex, 0% session used, 63% weekly used/,
    })
    .waitFor({ timeout: 10_000 });
  const renderedTheme = page.getByRole("img", {
    name: /Rendered VibeTV theme synthwave/,
  });
  await renderedTheme.getByText("USAGE").waitFor({ timeout: 10_000 });
  await renderedTheme.getByText("SESSION used").waitFor({ timeout: 10_000 });
  await renderedTheme.getByText("WEEKLY used").waitFor({ timeout: 10_000 });
  await renderedTheme.getByText("0%").waitFor({ timeout: 10_000 });
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

async function testOverviewRejectsInvalidDisplayFrame(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, {
    viewport: desktopViewport,
  });
  const installRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    companionVersion: "1.0.33",
    displayFrameResponse: {
      ok: true,
      frame: {
        provider: "codex",
        label: "Codex",
      },
    },
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
          session: 27,
          weekly: 63,
          usageMode: "used",
        },
      ],
    },
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByText("VibeTV is connected").waitFor({ timeout: 10_000 });
  await page
    .getByRole("img", { name: "Loading VibeTV usage preview" })
    .waitFor({ timeout: 10_000 });
  assert(
    (await page
      .getByRole("img", { name: /Rendered VibeTV theme synthwave/ })
      .count()) === 0,
    "Overview must reject a 200 display frame without a protocol version",
  );

  assertNoInstallRequests(installRequests);
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
  await clickNavigation(page, "Theme Library");
  const synthwavePreview = page.getByRole("img", {
    name: /Rendered VibeTV theme synthwave showing VibeTV, 62% session remaining, 62% weekly remaining/,
  });
  await synthwavePreview.waitFor({ timeout: 10_000 });
  assert(
    (await synthwavePreview.locator("rect").count()) > 10,
    "Theme Library preview should render sprite primitives",
  );

  const clippyThumbnail = page.getByRole("img", {
    name: /Rendered VibeTV theme clippy showing VibeTV/,
  });
  await clippyThumbnail.waitFor({ timeout: 10_000 });
  const clippyThumbnailBox = await clippyThumbnail.boundingBox();
  assert(
    clippyThumbnailBox?.width >= 140 && clippyThumbnailBox?.height >= 140,
    `Theme Library thumbnail should be large enough to inspect, got ${JSON.stringify(clippyThumbnailBox)}`,
  );
  const firstThumbnailRender = await clippyThumbnail.evaluate(
    (node) => node.innerHTML,
  );
  await page.waitForTimeout(650);
  const secondThumbnailRender = await clippyThumbnail.evaluate(
    (node) => node.innerHTML,
  );
  assert(
    firstThumbnailRender === secondThumbnailRender,
    "Theme Library thumbnails should stay static to avoid background rendering",
  );

  await captureMigrationScreenshot(page, "07-theme-library-desktop.png");
  await page
    .getByRole("button", { name: "Preview Fixture Clippy Theme" })
    .click();
  const clippyDialogPreview = page.getByRole("dialog").getByRole("img", {
    name: /Rendered VibeTV theme clippy showing VibeTV/,
  });
  await clippyDialogPreview.waitFor({ timeout: 10_000 });
  const firstDialogRender = await clippyDialogPreview.evaluate(
    (node) => node.innerHTML,
  );
  await page.waitForTimeout(650);
  const secondDialogRender = await clippyDialogPreview.evaluate(
    (node) => node.innerHTML,
  );
  assert(
    firstDialogRender !== secondDialogRender,
    "The opened Theme Library preview should keep animating",
  );

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(100);
  const reducedMotionRender = await clippyDialogPreview.evaluate(
    (node) => node.innerHTML,
  );
  await page.waitForTimeout(650);
  assert(
    reducedMotionRender ===
      (await clippyDialogPreview.evaluate((node) => node.innerHTML)),
    "Animated previews should stop when reduced motion is requested",
  );

  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testThemeStudioUsesLocalRenderAndCompanionInstall(
  browser,
  appUrl,
) {
  const localAppUrl = "http://127.0.0.1:47832/control-center";
  const page = await browser.newPage({ viewport: themeStudioViewport });
  const installRequests = [];
  const themeInstallRequests = [];
  const browserRequests = [];

  await page.addInitScript(() => {
    window.localStorage.setItem(
      "vibetv.controlCenter.aiThemeSettings",
      JSON.stringify({ provider: "retired-test-provider", apiKey: "retired" }),
    );
  });
  page.on("request", (request) => {
    browserRequests.push(request.url());
  });
  await routeLocalCompanionAppThroughLocalNext(page, appUrl);
  for (const themeId of ["synthwave", "clippy"]) {
    const renderPack = await readTrackedThemeRenderPackFixture(themeId);
    await page.route(
      `http://127.0.0.1:47832/theme-packs/render/${themeId}.json`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(renderPack),
        });
      },
    );
  }
  await routeCompanionOnline(page, installRequests, () => {}, {
    companionVersion: "1.0.33",
    device: {
      ...companionDevice,
      firmware: "1.0.32",
    },
    installStatusSequence: [
      {
        phase: "complete",
        message: "Theme installed.",
        progress: 100,
        logs: ["Preparing theme files.", "Theme installed."],
        result: {
          themeId: "my-theme",
          packId: "my-theme-1",
          name: "New Theme",
          activePath: "/themes/u/my-theme.json",
          themeRev: 1,
        },
      },
    ],
    onThemeInstallRequest: (request) => {
      themeInstallRequests.push(request);
    },
  });

  const aiResponse = await fetch(`${appUrl}/api/ai-theme`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "generate" }),
  });
  assert(
    aiResponse.status === 404,
    `retired AI theme endpoint should return 404, got ${aiResponse.status}`,
  );

  await page.goto(localAppUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /^(Themes|Theme Library)$/ }).click();
  const publishedThemeRow = page
    .getByRole("listitem")
    .filter({ hasText: "Fixture Synthwave Theme" });
  await publishedThemeRow.waitFor({ timeout: 10_000 });
  await publishedThemeRow.getByRole("button", { name: "Edit" }).click();

  const sendButton = page.getByRole("button", { name: "Send to VibeTV" });
  await sendButton.waitFor({ timeout: 10_000 });
  assert(
    await page.locator(".control-center-shell__sidebar").isHidden(),
    "Theme Studio should hide the normal shell sidebar",
  );
  assert(
    await page.locator(".control-center-shell__header").isHidden(),
    "Theme Studio should hide the normal shell header",
  );
  const layersBox = await page
    .getByText("Layers", { exact: true })
    .boundingBox();
  const previewBox = await page
    .getByLabel("Editable 240x240 preview")
    .boundingBox();
  const inspectorBox = await page
    .getByText("Inspector", { exact: true })
    .boundingBox();
  assert(
    layersBox &&
      previewBox &&
      inspectorBox &&
      layersBox.x < previewBox.x &&
      previewBox.x < inspectorBox.x,
    "Theme Studio should show Layers, Preview, and Inspector side by side at 1180x820",
  );
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Theme Studio should not create horizontal body overflow at 1180x820",
  );
  await captureMigrationScreenshot(page, "08-theme-studio-1180x820.png");
  assert(
    await sendButton.isEnabled(),
    "published themes with validated large static sprites should remain editable and installable",
  );
  assert(
    await page.getByRole("button", { name: "Save theme" }).isEnabled(),
    "published themes with validated large static sprites should remain saveable",
  );
  const toolsButton = page.getByRole("button", { name: "Tools" });
  await toolsButton.click();
  const themeToolsDialog = page.getByRole("dialog", { name: "Theme tools" });
  const exportButton = themeToolsDialog.getByRole("button", {
    name: "Export ZIP",
  });
  assert(
    await exportButton.isEnabled(),
    "published themes with validated large static sprites should remain exportable",
  );
  await themeToolsDialog.getByRole("button", { name: "Close" }).click();
  assert(
    browserRequests.some(
      (url) => new URL(url).pathname === "/theme-packs/render/synthwave.json",
    ),
    "local Theme Studio should open a published theme from the embedded render pack",
  );
  assert(
    !browserRequests.some((url) =>
      new URL(url).pathname.startsWith("/api/theme-pack/"),
    ),
    "local Theme Studio must not depend on the removed Next theme-pack API",
  );
  assert(
    (await page.getByText("Generate with AI", { exact: true }).count()) === 0,
    "retired AI builder action should stay hidden",
  );
  assert(
    (await page.getByRole("dialog", { name: "AI theme builder" }).count()) ===
      0,
    "retired AI builder dialog should stay absent",
  );
  assert(
    (await page.evaluate(() =>
      window.localStorage.getItem("vibetv.controlCenter.aiThemeSettings"),
    )) === null,
    "retired AI provider settings should be removed from local storage",
  );

  const previewSelection = page.locator('[aria-label^="Select "]').nth(1);
  await previewSelection.click();
  const undoButton = page.getByRole("button", { name: "Undo" });
  assert(
    await undoButton.isDisabled(),
    "selecting an element should not create an undo step",
  );
  await page.getByRole("tab", { name: "Layers" }).press("ArrowRight");
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('[role="tab"]')).some(
        (tab) =>
          tab.textContent?.trim() === "Assets" &&
          tab.getAttribute("aria-selected") === "true",
      ),
  );
  assert(
    (await page
      .getByRole("tab", { name: "Assets" })
      .getAttribute("aria-selected")) === "true",
    "ArrowRight should switch the left editor panel",
  );
  assert(
    await undoButton.isDisabled(),
    "panel keyboard navigation must not move preview elements",
  );
  await page.getByRole("tab", { name: "Theme" }).click();
  await page
    .getByLabel("Name", { exact: true })
    .fill("Synthwave Customer Copy");
  await page.getByLabel("ID", { exact: true }).fill("synthwave-copy");
  await toolsButton.click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    exportButton.click(),
  ]);
  assert(
    download.suggestedFilename() === "vibetv-theme-synthwave-copy.zip",
    `Theme Studio should export the edited theme ID, got ${download.suggestedFilename()}`,
  );
  const downloadPath = await download.path();
  assert(
    downloadPath,
    "Theme Studio export should create a local ZIP download",
  );
  const downloadedZip = await readFile(downloadPath);
  assert(
    downloadedZip.length >= 4 &&
      downloadedZip[0] === 0x50 &&
      downloadedZip[1] === 0x4b &&
      downloadedZip[2] === 0x03 &&
      downloadedZip[3] === 0x04,
    "Theme Studio export should start with the ZIP PK signature",
  );
  await runCommand("unzip", ["-t", downloadPath], { cwd: root });
  await themeToolsDialog.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Save theme" }).click();
  await page.getByText("Saved to library.", { exact: true }).waitFor({
    timeout: 10_000,
  });
  assert(
    await page.locator("[data-theme-studio-root]").isVisible(),
    "saving should keep Theme Studio open",
  );
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByText("Synthwave Customer Copy", { exact: true }).waitFor({
    timeout: 10_000,
  });

  const clippyThemeRow = page
    .getByRole("listitem")
    .filter({ hasText: "Fixture Clippy Theme" });
  await clippyThemeRow.waitFor({ timeout: 10_000 });
  await clippyThemeRow.getByRole("button", { name: "Edit" }).click();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("button")).some(
      (button) =>
        button.textContent?.trim() === "Send to VibeTV" && !button.disabled,
    ),
  );
  assert(
    await page.getByRole("button", { name: "Send to VibeTV" }).isEnabled(),
    "Clippy's validated large static background should remain editable and installable",
  );
  assert(
    await page.getByRole("button", { name: "Save theme" }).isEnabled(),
    "Clippy's validated large static background should remain saveable",
  );
  assert(
    await toolsButton.isEnabled(),
    "Clippy's validated large static background should remain exportable",
  );
  await toolsButton.click();
  assert(
    await exportButton.isEnabled(),
    "Clippy's validated large static background should expose an enabled export action",
  );
  await themeToolsDialog.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Create Theme" }).click();
  const blankThemeSendButton = page.getByRole("button", {
    name: "Send to VibeTV",
  });
  await blankThemeSendButton.waitFor({ timeout: 10_000 });
  await blankThemeSendButton.click();
  await waitForCondition(
    () => themeInstallRequests.length === 1,
    "expected one Companion ZIP theme install request",
  );
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("button")).some(
      (button) =>
        button.textContent?.trim() === "Send to VibeTV" && !button.disabled,
    ),
  );
  assert(
    (await page.getByText("Theme installed through the Mac App.").count()) ===
      1,
    "Theme Studio should report the Companion install as complete",
  );

  assert(
    themeInstallRequests.length === 1,
    `Theme Studio should send exactly one install request, got ${themeInstallRequests.length}`,
  );
  const installRequest = themeInstallRequests[0];
  const installUrl = new URL(installRequest.url);
  assert(
    installUrl.pathname === "/v1/themes/install" &&
      installUrl.searchParams.get("async") === "true",
    `Theme Studio should use the asynchronous Companion install route, got ${installRequest.url}`,
  );
  assert(
    installRequest.headers["content-type"] === "application/zip",
    `Theme Studio should send application/zip, got ${installRequest.headers["content-type"]}`,
  );
  assert(
    installRequest.body.length >= 4 &&
      installRequest.body[0] === 0x50 &&
      installRequest.body[1] === 0x4b &&
      installRequest.body[2] === 0x03 &&
      installRequest.body[3] === 0x04,
    "Theme Studio install body should start with the ZIP PK signature",
  );
  const unsafeRequests = browserRequests.filter(isDirectDeviceWriteUrl);
  assert(
    unsafeRequests.length === 0,
    `Theme Studio must not write directly to a device: ${JSON.stringify(unsafeRequests)}`,
  );

  await page.getByRole("tab", { name: "Theme" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Recovery scratch");
  const closeRecovery = await page.evaluate(() => {
    window.dispatchEvent(new Event("vibetv:native-window-will-close"));
    const raw = window.localStorage.getItem(
      "vibetv.controlCenter.themeStudioDraft",
    );
    return raw ? JSON.parse(raw) : null;
  });
  assert(
    closeRecovery?.recovery?.document?.packName === "Recovery scratch",
    "Native window close must synchronously flush the latest Theme Studio draft",
  );
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("dialog", { name: "Save your changes?" }).waitFor();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await page.getByRole("heading", { name: "Themes", exact: true }).waitFor();
  assert(
    (await page
      .getByText("Continue your unsaved theme", { exact: true })
      .count()) === 0,
    "discarding an editor draft should also clear the in-memory recovery card",
  );

  await page.evaluate(() => {
    window.localStorage.setItem(
      "vibetv.controlCenter.themeStudioDraft",
      JSON.stringify({
        schemaVersion: 1,
        recovery: {
          document: {
            assets: {},
            packName: "Recovered Draft",
            spec: {
              bgColor: "#000000",
              fallbackTheme: "mini",
              primitives: [
                {
                  color: "#FFFFFF",
                  height: 20,
                  type: "rect",
                  width: 20,
                  x: 10,
                  y: 10,
                },
              ],
              themeId: "recovered-draft",
              themeRev: 1,
              themeSpecVersion: 1,
            },
          },
          source: "blank",
          updatedAt: "2026-07-15T10:00:00.000Z",
        },
      }),
    );
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /^(Themes|Theme Library)$/ }).click();
  await page
    .getByText("Continue your unsaved theme", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.getByText("Unsaved changes", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("dialog", { name: "Save your changes?" }).waitFor();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.activeElement instanceof HTMLButtonElement &&
      document.activeElement.textContent?.trim() === "Library",
  );
  assert(
    await page
      .getByRole("button", { name: "Library", exact: true })
      .evaluate((button) => button === document.activeElement),
    "closing the leave dialog should return focus to Library",
  );
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await page.getByRole("heading", { name: "Themes", exact: true }).waitFor();
  assert(
    (await page
      .getByText("Continue your unsaved theme", { exact: true })
      .count()) === 0,
    "discarding a resumed recovery should remove the recovery card",
  );

  await page.evaluate(() => {
    window.localStorage.setItem(
      "vibetv.controlCenter.themeStudioDraft",
      "{broken-recovery",
    );
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /^(Themes|Theme Library)$/ }).click();
  await page
    .getByText("Theme storage needs attention", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Create Theme" }).click();
  assert(
    await page.getByRole("button", { name: "Save theme" }).isDisabled(),
    "invalid recovery data should lock theme saving until it is handled",
  );

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.close();
}

async function testAIThemeBuilderCandidateFlow(browser, appUrl) {
  const localAppUrl = "http://127.0.0.1:47832/control-center";
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const conceptRequests = [];
  let conceptResponses = 0;
  let credential = "";
  let verificationShouldFail = false;
  let verificationRequests = 0;
  const conceptPNG = readFileSync(
    join(root, "public", "images", "vibetv-device-overview.png"),
  ).toString("base64");

  await routeLocalCompanionAppThroughLocalNext(page, appUrl);
  await routeCompanionOnline(page, [], () => {}, {
    companionVersion: "1.0.33",
    device: { ...companionDevice, firmware: "1.0.32" },
  });
  await page.route("**/v1/ai-theme/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/v1/ai-theme/capabilities") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          enabled: true,
          providers: [{ id: "openai", configured: credential !== "" }],
        }),
      });
      return;
    }
    if (pathname.endsWith("/credential") && route.request().method() === "PUT") {
      credential = JSON.parse(route.request().postData() || "{}").apiKey || "";
      await route.fulfill({ status: 200, contentType: "application/json", body: `{"configured":true}` });
      return;
    }
    if (pathname.endsWith("/verify")) {
      verificationRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 200));
      await route.fulfill({
        status: verificationShouldFail ? 401 : 200,
        contentType: "application/json",
        body: verificationShouldFail
          ? `{"error":{"code":"provider_auth_failed"}}`
          : `{"verified":true}`,
      });
      return;
    }
    if (pathname === "/v1/ai-theme/concepts") {
      const conceptRequest = JSON.parse(route.request().postData() || "{}");
      conceptRequests.push(conceptRequest);
      const animated =
        /animate|sprite|gif/i.test(conceptRequest.prompt || "") ||
        (
          conceptRequest.previous?.style?.animationMode === "four_frame" &&
          !/static|still|stop animat/i.test(conceptRequest.prompt || "")
        );
      await new Promise((resolve) => setTimeout(resolve, 250));
      conceptResponses += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          imageBase64: conceptPNG,
          imageContentType: "image/png",
          animation: animated ? {
            fps: 4,
            keyColor: "#FF00FF",
            spriteSheetBase64: conceptPNG,
          } : undefined,
          style: {
            packName: "Moon Cat",
            title: "CAT MODE",
            notes: "A warm moonlit cat screenmaster.",
            artPrompt: "A large orange pixel cat beneath a cream moon.",
            environmentPrompt: "A moonlit clearing with no animals.",
            animationMode: animated ? "four_frame" : "static",
            animationPrompt: animated ? "The cat gently swishes its tail." : "",
            backgroundColor: "#081426",
            panelColor: "#101F36",
            textColor: "#FFF3CF",
            sessionColor: "#F6B85F",
            weeklyColor: "#EF6A8A",
            progressStyle: "segments",
            borderRadius: 3,
          },
        }),
      });
      return;
    }
    await route.fulfill({ status: 404, body: "not found" });
  });

  await page.goto(localAppUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /^(Themes|Theme Library)$/ }).click();
  await page.getByRole("button", { name: "Create Theme" }).click();
  const aiHeading = page.getByRole("heading", { name: "AI Theme Builder" });
  await aiHeading.waitFor();
  assert(
    (await page.getByRole("button", { name: "AI Draft", exact: true }).count()) === 0,
    "AI chat should be visible without a separate header action",
  );
  const aiHeadingBox = await aiHeading.boundingBox();
  const inspectorBox = await page.getByText("Inspector", { exact: true }).boundingBox();
  assert(
    aiHeadingBox && inspectorBox && aiHeadingBox.y < inspectorBox.y,
    "AI chat should sit above the Inspector in the right column",
  );
  const originalName = await page.locator("[data-theme-studio-root] h3").first().textContent();
  const keyInput = page.getByLabel("OpenAI key");
  await keyInput.fill("sk-playwright-temporary-key-123456789");
  await page.getByRole("button", { name: "Store key" }).click();
  await page.getByText("Key stored securely. Test it before creating a concept.").waitFor();
  assert(credential.length > 0, "AI setup should send the key to the local Companion");
  assert((await keyInput.count()) === 0, "AI key input should leave browser state after setup");
  assert(
    !(await page.evaluate((value) => Object.values(window.localStorage).some((entry) => String(entry).includes(value)), credential)),
    "AI credentials must never be written to localStorage",
  );
  const testKey = page.getByRole("button", { name: "Test key" });
  await testKey.click();
  const testingKey = page.getByRole("button", { name: "Testing…" });
  await testingKey.waitFor();
  assert(await testingKey.isDisabled(), "key testing should disable repeat verification");
  await page.getByText("Key verified for image generation.").waitFor();
  assert(verificationRequests === 1, "key testing should make one verification request");

  verificationShouldFail = true;
  await testKey.click();
  await testingKey.waitFor();
  await page.getByText("OpenAI rejected this key.").waitFor();
  verificationShouldFail = false;
  await testKey.click();
  await page.getByText("Key verified for image generation.").waitFor();

  const prompt = page.getByLabel("AI theme prompt");
  await prompt.fill("Create a neon usage theme");
  const create = page.getByRole("button", { name: "Create theme", exact: true });
  await create.evaluate((button) => {
    button.click();
    button.click();
  });
  const creating = page.locator('button:has-text("Creating…")').first();
  await creating.waitFor();
  assert(await creating.isDisabled(), "generation should become busy immediately");
  assert(conceptRequests.length === 1, "double-clicking Create theme must start only one request");
  await page.getByRole("heading", { name: "Moon Cat" }).waitFor();
  await page.getByText("Theme created. You can edit it now or ask for changes.").waitFor();
  const editablePreview = page.getByLabel("Editable 240x240 preview");
  await editablePreview.waitFor();
  assert(
    (await page.getByLabel("AI candidate theme preview").count()) === 0,
    "AI generation should not create an isolated preview stage",
  );
  assert(
    (await editablePreview.locator('[aria-label^="Select "]').count()) > 0,
    "generated AI layers should be editable immediately",
  );
  assert((await prompt.inputValue()) === "", "successful AI draft creation should clear the prompt input");
  const undo = page.getByRole("button", { name: "Undo" });
  const redo = page.getByRole("button", { name: "Redo" });
  assert(await undo.isEnabled(), "creating an AI theme should add one undo step");
  await undo.click();
  assert(
    (await page.locator("[data-theme-studio-root] h3").first().textContent()) === originalName,
    "one Undo should restore the document from before AI generation",
  );
  assert(await undo.isDisabled(), "AI generation should add exactly one undo step");
  await redo.click();
  await page.getByRole("heading", { name: "Moon Cat" }).waitFor();
  const generatedSprite = editablePreview.getByLabel("Select sprite 1");
  await generatedSprite.click();
  const spriteBox = await generatedSprite.boundingBox();
  assert(spriteBox, "generated sprite should expose a canvas drag target");
  await page.mouse.move(
    spriteBox.x + spriteBox.width / 2,
    spriteBox.y + spriteBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    spriteBox.x + spriteBox.width / 2,
    spriteBox.y + spriteBox.height / 2 + 20,
    { steps: 4 },
  );
  await page.mouse.up();
  assert(
    Number(await page.getByLabel("Y", { exact: true }).inputValue()) > 0,
    "generated image layers should move by dragging on the canvas",
  );
  await page.getByLabel("X", { exact: true }).fill("999");
  assert(
    (await page.getByLabel("X", { exact: true }).inputValue()) === "0",
    "geometry inputs should clamp values that would move a layer outside 240x240",
  );
  assert(
    (await page.getByText(/must stay inside 240x240/).count()) === 0,
    "clamped geometry inputs should not create an avoidable validation error",
  );

  await prompt.fill("Animate the cat as a four-frame sprite");
  await page.getByRole("button", { name: "Send change", exact: true }).click();
  await page.getByText("4-frame animation created. Drag or resize the sprite, or ask for another change.").waitFor();
  assert(conceptRequests.at(-1)?.previous?.imageBase64 === conceptPNG, "Refine must send the previous concept image only for the edit request");
  assert(conceptRequests.at(-1)?.previous?.animationSheetBase64 === undefined, "A static refine should not upload an animation sheet");
  assert((await editablePreview.locator('[aria-label^="Select sprite"]').count()) === 2, "AI animation should be embedded over a separate static theme image");
  const animatedSprite = editablePreview.locator('[aria-label^="Select sprite"]').last();
  await animatedSprite.click();
  assert((await page.getByLabel("Frames", { exact: true }).inputValue()) === "4", "AI animation should expose exactly four editable sprite frames");
  assert((await page.getByLabel("FPS", { exact: true }).inputValue()) === "4", "AI animation should play at four frames per second");
  await prompt.fill("Make the animated cat larger");
  await page.getByRole("button", { name: "Send change", exact: true }).click();
  await waitForCondition(() => conceptResponses >= 3, "animated chat refinement should complete");
  await page.getByRole("button", { name: "Send change", exact: true }).waitFor();
  assert(conceptRequests.at(-1)?.previous?.style?.animationMode === "four_frame", "Chat refinements should preserve the four-frame animation mode");
  assert(conceptRequests.at(-1)?.previous?.animationSheetBase64 === conceptPNG, "Animated refinements should upload the sprite sheet as reference");
  assert(conceptRequests.at(-1)?.previous?.spriteSheetBase64 === undefined, "Animated refinements must keep the sprite sheet inside the previous concept envelope");
  await page.waitForTimeout(400);
  assert(
    !(await page.evaluate(() => Object.values(window.localStorage).some((entry) => String(entry).includes("CBI1")))),
    "AI screenmaster image data must never be written to localStorage",
  );
  assert(
    (await page.getByRole("button", { name: "Apply", exact: true }).count()) === 0,
    "AI updates should not require a separate Apply action",
  );

  await page.getByRole("button", { name: "Start over", exact: true }).click();
  await page.getByLabel("Editable 240x240 preview").waitFor();
  assert(
    (await page.locator("[data-theme-studio-root] h3").first().textContent()) === "New Theme",
    "Start over should create a new blank document",
  );
  assert(
    (await editablePreview.locator('[aria-label^="Select "]').count()) === 1 &&
      (await editablePreview.getByLabel("Select rect 1").count()) === 1,
    "Start over should remove generated layers and leave only the blank canvas",
  );
  assert(
    (await page.getByText("Make the animated cat larger", { exact: true }).count()) === 0,
    "Start over should remove old prompt history from the panel",
  );

  await page.setViewportSize({ width: 800, height: 900 });
  assert(
    (await page.getByRole("button", { name: "AI Draft", exact: true }).count()) === 0,
    "mobile layout should not add a separate AI action",
  );
  await page.getByRole("button", { name: "Properties", exact: true }).click();
  const aiSheet = page.getByRole("dialog", { name: "Inspector" });
  await aiSheet.getByRole("heading", { name: "AI Theme Builder" }).waitFor();
  await aiSheet.getByLabel("AI theme prompt").fill("Create a compact mobile theme");
  await aiSheet.getByRole("button", { name: "Create theme", exact: true }).click();
  await aiSheet.getByText("Theme created. You can edit it now or ask for changes.").waitFor();
  await aiSheet.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByLabel("Editable 240x240 preview").waitFor();

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.close();
}

async function testInstallLinkKeepsRequestedTheme(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  let settingsCalls = 0;
  await routeCompanionOnline(page, installRequests, () => {
    settingsCalls += 1;
  });

  await page.goto(`${appUrl}/install/synthwave`, {
    waitUntil: "domcontentloaded",
  });
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

  await page.goto(`${appUrl}/install/synthwave`, {
    waitUntil: "domcontentloaded",
  });
  await waitForCondition(
    () => settingsCalls >= 1,
    "expected settings refresh before theme install status check",
  );

  const installButton = page
    .getByRole("listitem")
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

  await page.goto(`${appUrl}/install/synthwave`, {
    waitUntil: "domcontentloaded",
  });
  await waitForCondition(
    () => settingsCalls >= 1,
    "expected settings refresh before theme install progress check",
  );

  const installButton = page
    .getByRole("listitem")
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

  await page.goto(`${appUrl}/install/synthwave`, {
    waitUntil: "domcontentloaded",
  });
  await waitForCondition(
    () => settingsCalls >= 1,
    "expected settings refresh before customer log copy check",
  );

  const installButton = page
    .getByRole("listitem")
    .filter({ hasText: "Fixture Synthwave Theme" })
    .getByRole("button", { name: "Install" });
  await installButton.waitFor({ timeout: 10_000 });
  await installButton.click();
  await page
    .getByText("Install failed", { exact: true })
    .waitFor({ timeout: 10_000 });

  await clickNavigation(page, "Support");
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

  await page.goto(`${appUrl}/install/synthwave`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("heading", { name: "Themes" }).waitFor({
    timeout: 10_000,
  });
  assert(
    (await page.getByRole("button", { name: "VibeTV is on WiFi" }).count()) ===
      0,
    "A VibeTV found by the startup scan must not show the no-results WiFi guide",
  );
  await waitForCondition(
    () => settingsCalls >= 1,
    "expected settings refresh after pairing",
  );
  await assertSelectedThemeRow(page, "Fixture Synthwave Theme");
  const installButton = page
    .getByRole("listitem")
    .filter({ hasText: "Fixture Synthwave Theme" })
    .getByRole("button", { name: "Install" });
  await installButton.waitFor({ timeout: 10_000 });
  assert(
    await installButton.isEnabled(),
    "paired VibeTV should unlock install",
  );
  assert(
    pairRequests.length === 1,
    "the single discovered VibeTV should connect once",
  );
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
  let settingsCalls = 0;
  await routeCompanionOnline(page, installRequests, () => {
    settingsCalls += 1;
  });

  await page.goto(`${appUrl}/install/missing-pack`, {
    waitUntil: "domcontentloaded",
  });

  await waitForCondition(
    () => settingsCalls >= 1,
    "expected settings refresh for missing pack readiness check",
  );
  await assertSelectedThemeRow(page, "Fixture Missing Pack Theme");
  const lockedButton = page
    .getByRole("listitem")
    .filter({ hasText: "Fixture Missing Pack Theme" })
    .getByRole("button", { name: "Unavailable" });
  await lockedButton.waitFor({ timeout: 10_000 });
  assert(
    await lockedButton.isDisabled(),
    "theme without a pack URL must stay disabled",
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
    .getByRole("listitem")
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
    .getByRole("listitem")
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

  await page.goto("https://app.vibetv.shop/", {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByRole("heading", { name: "Mac App download not ready" })
    .waitFor({
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
  await clickNavigation(page, "Updates");
  const unavailableButton = page.getByRole("button", {
    name: "Update",
    exact: true,
  });
  await unavailableButton.waitFor({ timeout: 10_000 });
  assert(
    await unavailableButton.isDisabled(),
    "Disabled DMG flag must stay disabled",
  );
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
    companionApp,
    companionRuntime,
    installationMode = "dmg",
    legacyCompanionRelease = false,
    device = companionDevice,
    onDiscover,
    onPair,
    onRepair,
    onSelect,
    onSearch,
    onRequest = () => {},
    onReset,
    resetError,
    onUpdate,
    onMacAppUpdate,
    onThemeInstallRequest,
    installStatusSequence,
    updateStatusSequence,
    macAppUpdateStatusSequence,
    macAppUpdateStatusFailures = 0,
    macAppUpdateReconnectVersion,
    dropBoardAfterFirmwareUpdate = false,
    deviceAfterFirmwareUpdate,
    usageResponse,
    usageStatus = 200,
    displayFrameStatus = 200,
    displayFrameResponse,
    displayFrameUnavailableResponses = 0,
    repairError = false,
    repairErrorDevice,
    selectError = false,
    searchDevices,
    searchError,
    searchDelayMs = 0,
    firstStatusDelayMs = 0,
    statusDelayAfterFirstMs = 0,
    settingsDelayMs = 0,
    onSettingsResponse = () => {},
    statusDeviceSequence,
    firmwareStatusDeviceSequence,
    statusThemeInstallJob,
    statusFirmwareUpdateJob,
    statusFailuresAfter = 0,
    providerSetup = readyProviderSetup(),
    onProviderRetry,
    onOpenCodexBar,
  } = {},
) {
  let currentDevice = device;
  let currentCompanionVersion = companionVersion;
  let activeInstallJobId = statusThemeInstallJob?.id || "";
  let currentStatusThemeInstallJob = statusThemeInstallJob;
  let installStatusIndex = 0;
  let activeUpdateJobId = "";
  let updateStatusIndex = 0;
  let activeMacAppUpdateJobId = "";
  let macAppUpdateStatusIndex = 0;
  let macAppUpdateStatusFailuresRemaining = macAppUpdateStatusFailures;
  let statusRequestCount = 0;
  let firmwareStatusIndex = 0;
  let displayFrameRequestCount = 0;
  let currentProviderSetup = providerSetup;
  const handler = async (route) => {
    const pathname = companionPath(route);
    onRequest(pathname, route.request().method());
    if (pathname === "/v1/providers/retry") {
      currentProviderSetup =
        onProviderRetry?.(currentProviderSetup) || currentProviderSetup;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, providerSetup: currentProviderSetup }),
      });
      return;
    }
    if (pathname === "/v1/providers/open-codexbar") {
      currentProviderSetup =
        onOpenCodexBar?.(currentProviderSetup) || currentProviderSetup;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, providerSetup: currentProviderSetup }),
      });
      return;
    }
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
        currentDevice = deviceAfterFirmwareUpdate
          ? {
              ...deviceAfterFirmwareUpdate,
              firmware: nextStatus.result.firmware,
            }
          : {
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
      currentStatusThemeInstallJob = {
        ...(currentStatusThemeInstallJob || {}),
        id: activeInstallJobId || "install-job-1",
        startedAt:
          currentStatusThemeInstallJob?.startedAt ||
          "2026-06-23T12:00:00.000Z",
        ...nextStatus,
      };
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
          job: currentStatusThemeInstallJob,
        }),
      });
      return;
    }
    if (pathname === "/v1/themes/install") {
      const request = route.request();
      const requestUrl = new URL(request.url());
      const postData = request.postData() || "";
      const postDataBuffer = request.postDataBuffer();
      installRequests.push(postData);
      onThemeInstallRequest?.({
        body: postDataBuffer ? Buffer.from(postDataBuffer) : Buffer.alloc(0),
        headers: request.headers(),
        method: request.method(),
        url: request.url(),
      });
      const parsed = parseJSON(postData);
      if (parsed?.async || requestUrl.searchParams.get("async") === "true") {
        activeInstallJobId = "install-job-1";
        currentStatusThemeInstallJob = {
          id: activeInstallJobId,
          themeId:
            requestUrl.searchParams.get("themeId") || parsed?.themeId || "",
          themeName:
            requestUrl.searchParams.get("themeName") || parsed?.themeName || "",
          phase: "installing",
          message: "Preparing theme files.",
          progress: 10,
          startedAt: "2026-06-23T12:00:00.000Z",
          logs: ["Preparing theme files."],
        };
        await route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            job: currentStatusThemeInstallJob,
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
      displayFrameRequestCount += 1;
      if (displayFrameRequestCount <= displayFrameUnavailableResponses) {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ ok: false }),
        });
        return;
      }
      if (displayFrameStatus !== 200) {
        await route.fulfill({
          status: displayFrameStatus,
          contentType: "application/json",
          body: JSON.stringify({ ok: false }),
        });
        return;
      }
      if (displayFrameResponse !== undefined) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(displayFrameResponse),
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
      if (searchError) {
        await route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: searchError }),
        });
        return;
      }
      const devices = onSearch?.(currentDevice) ||
        searchDevices || [
          {
            target: currentDevice?.target || companionDevice.target,
            deviceId: currentDevice?.deviceId || "fixture-device-1",
            board: currentDevice?.board || companionDevice.board,
            firmware: currentDevice?.firmware || companionDevice.firmware,
            networkMode: "station",
            known: Boolean(currentDevice?.target),
            active: Boolean(currentDevice?.deviceId),
          },
        ];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, devices }),
      });
      return;
    }
    if (pathname === "/v1/device/select") {
      if (selectError) {
        await route.fulfill({
          status: 502,
          contentType: "application/json",
          body: JSON.stringify({
            ok: false,
            error: {
              code: "device_selection_failed",
              message: "The selected VibeTV could not be connected.",
              nextAction: "Keep both VibeTVs powered on, then try again.",
            },
          }),
        });
        return;
      }
      const postData = route.request().postData() || "";
      const parsed = parseJSON(postData);
      const nextDevice = onSelect?.(postData, currentDevice) || {
        ...companionDevice,
        target: parsed?.target || currentDevice?.target,
        deviceId: parsed?.expectedDeviceId || currentDevice?.deviceId,
      };
      currentDevice = {
        ...nextDevice,
        connected: true,
        paired: true,
        ready: true,
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, device: currentDevice }),
      });
      return;
    }
    if (pathname === "/v1/device/repair") {
      if (repairError) {
        if (repairErrorDevice) {
          currentDevice = repairErrorDevice;
        }
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
      if (resetError) {
        await route.fulfill({
          status: resetError.status || 409,
          contentType: "application/json",
          body: JSON.stringify({
            ok: false,
            error: resetError.error,
          }),
        });
        return;
      }
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
            companionApp,
            companionRuntime,
          ),
          device: currentDevice,
          providerSetup: currentProviderSetup,
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
      if (statusFailuresAfter > 0 && statusRequestCount > statusFailuresAfter) {
        await route.abort("failed");
        return;
      }
      if (
        Array.isArray(statusDeviceSequence) &&
        statusDeviceSequence.length > 0
      ) {
        currentDevice =
          statusDeviceSequence[
            Math.min(statusRequestCount - 1, statusDeviceSequence.length - 1)
          ];
      }
      if (
        activeUpdateJobId &&
        Array.isArray(firmwareStatusDeviceSequence) &&
        firmwareStatusDeviceSequence.length > 0
      ) {
        currentDevice =
          firmwareStatusDeviceSequence[
            Math.min(
              firmwareStatusIndex,
              firmwareStatusDeviceSequence.length - 1,
            )
          ];
        firmwareStatusIndex += 1;
      }
      const responseDevice = currentDevice;
      if (statusRequestCount === 1 && firstStatusDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, firstStatusDelayMs));
      } else if (statusRequestCount > 1 && statusDelayAfterFirstMs > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, statusDelayAfterFirstMs),
        );
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
            companionApp,
            companionRuntime,
          ),
          providerSetup: currentProviderSetup,
          device: responseDevice,
          ...(statusFirmwareUpdateJob
            ? { firmwareUpdate: statusFirmwareUpdateJob }
            : {}),
          ...(currentStatusThemeInstallJob
            ? { themeInstall: currentStatusThemeInstallJob }
            : {}),
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
      const responseDevice = currentDevice;
      if (settingsDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, settingsDelayMs));
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          settings: { display: { brightnessPercent: 50 } },
          device: responseDevice,
        }),
      });
      onSettingsResponse();
      return;
    }
    if (pathname === "/v1/diagnostics") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          schemaVersion: 2,
          reportType: "control_center",
          generatedAt: "2026-06-19T12:00:00.000Z",
          environment: {
            os: "darwin",
            arch: "arm64",
            goVersion: "go1.25",
            pid: 123,
          },
          configuration: {
            deviceTarget: "http://192.168.178.163",
            deviceId: "wifi-vibetv",
            hasPairingToken: true,
            knownDeviceCount: 1,
          },
          networkDiscovery: {
            attempted: true,
            vibeTVFound: true,
            devices: [
              {
                target: "http://192.168.178.163",
                deviceId: "wifi-vibetv",
                board: "esp8266_smalltv_st7789",
                firmware: "1.0.32",
                networkMode: "station",
                known: true,
                active: true,
              },
            ],
          },
          debug: {
            token: "raw-token",
            apiKey: "raw-api-key",
            log: "Authorization: Basic raw-basic X-VibeTV-Token: raw-header CODEXBAR_DISPLAY_DEVICE_TOKEN=raw-env https://example.test/?token=raw-query https://alice:raw-userinfo@example.test/path",
          },
          companion: companionPayload(
            currentCompanionVersion,
            companionFeatures,
            legacyCompanionRelease,
            installationMode,
            companionApp,
            companionRuntime,
          ),
          providerSetup: currentProviderSetup,
          device: currentDevice,
          checks: [
            {
              name: "companion",
              status: "pass",
              detail:
                "Companion API target http://192.168.178.163 is reachable.",
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
    const sourceUrl = new URL(route.request().url());
    await fulfillRouteFromNext(
      route,
      `${appUrl}${sourceUrl.pathname}${sourceUrl.search}`,
    );
  });
}

async function routeLocalCompanionAppThroughLocalNext(page, appUrl) {
  await page.route("http://127.0.0.1:47832/control-center**", async (route) => {
    const sourceUrl = new URL(route.request().url());
    const relativePath = sourceUrl.pathname.slice("/control-center".length);
    const targetPath = relativePath || "/";
    await fulfillRouteFromNext(
      route,
      `${appUrl}${targetPath}${sourceUrl.search}`,
    );
  });
  await page.route("http://127.0.0.1:47832/_next/**", async (route) => {
    const sourceUrl = new URL(route.request().url());
    await fulfillRouteFromNext(
      route,
      `${appUrl}${sourceUrl.pathname}${sourceUrl.search}`,
    );
  });
}

async function readTrackedThemeRenderPackFixture(themeId) {
  const themeDir = join(root, "../../theme-packs", themeId);
  const manifest = JSON.parse(
    await readFile(join(themeDir, "manifest.json"), "utf8"),
  );
  const specFile = String(manifest.themeSpec?.file || "theme.json").trim();
  assert(
    specFile && !specFile.startsWith("/") && !specFile.includes(".."),
    `tracked theme fixture has an unsafe spec path: ${specFile}`,
  );
  const spec = JSON.parse(await readFile(join(themeDir, specFile), "utf8"));
  const assets = {};

  for (const entry of manifest.assets || []) {
    const devicePath = String(entry.path || "").trim();
    const file = String(entry.file || "").trim();
    assert(
      devicePath && file && !file.startsWith("/") && !file.includes(".."),
      `tracked theme fixture has an unsafe asset: ${devicePath} -> ${file}`,
    );
    const contentType =
      String(entry.contentType || "").trim() || "application/octet-stream";
    const data = await readFile(join(themeDir, file));
    const textAsset =
      /^text\//i.test(contentType) || /\.(cbi|cba)$/i.test(file);
    assets[devicePath] = {
      contentType,
      data: data.toString(textAsset ? "utf8" : "base64"),
      encoding: textAsset ? "text" : "base64",
    };
  }

  return {
    ok: true,
    themeId: manifest.id || themeId,
    name: manifest.name || themeId,
    spec,
    specPath: manifest.themeSpec?.path,
    assets,
  };
}

async function fulfillRouteFromNext(route, targetUrl) {
  const request = route.request();
  const response = await fetch(targetUrl, {
    method: request.method(),
    headers: request.headers(),
    body: request.method() === "GET" ? undefined : request.postDataBuffer(),
  });
  const headers = {};
  response.headers.forEach((value, key) => {
    if (
      !["content-encoding", "content-length", "transfer-encoding"].includes(key)
    ) {
      headers[key] = value;
    }
  });
  await route.fulfill({
    status: response.status,
    headers,
    body: Buffer.from(await response.arrayBuffer()),
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
    usageResponse && typeof usageResponse === "object"
      ? usageResponse
      : fallback;
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
  const session = clampPercent(provider.session);
  const weekly = clampPercent(provider.weekly);
  return {
    v: 1,
    provider: provider.id,
    label: provider.label || provider.id,
    ...(session > 0 ? { session } : {}),
    ...(weekly > 0 ? { weekly } : {}),
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

function isDirectDeviceWriteUrl(rawUrl) {
  const url = new URL(rawUrl);
  return (
    url.pathname === "/assets" ||
    url.pathname.startsWith("/assets/") ||
    url.pathname === "/theme/active" ||
    url.pathname === "/frame"
  );
}

function companionPayload(
  version,
  features,
  legacyRelease = false,
  installationMode = "dmg",
  app,
  runtime,
) {
  const payload = {
    version,
    features,
  };
  if (installationMode) {
    payload.installationMode = installationMode;
  }
  if (app) {
    payload.app = app;
  }
  if (runtime) {
    payload.runtime = runtime;
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
    (await page.getByText(/open the DMG|Applications/i).count()) === 0,
    "Setup must not explain manual DMG handling to customers",
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
    (await page
      .getByRole("button", { name: "Copy terminal command" })
      .count()) === 0,
    "Verified DMG setup must not expose the Terminal install command",
  );
  assert(
    (await page.locator("code").count()) === 0,
    "Verified DMG setup must not render a hidden Terminal install command",
  );

  if (startDownload) {
    await dmgDownload.evaluate((element) => {
      element.addEventListener("click", (event) => event.preventDefault(), {
        once: true,
      });
      element.click();
    });
    await page.waitForTimeout(0);
  }

  return dmgDownload;
}

async function assertThemeLibraryLockedBehindSetup(page) {
  assert(
    (await page.getByRole("navigation", { name: "Control Center" }).count()) ===
      0,
    "Control Center navigation must stay hidden until startup is complete",
  );
  assert(
    (await page.getByRole("button", { name: "Setup", exact: true }).count()) ===
      0,
    "No Setup tab may be exposed while startup is incomplete",
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
  const row = page.getByRole("listitem").filter({ hasText: themeTitle });
  await row.waitFor({ timeout: 10_000 });
  assert(
    (await row.getAttribute("data-variant")) === "muted",
    `${themeTitle} should be the selected theme row`,
  );
}

async function assertThemeRowNotSelected(page, themeTitle) {
  const row = page.getByRole("listitem").filter({ hasText: themeTitle });
  await row.waitFor({ timeout: 10_000 });
  assert(
    (await row.getAttribute("data-variant")) !== "muted",
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

  for (const hiddenText of hiddenSetupText) {
    assert(
      (await page.getByText(hiddenText).count()) === 0,
      `setup should not show internal text: ${hiddenText}`,
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
    (await page.getByRole("link", { name: "Update" }).count()) === 0,
    "Updates must not show a DMG link without an enabled, verified asset",
  );
  assert(
    (await page.getByRole("link", { name: "Update" }).count()) === 0,
    "Legacy migration must not show a DMG link without an enabled, verified asset",
  );
}

async function assertNoThemeLibraryReleaseDiagnostics(page) {
  const diagnostics = [
    "Companion installer is not published",
    "Customers cannot install Companion",
    "Companion release check failed. Check your connection",
  ];

  for (const diagnostic of diagnostics) {
    assert(
      (await page.getByText(diagnostic).count()) === 0,
      `Theme Library should not show release diagnostic: ${diagnostic}`,
    );
  }
}

async function getNavigationButton(page, name) {
  await page.locator("main.control-center-shell").waitFor({ timeout: 10_000 });
  const mobileButton = page
    .getByRole("navigation", { name: "Control Center mobile", exact: true })
    .getByRole("button", { name })
    .first();
  if ((await mobileButton.count()) > 0 && (await mobileButton.isVisible())) {
    return mobileButton;
  }
  const navigation = page.getByRole("navigation", {
    name: "Control Center",
    exact: true,
  });
  const button = navigation.getByRole("button", { name });
  for (let index = 0; index < (await button.count()); index += 1) {
    if (await button.nth(index).isVisible()) {
      return button.nth(index);
    }
  }
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  return mobileButton;
}

async function clickNavigation(page, name) {
  await page.waitForTimeout(350);
  await (await getNavigationButton(page, name)).click({ timeout: 10_000 });
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
    repairTimeoutUses.length === 3,
    `Exactly select, repair, and reload-display must use the 90 second timeout, got ${repairTimeoutUses.length} uses`,
  );
  const statusPollGuards =
    source.match(/if \(statusPollInFlight\.current\)/g) || [];
  assert(
    statusPollGuards.length === 2,
    `Startup and Control Center status polling must both be single-flight, got ${statusPollGuards.length} guards`,
  );
}

async function assertLocalCompanionProxySafetyContract() {
  const source = await readFile(
    join(root, "src/app/api/local-companion/[...path]/route.ts"),
    "utf8",
  );
  assert(
    source.includes("signal: request.signal"),
    "The local Companion proxy must cancel its upstream fetch when the browser request is aborted",
  );
  assert(
    source.includes("localProxyTargetsIncomingServer(targetUrl, request.nextUrl)"),
    "The local Companion proxy must reject a target that points back to its own Next server",
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
