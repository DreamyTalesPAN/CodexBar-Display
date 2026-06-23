import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
const viewport = { width: 390, height: 844 };
const desktopViewport = { width: 1280, height: 900 };
const smokeOnly = process.argv.includes("--smoke");

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
    {
      name: "VibeTV-Companion-API-arm64-v1.0.99.pkg",
      browser_download_url:
        "https://downloads.example.test/VibeTV-Companion-API-arm64-v1.0.99.pkg",
    },
    {
      name: "VibeTV-Companion-API-amd64-v1.0.99.pkg",
      browser_download_url:
        "https://downloads.example.test/VibeTV-Companion-API-amd64-v1.0.99.pkg",
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

const partialPackageReleaseFixture = {
  tag_name: "v1.0.97",
  assets: [
    {
      name: "install-control-center-companion.sh",
      browser_download_url:
        "https://downloads.example.test/install-control-center-companion.sh",
    },
    {
      name: "VibeTV-Companion-API-arm64-v1.0.97.pkg",
      browser_download_url:
        "https://downloads.example.test/VibeTV-Companion-API-arm64-v1.0.97.pkg",
    },
  ],
};

const packageOnlyReleaseFixture = {
  tag_name: "v1.0.95",
  assets: [
    {
      name: "VibeTV-Companion-API-arm64-v1.0.95.pkg",
      browser_download_url:
        "https://downloads.example.test/VibeTV-Companion-API-arm64-v1.0.95.pkg",
    },
    {
      name: "VibeTV-Companion-API-amd64-v1.0.95.pkg",
      browser_download_url:
        "https://downloads.example.test/VibeTV-Companion-API-amd64-v1.0.95.pkg",
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
  const partialPackageReleaseUrl = `http://127.0.0.1:${fixtureServer.port}/github-release-partial-package.json`;
  const packageOnlyReleaseUrl = `http://127.0.0.1:${fixtureServer.port}/github-release-package-only.json`;
  const missingAssetReleaseUrl = `http://127.0.0.1:${fixtureServer.port}/github-release-missing-assets.json`;
  const failedReleaseUrl = `http://127.0.0.1:${fixtureServer.port}/github-release-failed.json`;
  let app;
  let browser;

  try {
    await runNextBuild({ catalogUrl, firmwareUrl, releaseUrl: completeReleaseUrl });
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
      await testInstallLinkKeepsRequestedTheme(browser, appContext.appUrl);
      await testUpdatesHideUnavailableCompanionAction(
        browser,
        appContext.appUrl,
      );
      console.log("control-center customer smoke tests passed");
      return;
    }
    await testLocalNetworkPermissionComesAfterPhoneWifiStep(
      browser,
      appContext.appUrl,
    );
    await testInstallThemeLinkStaysOnSetupWhenThemeLibraryLocked(
      browser,
      appContext.appUrl,
      fixtureServer,
    );
    await testSetupTabsAreLockedUntilSetupComplete(
      browser,
      appContext.appUrl,
    );
    await testDesktopHeaderDoesNotClaimDeviceDuringSetup(
      browser,
      appContext.appUrl,
    );
    await testSettingsStayCustomerOnly(browser, appContext.appUrl);
    await testUpdatesShowCustomerCompanionAction(browser, appContext.appUrl);
    await testSupportReportExportsAppearAfterReportLoads(browser, appContext.appUrl);
    await testVibeTVAddressCopyStaysCustomerOnly(browser, appContext.appUrl);
    await testSavedAddressDoesNotBlockAutomaticVibeTVSearch(
      browser,
      appContext.appUrl,
    );
    await testInstallLinkKeepsRequestedTheme(browser, appContext.appUrl);
    await testThemeInstallStatusStaysCustomerOnly(browser, appContext.appUrl);
    await testCustomerLogsStayCustomerOnly(browser, appContext.appUrl);
    await testPairingRequiredThemeStaysLocked(browser, appContext.appUrl);
    await testThemeWithoutPackUrlStaysLocked(browser, appContext.appUrl);
    await testBoardIncompatibleThemeStaysLocked(browser, appContext.appUrl);
    await testFirmwareIncompatibleThemeStaysLocked(browser, appContext.appUrl);
    await assertCompanionReleaseApi(appContext.appUrl, {
      installerAsset: null,
      latestVersion: "1.0.99",
      packageAssets: {
        macosAmd64: "VibeTV-Companion-API-amd64-v1.0.99.pkg",
        macosArm64: "VibeTV-Companion-API-arm64-v1.0.99.pkg",
      },
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
      packageAssets: null,
      status: "missing_asset",
      updateAvailable: false,
    });
    await stopProcess(app.process);
    app = undefined;

    appContext = await startTestApp({
      catalogUrl,
      releaseUrl: partialPackageReleaseUrl,
    });
    app = appContext.app;
    await testPartialPackageReleaseShowsSupportFallback(
      browser,
      appContext.appUrl,
      fixtureServer,
    );
    await assertCompanionReleaseApi(appContext.appUrl, {
      installerAsset: null,
      latestVersion: "1.0.97",
      packageAssets: null,
      status: "missing_asset",
      updateAvailable: false,
    });
    await stopProcess(app.process);
    app = undefined;

    appContext = await startTestApp({
      catalogUrl,
      releaseUrl: packageOnlyReleaseUrl,
    });
    app = appContext.app;
    await testPackageOnlyReleaseShowsPackageDownloads(
      browser,
      appContext.appUrl,
      fixtureServer,
    );
    await assertCompanionReleaseApi(appContext.appUrl, {
      installerAsset: null,
      latestVersion: "1.0.95",
      packageAssets: {
        macosAmd64: "VibeTV-Companion-API-amd64-v1.0.95.pkg",
        macosArm64: "VibeTV-Companion-API-arm64-v1.0.95.pkg",
      },
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
    await testUpdatesHideUnavailableCompanionAction(
      browser,
      appContext.appUrl,
    );
    await assertCompanionReleaseApi(appContext.appUrl, {
      installerAsset: null,
      latestVersion: "1.0.96",
      packageAssets: null,
      status: "missing_asset",
      updateAvailable: false,
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
      packageAssets: null,
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

async function testLocalNetworkPermissionComesAfterPhoneWifiStep(
  browser,
  appUrl,
) {
  const page = await browser.newPage({ viewport });
  const installRequests = [];
  await routeCompanionMissing(page, installRequests);

  await page.goto(appUrl, {
    waitUntil: "networkidle",
  });
  await page.getByRole("heading", { name: "Set up your VibeTV" }).waitFor({
    timeout: 10_000,
  });
  await page
    .getByRole("button", { name: "VibeTV is on WiFi" })
    .waitFor({ timeout: 10_000 });
  await page.getByText("Take your phone.").waitFor({ timeout: 10_000 });
  await page.getByText("VibeTV-Setup").waitFor({ timeout: 10_000 });
  await page.getByText("192.168.4.1").waitFor({ timeout: 10_000 });
  assert(
    (await page.getByRole("button", { name: "Allow access" }).count()) === 0,
    "browser permission should not be requested before the WiFi step",
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
    waitUntil: "networkidle",
  });
  await page.getByRole("heading", { name: "Set up your VibeTV" }).waitFor({
    timeout: 10_000,
  });
  await assertThemeLibraryLockedBehindSetup(page);
  await assertNoSetupJargon(page);
  await page
    .getByRole("button", { name: "VibeTV is on WiFi" })
    .click();
  await page
    .getByRole("button", { name: "Copy prompt" })
    .waitFor({ timeout: 10_000 });

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

async function testDesktopHeaderDoesNotClaimDeviceDuringSetup(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport: desktopViewport });
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

async function testUpdatesShowCustomerCompanionAction(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  await routeCompanionOnline(page, installRequests);

  await page.goto(appUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Updates" }).click();
  await page.getByRole("link", { name: "Update Mac App" }).waitFor({
    timeout: 10_000,
  });
  await page.getByText("Installed version").waitFor({ timeout: 10_000 });
  await page.getByText("Latest version").waitFor({ timeout: 10_000 });
  await page.getByText("Mac App download").waitFor({ timeout: 10_000 });

  const hiddenUpdatesText = ["Release installer", "Mac package"];
  for (const text of hiddenUpdatesText) {
    assert(
      (await page.getByText(text).count()) === 0,
      `Updates should not show package/release jargon: ${text}`,
    );
  }

  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testUpdatesHideUnavailableCompanionAction(browser, appUrl) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  await routeCompanionOnline(page, installRequests);

  await page.goto(appUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Updates" }).click();
  await page.getByText("Ready").first().waitFor({ timeout: 10_000 });
  assert(
    (await page.getByText("Not ready yet").count()) === 0,
    "Updates should not show unavailable Mac App installer state when the Mac App is running",
  );
  assert(
    (await page.getByText("Mac App download").count()) === 0,
    "Updates should hide Mac App download state when the Mac App is already running",
  );

  assert(
    (await page.getByRole("button", { name: "Check again" }).count()) === 0,
    "Updates should not show a dead Mac App installer retry button",
  );
  assert(
    (await page.getByRole("link", { name: "Update Mac App" }).count()) === 0,
    "Updates should not show a Mac App update link without macOS packages",
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
  });

  await page.goto(appUrl, { waitUntil: "networkidle" });
  await page.getByLabel("VibeTV address").waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "Connect VibeTV" }).waitFor({
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
  const discoverRequests = [];
  let settingsCalls = 0;
  await routeCompanionOnline(
    page,
    installRequests,
    () => {
      settingsCalls += 1;
    },
    {
      onDiscover: (postData) => {
        discoverRequests.push(postData || "");
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
    () => discoverRequests.length >= 1,
    "expected automatic VibeTV discovery to run",
  );

  assert(
    discoverRequests[0] === "{}",
    `automatic discovery should not force stale saved address, got ${discoverRequests[0]}`,
  );
  assert(
    settingsCalls >= 1,
    "automatic discovery should continue into settings refresh after finding VibeTV",
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
  await page.getByText("Install failed").waitFor({ timeout: 10_000 });
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
  await page.getByText("Install failed").waitFor({ timeout: 10_000 });

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

async function testPairingRequiredThemeStaysLocked(browser, appUrl) {
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
  await page.getByRole("heading", { name: "Set up your VibeTV" }).waitFor({
    timeout: 10_000,
  });
  await assertThemeLibraryLockedBehindSetup(page);
  await page.getByRole("button", { name: "VibeTV is on WiFi" }).click();
  await waitForCondition(
    () => pairRequests.length === 1,
    "expected setup to pair VibeTV automatically",
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
  assert(await installButton.isEnabled(), "paired VibeTV should unlock install");
  assert(pairRequests.length === 1, "pairing should call Companion once");
  assert(
    pairRequests[0]?.includes("http://vibetv.local"),
    `pairing request did not include target: ${pairRequests[0]}`,
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

async function testScriptOnlyReleaseShowsSupportFallback(
  browser,
  appUrl,
) {
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

async function testPartialPackageReleaseShowsSupportFallback(
  browser,
  appUrl,
) {
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

async function testPackageOnlyReleaseShowsPackageDownloads(
  browser,
  appUrl,
) {
  const page = await newCustomerPage(browser, appUrl, { viewport });
  const installRequests = [];
  await routeCompanionMissing(page, installRequests);

  await page.goto(`${appUrl}/install/synthwave`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Set up your VibeTV" }).waitFor({
    timeout: 10_000,
  });
  await assertThemeLibraryLockedBehindSetup(page);
  await assertNoSetupJargon(page);
  await page
    .getByRole("button", { name: "VibeTV is on WiFi" })
    .click();
  await page
    .getByRole("button", { name: "Copy prompt" })
    .waitFor({ timeout: 10_000 });

  await assertNoLegacyCompanionDownloadActions(page);
  await assertNoThemeLibraryReleaseDiagnostics(page);
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testReleaseCheckFailureShowsNoDownloadActions(
  browser,
  appUrl,
) {
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

async function testMissingAssetReleaseShowsNoDownloadActions(
  browser,
  appUrl,
) {
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
  {
    installerAsset,
    latestVersion,
    packageAssets,
    status,
    updateAvailable,
  },
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

  if (packageAssets) {
    assert(
      assetName(payload.packageDownloadUrls?.macosArm64) ===
        packageAssets.macosArm64,
      `release API arm64 package=${assetName(
        payload.packageDownloadUrls?.macosArm64,
      )}, expected ${packageAssets.macosArm64}`,
    );
    assert(
      assetName(payload.packageDownloadUrls?.macosAmd64) ===
        packageAssets.macosAmd64,
      `release API amd64 package=${assetName(
        payload.packageDownloadUrls?.macosAmd64,
      )}, expected ${packageAssets.macosAmd64}`,
    );
  } else {
    assert(
      !payload.packageDownloadUrls,
      `release API should hide incomplete package URLs, got ${JSON.stringify(
        payload.packageDownloadUrls,
      )}`,
    );
  }
}

async function assertFirmwareUpdateApi(
  appUrl,
  {
    board,
    firmware,
    latestFirmware,
    message,
    status,
    updateAvailable,
  },
) {
  const params = new URLSearchParams({ board, firmware });
  const response = await fetch(`${appUrl}/api/firmware/latest?${params}`);
  assert(
    response.ok,
    `expected firmware API HTTP 200, got ${response.status}`,
  );
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

async function routeCompanionMissing(page, installRequests) {
  await page.route("http://127.0.0.1:47832/v1/**", async (route) => {
    if (route.request().url().includes("/v1/themes/install")) {
      installRequests.push(route.request().postData());
    }
    await route.abort("failed");
  });
}

async function routeCompanionOnline(
  page,
  installRequests,
  onSettings = () => {},
  { device = companionDevice, onDiscover, onPair } = {},
) {
  let currentDevice = device;
  await page.route("http://127.0.0.1:47832/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/themes/install") {
      installRequests.push(route.request().postData());
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false }),
      });
      return;
    }
    if (url.pathname === "/v1/device/pair") {
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
    if (url.pathname === "/v1/device/discover") {
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
    if (url.pathname === "/v1/status") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          companion: {
            version: "1.0.32",
            features: { themeInstallEnabled: true },
          },
          device: currentDevice,
        }),
      });
      return;
    }
    if (url.pathname === "/v1/device") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, device: currentDevice }),
      });
      return;
    }
    if (url.pathname === "/v1/settings") {
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
    if (url.pathname === "/v1/diagnostics") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          generatedAt: "2026-06-19T12:00:00.000Z",
          companion: {
            version: "1.0.32",
            features: { themeInstallEnabled: true },
          },
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
  });
}

async function startFixtureServer() {
  let catalogRequestCount = 0;
  let failedCatalogRequestCount = 0;
  let releaseRequestCount = 0;
  let scriptOnlyReleaseRequestCount = 0;
  let partialReleaseRequestCount = 0;
  let packageOnlyReleaseRequestCount = 0;
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
    if (request.url === "/github-release-partial-package.json") {
      partialReleaseRequestCount += 1;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(partialPackageReleaseFixture));
      return;
    }
    if (request.url === "/github-release-package-only.json") {
      packageOnlyReleaseRequestCount += 1;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(packageOnlyReleaseFixture));
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
    get partialReleaseRequestCount() {
      return partialReleaseRequestCount;
    },
    get packageOnlyReleaseRequestCount() {
      return packageOnlyReleaseRequestCount;
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
    `expected no Companion install link without complete macOS packages, got ${installLinkCount}`,
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
    const role = label === "Mac package pending" || label === "Check failed"
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
