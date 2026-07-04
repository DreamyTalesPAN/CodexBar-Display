import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
const viewport = { width: 390, height: 844 };
const desktopViewport = { width: 1280, height: 900 };
const smokeOnly = process.argv.includes("--smoke");
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
      name: "release-notes.txt",
      browser_download_url: "https://downloads.example.test/release-notes.txt",
    },
  ],
};

const companionDevice = {
  target: "http://vibetv.local",
  connected: true,
  paired: true,
  board: "esp8266_smalltv_st7789",
  firmware: "1.0.32",
  activeTheme: "clippy",
};

async function main() {
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
      );
      await testInstallLinkKeepsRequestedTheme(browser, appContext.appUrl);
      await testUpdatesShowTerminalCommandWithoutPackageAssets(
        browser,
        appContext.appUrl,
      );
      console.log("control-center customer smoke tests passed");
      return;
    }
    await testSetupDoesNotRequestBrowserPermission(browser, appContext.appUrl);
    await testFixConnectionDoesNotRepairWhenMacAppIsOffline(
      browser,
      appContext.appUrl,
    );
    await testInstallThemeLinkStaysOnSetupWhenThemeLibraryLocked(
      browser,
      appContext.appUrl,
      fixtureServer,
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
    await testRunSetupAgainOpensMacAppInstallStepForOldMacApp(
      browser,
      appContext.appUrl,
    );
    await testSettingsStayCustomerOnly(browser, appContext.appUrl);
    await testUpdatesShowCustomerCompanionAction(browser, appContext.appUrl);
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
    await testVibeTVAddressCopyStaysCustomerOnly(browser, appContext.appUrl);
    await testSavedAddressDoesNotBlockAutomaticVibeTVSearch(
      browser,
      appContext.appUrl,
    );
    await testInstallLinkKeepsRequestedTheme(browser, appContext.appUrl);
    await testThemeInstallStatusStaysCustomerOnly(browser, appContext.appUrl);
    await testThemeInstallShowsIntermediateProgress(browser, appContext.appUrl);
    await testCustomerLogsStayCustomerOnly(browser, appContext.appUrl);
    await testUnpairedThemeDeepLinkAutoRepairs(browser, appContext.appUrl);
    await testThemeWithoutPackUrlStaysLocked(browser, appContext.appUrl);
    await testBoardIncompatibleThemeStaysLocked(browser, appContext.appUrl);
    await testFirmwareIncompatibleThemeStaysLocked(browser, appContext.appUrl);
    await assertCompanionReleaseApi(appContext.appUrl, {
      installerAsset: null,
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
      releaseUrl: scriptOnlyReleaseUrl,
    });
    app = appContext.app;
    await testScriptOnlyReleaseShowsSupportFallback(
      browser,
      appContext.appUrl,
      fixtureServer,
    );
    await assertCompanionReleaseApi(appContext.appUrl, {
      installerAsset: null,
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
    await testUpdatesShowTerminalCommandWithoutPackageAssets(
      browser,
      appContext.appUrl,
    );
    await assertCompanionReleaseApi(appContext.appUrl, {
      installerAsset: null,
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
    await assertCompanionReleaseApi(appContext.appUrl, {
      installerAsset: null,
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

async function startTestApp({ catalogUrl, firmwareUrl, releaseUrl }) {
  const appPort = await findFreePort();
  const appUrl = `http://127.0.0.1:${appPort}`;
  const app = startNext({ appPort, catalogUrl, firmwareUrl, releaseUrl });
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
    waitUntil: "networkidle",
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

async function testFixConnectionDoesNotRepairWhenMacAppIsOffline(
  browser,
  appUrl,
) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  const companionRequests = [];
  await routeCompanionMissing(page, installRequests, (pathname) => {
    companionRequests.push(pathname);
  });

  await page.goto(appUrl, {
    waitUntil: "networkidle",
  });
  await page.getByRole("heading", { name: "Set up your VibeTV" }).waitFor({
    timeout: 10_000,
  });
  assert(
    (await page.getByText("Mac App did not answer.").count()) === 0,
    "Mac App offline setup should not show an error before the customer checks it",
  );
  await page.getByRole("button", { name: "VibeTV is on WiFi" }).click();
  const macAppInstalledButton = page.getByRole("button", {
    name: "Mac App is installed",
  });
  await macAppInstalledButton.waitFor({ timeout: 10_000 });
  assert(
    await macAppInstalledButton.isDisabled(),
    "Mac App continue button should stay disabled until setup instructions are copied",
  );
  await page.getByRole("button", { name: "Copy prompt" }).click();
  await page
    .getByRole("button", { name: "Prompt copied" })
    .waitFor({ timeout: 10_000 });
  assert(
    !(await macAppInstalledButton.isDisabled()),
    "Mac App continue button should enable after setup instructions are copied",
  );
  await macAppInstalledButton.click();
  await page
    .getByText("Mac App did not answer.", { exact: false })
    .waitFor({ timeout: 10_000 });
  await page
    .getByText("Copy the prompt or terminal command above", { exact: false })
    .waitFor({ timeout: 10_000 });
  assert(
    (await page.getByRole("button", { name: "Fix connection" }).count()) === 0,
    "Fix connection should stay hidden when the Mac App is offline",
  );
  assert(
    !companionRequests.includes("/v1/device/repair"),
    "Mac App offline setup must not call device repair",
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
    waitUntil: "networkidle",
  });
  await page.getByRole("heading", { name: "Set up your VibeTV" }).waitFor({
    timeout: 10_000,
  });
  await assertThemeLibraryLockedBehindSetup(page);
  await assertNoSetupJargon(page);
  await page.getByRole("button", { name: "VibeTV is on WiFi" }).click();
  await page
    .getByRole("button", { name: "Copy prompt" })
    .waitFor({ timeout: 10_000 });
  await assertMacAppSetupUsesTerminalCommand(
    page,
    "/control-center/install/does-not-exist",
  );

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

  await page.goto(appUrl, { waitUntil: "networkidle" });
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

  await page.goto(appUrl, { waitUntil: "networkidle" });
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
  await page.getByRole("button", { name: "Setup" }).click();
  await page.getByRole("heading", { name: "Setup complete" }).waitFor({
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "Open Control Center" }).waitFor({
    timeout: 10_000,
  });
  assert(
    (await page.getByText("Connect VibeTV to WiFi").count()) === 0,
    "completed setup should not show the setup checklist",
  );
  assert(
    (await page.getByRole("button", { name: "Run setup again" }).count()) ===
      0,
    "completed setup should not show secondary setup actions",
  );
  assert(
    (await page.getByRole("button", { name: "Fix connection" }).count()) === 0,
    "completed setup should not show repair actions while healthy",
  );
  await page.getByRole("button", { name: "Open Control Center" }).click();
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

  await page.goto(appUrl, { waitUntil: "networkidle" });
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

  await page.goto(appUrl, { waitUntil: "networkidle" });
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

  await page.goto(appUrl, { waitUntil: "networkidle" });
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

  await page.goto(appUrl, { waitUntil: "networkidle" });
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

async function testRunSetupAgainOpensMacAppInstallStepForOldMacApp(
  browser,
  appUrl,
) {
  const page = await newCustomerPage(browser, appUrl, {
    viewport: desktopViewport,
  });
  const installRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    usageStatus: 404,
    usageResponse: "404 page not found",
  });

  await page.goto(appUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Usage" }).click();
  await page.getByText("Mac App update needed.").waitFor({
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "Setup" }).click();
  await page.getByRole("button", { name: "Run setup again" }).click();
  await page.getByRole("heading", { name: "Install Mac App" }).waitFor({
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "Copy prompt" }).waitFor({
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "Copy prompt" }).click();
  await page.getByRole("button", { name: "Mac App is installed" }).click();
  await page.getByText("Mac App update needed.").waitFor({
    timeout: 10_000,
  });
  await page.getByRole("button", { name: /Copy prompt|Prompt copied/ }).waitFor({
    timeout: 10_000,
  });

  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testUpdatesShowCustomerCompanionAction(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  const macAppUpdateRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    device: { ...companionDevice, firmware: "1.0.33" },
    onMacAppUpdate: (postData) => {
      macAppUpdateRequests.push(postData);
    },
    macAppUpdateStatusSequence: [
      {
        phase: "installing",
        message: "Installing Mac App.",
        progress: 70,
        logs: [
          "Preparing Mac App update.",
          "Downloading Mac App update.",
          "Installing Mac App.",
        ],
      },
      {
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
      },
    ],
  });

  await page.goto(appUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Updates" }).click();
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
    .filter({ hasText: "Mac App updated" })
    .waitFor({ timeout: 10_000 });
  await page.getByText("Mac App 1.0.99 is installed.").waitFor({
    timeout: 10_000,
  });
  await page.getByText("Installed version").waitFor({ timeout: 10_000 });
  await page.getByText("Latest version").waitFor({ timeout: 10_000 });
  assert(
    (await page.getByText("Mac App download").count()) === 0,
    "Updates should not show package download state",
  );

  const hiddenUpdatesText = ["Release installer", "Mac package", ".pkg"];
  for (const text of hiddenUpdatesText) {
    assert(
      (await page.getByText(text).count()) === 0,
      `Updates should not show package/release jargon: ${text}`,
    );
  }

  assert(macAppUpdateRequests.length === 1, "Mac App update should start once");
  assert(
    parseJSON(macAppUpdateRequests[0])?.version === "1.0.99",
    `Mac App update should request latest version, got ${macAppUpdateRequests[0]}`,
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

  await page.goto(appUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Updates" }).click();
  await page.getByRole("button", { name: "Update now" }).waitFor({
    timeout: 10_000,
  });
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

  await page.goto(appUrl, { waitUntil: "networkidle" });
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

async function testUpdatesShowTerminalCommandWithoutPackageAssets(
  browser,
  appUrl,
) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    companionFeatures: { themeInstallEnabled: true },
  });

  await page.goto(appUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Updates" }).click();
  await page.getByRole("button", { name: "Copy update command" }).waitFor({
    timeout: 10_000,
  });
  assert(
    (await page.getByText("Not ready yet").count()) === 0,
    "Updates should not show unavailable Mac App package state",
  );
  assert(
    (await page.getByText("Mac App download").count()) === 0,
    "Updates should hide Mac App download state",
  );

  assert(
    (await page.getByRole("button", { name: "Check again" }).count()) === 0,
    "Updates should not show a dead Mac App installer retry button",
  );
  assert(
    (await page.getByRole("link", { name: "Update Mac App" }).count()) === 0,
    "Updates should not show a Mac App package update link",
  );

  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testSupportReportExportsAppearAfterReportLoads(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  await routeCompanionOnline(page, installRequests);

  await page.goto(appUrl, { waitUntil: "networkidle" });
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

async function testVibeTVAddressCopyStaysCustomerOnly(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  await routeCompanionOnline(page, installRequests, () => {}, {
    device: {
      target: "",
      connected: false,
      paired: false,
    },
    repairError: true,
  });

  await page.goto(appUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "VibeTV is on WiFi" }).click();
  await page.getByLabel("VibeTV address").waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "Fix this address" }).waitFor({
    timeout: 10_000,
  });

  const hiddenAddressText = [
    "VibeTV target",
    "Search target",
    "http(s)",
    "valid port",
    "username",
    "password",
    "query",
    "fragment",
  ];
  for (const text of hiddenAddressText) {
    assert(
      (await page.getByText(text).count()) === 0,
      `VibeTV address setup should not show technical text: ${text}`,
    );
  }

  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testSavedAddressDoesNotBlockAutomaticVibeTVSearch(
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
      },
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

  await page.goto(appUrl, { waitUntil: "networkidle" });
  await page.getByText("VibeTV is connected").waitFor({ timeout: 10_000 });
  await waitForCondition(
    () => repairRequests.length >= 1,
    "expected automatic VibeTV repair to run",
  );

  const repairPayload = JSON.parse(repairRequests[0] || "{}");
  assert(
    repairPayload.target == null,
    `automatic repair should not force stale saved address, got ${repairRequests[0]}`,
  );
  assert(
    repairPayload.forcePair === true,
    `automatic repair should re-pair stale bindings, got ${repairRequests[0]}`,
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
    displayFrameStatus: 404,
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

  await page.goto(appUrl, { waitUntil: "networkidle" });
  await page.getByText("VibeTV is connected").waitFor({ timeout: 10_000 });
  await page.getByText("Mac App").waitFor({ timeout: 10_000 });
  await page.getByText("Online 1.0.33").waitFor({ timeout: 10_000 });
  await page.getByText("VibeTV firmware").waitFor({ timeout: 10_000 });
  await page.getByText("1.0.32").waitFor({ timeout: 10_000 });
  await page
    .getByRole("img", {
      name: /Rendered VibeTV theme synthwave showing Codex, 73% session remaining, 37% weekly remaining/,
    })
    .waitFor({ timeout: 10_000 });
  const renderedTheme = page.getByRole("img", {
    name: /Rendered VibeTV theme synthwave/,
  });
  await renderedTheme.getByText("USAGE").waitFor({ timeout: 10_000 });
  await renderedTheme
    .getByText("SESSION remaining")
    .waitFor({ timeout: 10_000 });
  await renderedTheme
    .getByText("WEEKLY remaining")
    .waitFor({ timeout: 10_000 });
  await renderedTheme.getByText("73%").waitFor({ timeout: 10_000 });
  await renderedTheme.getByText("37%").waitFor({ timeout: 10_000 });
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
      providers: [],
    },
  });

  await page.goto(appUrl, { waitUntil: "networkidle" });
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

    await page.goto(appUrl, { waitUntil: "networkidle" });
    const renderedTheme = page.getByRole("img", {
      name: new RegExp(
        `Rendered VibeTV theme ${theme.id} showing Codex, 73% session remaining, 37% weekly remaining`,
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

  await page.goto(appUrl, { waitUntil: "networkidle" });
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

  await page.goto(`${appUrl}/install/synthwave`, { waitUntil: "networkidle" });
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

  await page.goto(`${appUrl}/install/synthwave`, { waitUntil: "networkidle" });
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

  await page.goto(`${appUrl}/install/synthwave`, { waitUntil: "networkidle" });
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

  await page.goto(`${appUrl}/install/synthwave`, { waitUntil: "networkidle" });
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

async function testUnpairedThemeDeepLinkAutoRepairs(browser, appUrl) {
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
      device: { ...companionDevice, paired: false },
      onPair: (postData, currentDevice) => {
        pairRequests.push(postData);
        return { ...currentDevice, paired: true };
      },
    },
  );

  await page.goto(`${appUrl}/install/synthwave`, { waitUntil: "networkidle" });
  await waitForCondition(
    () => pairRequests.length === 1,
    "expected setup to repair and pair VibeTV automatically",
  );
  await waitForCondition(
    () => settingsCalls >= 2,
    "expected settings refresh after pairing",
  );
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
    pairRequests[0]?.includes('"forcePair":true'),
    `pairing repair request did not force pairing: ${pairRequests[0]}`,
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
    waitUntil: "networkidle",
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
    waitUntil: "networkidle",
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
    waitUntil: "networkidle",
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

async function testScriptOnlyReleaseShowsSupportFallback(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  await routeCompanionMissing(page, installRequests);

  await page.goto(`${appUrl}/install/synthwave`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Set up your VibeTV" }).waitFor({
    timeout: 10_000,
  });
  await assertThemeLibraryLockedBehindSetup(page);
  await assertNoSetupJargon(page);
  await page.getByRole("button", { name: "VibeTV is on WiFi" }).click();
  await page
    .getByRole("button", { name: "Copy prompt" })
    .waitFor({ timeout: 10_000 });
  await assertNoCompanionInstallLink(page);
  await assertNoLegacyCompanionDownloadActions(page);
  await assertNoThemeLibraryReleaseDiagnostics(page);
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testReleaseCheckFailureShowsNoDownloadActions(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  await routeCompanionMissing(page, installRequests);

  await page.goto(`${appUrl}/install/synthwave`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Set up your VibeTV" }).waitFor({
    timeout: 10_000,
  });
  await assertThemeLibraryLockedBehindSetup(page);
  await assertNoSetupJargon(page);
  await page.getByRole("button", { name: "VibeTV is on WiFi" }).click();
  await page
    .getByRole("button", { name: "Copy prompt" })
    .waitFor({ timeout: 10_000 });

  await assertNoLegacyCompanionDownloadActions(page);
  await assertNoThemeLibraryReleaseDiagnostics(page);
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testMissingAssetReleaseShowsNoDownloadActions(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  await routeCompanionMissing(page, installRequests);

  await page.goto(`${appUrl}/install/synthwave`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Set up your VibeTV" }).waitFor({
    timeout: 10_000,
  });
  await assertThemeLibraryLockedBehindSetup(page);
  await assertNoSetupJargon(page);
  await page.getByRole("button", { name: "VibeTV is on WiFi" }).click();
  await page
    .getByRole("button", { name: "Copy prompt" })
    .waitFor({ timeout: 10_000 });
  await assertNoLegacyCompanionDownloadActions(page);
  await assertNoThemeLibraryReleaseDiagnostics(page);
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function assertCompanionReleaseApi(
  appUrl,
  { installerAsset, latestVersion, status, updateAvailable },
) {
  const response = await fetch(`${appUrl}/api/companion/latest?version=1.0.32`);
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
    payload.installedVersion === "1.0.32",
    `release API installedVersion=${payload.installedVersion}, expected 1.0.32`,
  );
  assertCustomerApiMessage(payload.message);

  if (installerAsset) {
    assert(
      assetName(payload.installerDownloadUrl) === installerAsset,
      `release API installer asset=${assetName(
        payload.installerDownloadUrl,
      )}, expected ${installerAsset}`,
    );
  } else {
    assert(
      !payload.installerDownloadUrl,
      `release API should not expose installer URL, got ${payload.installerDownloadUrl}`,
    );
  }

  assert(
    !payload.packageDownloadUrls,
    `release API should not expose Mac package URLs, got ${JSON.stringify(
      payload.packageDownloadUrls,
    )}`,
  );
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
      macAppSelfUpdateEnabled: true,
    },
    companionVersion = "1.0.32",
    legacyCompanionRelease = false,
    device = companionDevice,
    onDiscover,
    onPair,
    onRepair,
    onReset,
    onUpdate,
    onMacAppUpdate,
    installStatusSequence,
    updateStatusSequence,
    macAppUpdateStatusSequence,
    dropBoardAfterFirmwareUpdate = false,
    usageResponse,
    usageStatus = 200,
    displayFrameStatus = 200,
    repairError = false,
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
  const handler = async (route) => {
    const pathname = companionPath(route);
    if (pathname === "/v1/mac-app/update/status") {
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
        (parsed?.forcePair
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
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          companion: companionPayload(
            currentCompanionVersion,
            companionFeatures,
            legacyCompanionRelease,
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
  const usageMode = provider.usageMode || usage.usageMode;
  const remaining = usageMode === "remaining";
  return {
    provider: provider.id,
    label: provider.label || provider.id,
    session: remaining
      ? clampPercent(provider.session)
      : invertPercent(provider.session),
    weekly: remaining
      ? clampPercent(provider.weekly)
      : invertPercent(provider.weekly),
    resetSecs: nonNegativeInteger(provider.resetSecs),
    usageMode: "remaining",
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

function invertPercent(value) {
  return 100 - clampPercent(value);
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

function companionPayload(version, features, legacyRelease = false) {
  const payload = {
    version,
    features,
  };
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

function startNext({ appPort, catalogUrl, firmwareUrl, releaseUrl }) {
  const child = spawn(
    process.execPath,
    [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(appPort)],
    {
      cwd: root,
      env: testEnv(catalogUrl, firmwareUrl, releaseUrl),
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
    env: testEnv(catalogUrl, firmwareUrl, releaseUrl),
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

function testEnv(catalogUrl, firmwareUrl, releaseUrl) {
  const resolvedFirmwareUrl =
    firmwareUrl || catalogUrl.replace(/\/[^/]+$/, "/firmware-manifest.json");
  return {
    ...process.env,
    CONTROL_CENTER_ALLOW_CATALOG_FALLBACK: "1",
    CONTROL_CENTER_COMPANION_RELEASE_API_URL: releaseUrl,
    CONTROL_CENTER_FIRMWARE_MANIFEST_URL: resolvedFirmwareUrl,
    CONTROL_CENTER_GITHUB_TOKEN: "",
    GITHUB_TOKEN: "",
    SHOPIFY_STORE_DOMAIN: "",
    SHOPIFY_SHOP_DOMAIN: "",
    SHOPIFY_STOREFRONT_ACCESS_TOKEN: "",
    SHOPIFY_STOREFRONT_PRIVATE_TOKEN: "",
    CONTROL_CENTER_DISPLAY_STATE_DIR: displayStateDir,
    THEME_PACK_CATALOG_URL: catalogUrl,
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

async function assertNoCompanionInstallLink(page) {
  const installLinkCount = await page
    .getByRole("link", { name: "Install Mac App" })
    .count();
  assert(
    installLinkCount === 0,
    `expected no Mac App package install link, got ${installLinkCount}`,
  );
}

async function assertMacAppSetupUsesTerminalCommand(page, expectedLocalPath) {
  await page.getByRole("tab", { name: "Manual setup" }).click();
  const command = (await page.locator("code").textContent()) || "";
  assert(
    command.includes("install-control-center-companion.sh"),
    `Terminal command should install through the hosted script, got ${command}`,
  );
  if (expectedLocalPath) {
    assert(
      command.includes(`--control-center-path '${expectedLocalPath}'`),
      `Terminal command should preserve the local Control Center path, got ${command}`,
    );
  }
  assert(
    !command.includes("--terminal-session"),
    `Terminal command should use the default Mac App mode, got ${command}`,
  );
  assert(
    !command.includes("--launchagent"),
    `Terminal command should not use LaunchAgent mode, got ${command}`,
  );
  assert(
    !command.includes(".pkg"),
    `Terminal command should not use Mac package downloads, got ${command}`,
  );

  await page.getByRole("tab", { name: "Agentic setup" }).click();
  await page.getByRole("button", { name: /Prompt preview/ }).click();
  const prompt = (await page.locator("pre").textContent()) || "";
  assert(
    prompt.includes("start it in the background"),
    "agent setup prompt should describe the background Mac App",
  );
  assert(
    prompt.includes("connect VibeTV") && prompt.includes("latest firmware"),
    "agent setup prompt should say the terminal command connects VibeTV and updates firmware",
  );
  if (expectedLocalPath) {
    assert(
      prompt.includes(`http://127.0.0.1:47832${expectedLocalPath}`),
      `agent setup prompt should preserve the local Control Center path, got ${prompt}`,
    );
  }
  assert(
    !prompt.includes("LaunchAgent"),
    "agent setup prompt should not ask for LaunchAgent setup",
  );
  assert(
    !prompt.includes(".pkg"),
    "agent setup prompt should not ask for Mac package setup",
  );
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
