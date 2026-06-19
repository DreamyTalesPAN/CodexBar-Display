import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
const viewport = { width: 390, height: 844 };

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
  const completeReleaseUrl = `http://127.0.0.1:${fixtureServer.port}/github-release-complete.json`;
  const scriptOnlyReleaseUrl = `http://127.0.0.1:${fixtureServer.port}/github-release-script-only.json`;
  const partialPackageReleaseUrl = `http://127.0.0.1:${fixtureServer.port}/github-release-partial-package.json`;
  const packageOnlyReleaseUrl = `http://127.0.0.1:${fixtureServer.port}/github-release-package-only.json`;
  const missingAssetReleaseUrl = `http://127.0.0.1:${fixtureServer.port}/github-release-missing-assets.json`;
  const failedReleaseUrl = `http://127.0.0.1:${fixtureServer.port}/github-release-failed.json`;
  let app;
  let browser;

  try {
    await runNextBuild({ catalogUrl, releaseUrl: completeReleaseUrl });
    assert(
      fixtureServer.catalogRequestCount > 0,
      "customer flow build did not read the local catalog fixture",
    );
    browser = await chromium.launch({ headless: true });

    let appContext = await startTestApp({
      catalogUrl,
      releaseUrl: completeReleaseUrl,
    });
    app = appContext.app;
    await testMissingShopifyThemeCanSelectAvailableTheme(
      browser,
      appContext.appUrl,
      fixtureServer,
    );
    await testInstallLinkKeepsRequestedTheme(browser, appContext.appUrl);
    await testPairingRequiredThemeStaysLocked(browser, appContext.appUrl);
    await testThemeWithoutPackUrlStaysLocked(browser, appContext.appUrl);
    await testBoardIncompatibleThemeStaysLocked(browser, appContext.appUrl);
    await testFirmwareIncompatibleThemeStaysLocked(browser, appContext.appUrl);
    await assertCompanionReleaseApi(appContext.appUrl, {
      installerAsset: "install-control-center-companion.sh",
      latestVersion: "1.0.99",
      packageAssets: {
        macosAmd64: "VibeTV-Companion-API-amd64-v1.0.99.pkg",
        macosArm64: "VibeTV-Companion-API-arm64-v1.0.99.pkg",
      },
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
      installerAsset: "install-control-center-companion.sh",
      latestVersion: "1.0.98",
      packageAssets: null,
      status: "available",
      updateAvailable: true,
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
      installerAsset: "install-control-center-companion.sh",
      latestVersion: "1.0.97",
      packageAssets: null,
      status: "available",
      updateAvailable: true,
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
    console.log("control-center customer flow tests passed");
  } finally {
    await browser?.close();
    await stopProcess(app?.process);
    await fixtureServer.close();
  }
}

async function startTestApp({ catalogUrl, releaseUrl }) {
  const appPort = await findFreePort();
  const appUrl = `http://127.0.0.1:${appPort}`;
  const app = startNext({ appPort, catalogUrl, releaseUrl });
  await waitForHttp(appUrl);
  return { app, appUrl };
}

async function testMissingShopifyThemeCanSelectAvailableTheme(
  browser,
  appUrl,
  fixtureServer,
) {
  const page = await browser.newPage({ viewport });
  const installRequests = [];
  const initialReleaseRequests = fixtureServer.releaseRequestCount;
  await routeCompanionMissing(page, installRequests);

  await page.goto(`${appUrl}/install/does-not-exist`, {
    waitUntil: "networkidle",
  });
  await page
    .getByText("Shopify theme link was not found")
    .waitFor({ timeout: 10_000 });
  await page
    .getByText("Fixture Synthwave Theme")
    .waitFor({ timeout: 10_000 });

  const selectButtonsBefore = await page.getByRole("button", {
    name: "Select",
  }).count();
  assert(
    selectButtonsBefore >= 1,
    `expected Select buttons for available themes, got ${selectButtonsBefore}`,
  );

  await page
    .locator("li")
    .filter({ hasText: "Fixture Synthwave Theme" })
    .getByRole("button", { name: "Select" })
    .click();
  await page.getByText("Companion required").waitFor({ timeout: 10_000 });
  await page
    .getByText("Fixture Synthwave Theme is selected.")
    .waitFor({ timeout: 10_000 });
  await page.getByRole("link", { name: "Install Apple silicon" }).waitFor({
    timeout: 10_000,
  });
  await page.getByRole("link", { name: "Install Intel Mac" }).waitFor({
    timeout: 10_000,
  });
  await clickDownloadWithoutLeavingPage(
    page.getByRole("link", { name: "Install Apple silicon" }),
  );
  await page
    .getByText(
      "Download started. Open the package from Downloads, finish the installer, then return here and check the bridge again.",
    )
    .waitFor({ timeout: 10_000 });

  assert(
    (await page.getByText("Shopify theme link was not found").count()) === 0,
    "missing-theme notice should clear after selecting an available theme",
  );
  assert(
    (await page.getByText("Theme not available").count()) === 0,
    "missing-theme heading should clear after selecting an available theme",
  );
  assert(
    (await page.getByRole("link", { name: "Support install script" }).count()) ===
      0,
    "complete package release should not show the support script link",
  );
  assert(
    fixtureServer.releaseRequestCount > initialReleaseRequests,
    "missing-Companion flow did not read the local release fixture",
  );
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testInstallLinkKeepsRequestedTheme(browser, appUrl) {
  const page = await browser.newPage({ viewport });
  const installRequests = [];
  let settingsCalls = 0;
  await routeCompanionOnline(page, installRequests, () => {
    settingsCalls += 1;
  });

  await page.goto(`${appUrl}/install/synthwave`, { waitUntil: "networkidle" });
  await waitForCondition(
    () => settingsCalls >= 1,
    "expected settings refresh during initial connected bridge check",
  );

  await page
    .getByText("Fixture Synthwave Theme is selected.")
    .waitFor({ timeout: 10_000 });
  assert(
    (await page.getByText("Fixture Clippy Theme is selected.").count()) === 0,
    "settings refresh should not replace requested Shopify theme with active device theme",
  );
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testPairingRequiredThemeStaysLocked(browser, appUrl) {
  const page = await browser.newPage({ viewport });
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
    () => settingsCalls >= 1,
    "expected settings refresh for pairing readiness check",
  );

  await page
    .getByText("Fixture Synthwave Theme is selected.")
    .waitFor({ timeout: 10_000 });
  await page.getByText("Pairing required").waitFor({ timeout: 10_000 });
  await page
    .getByText(
      "VibeTV is reachable. Pair it once before theme install writes are allowed.",
    )
    .waitFor({ timeout: 10_000 });
  await page
    .getByRole("button", { name: "Pair VibeTV" })
    .waitFor({ timeout: 10_000 });

  const lockedButton = page
    .locator("li")
    .filter({ hasText: "Fixture Synthwave Theme" })
    .getByRole("button", { name: "Locked" });
  await lockedButton.waitFor({ timeout: 10_000 });
  assert(
    await lockedButton.isDisabled(),
    "unpaired VibeTV should keep the install button disabled",
  );

  await page.getByRole("button", { name: "Pair VibeTV" }).click();
  await waitForCondition(
    () => settingsCalls >= 2,
    "expected settings refresh after pairing",
  );
  await page.getByText("Ready for install").waitFor({ timeout: 10_000 });
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
  const page = await browser.newPage({ viewport });
  const installRequests = [];
  await routeCompanionMissing(page, installRequests);

  await page.goto(`${appUrl}/install/missing-pack`, {
    waitUntil: "networkidle",
  });

  await page
    .getByText("Fixture Missing Pack Theme is selected.")
    .waitFor({ timeout: 10_000 });
  await page.getByText("Theme pack missing").waitFor({ timeout: 10_000 });
  await page
    .getByText(
      "This Shopify theme is missing the technical pack URL, so it cannot be installed yet.",
    )
    .waitFor({ timeout: 10_000 });

  const lockedButton = page
    .locator("li")
    .filter({ hasText: "Fixture Missing Pack Theme" })
    .getByRole("button", { name: "Locked" });
  await lockedButton.waitFor({ timeout: 10_000 });
  assert(
    await lockedButton.isDisabled(),
    "theme without pack URL should keep the install button disabled",
  );
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testBoardIncompatibleThemeStaysLocked(browser, appUrl) {
  const page = await browser.newPage({ viewport });
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

  await page
    .getByText("Fixture ESP32 Only Theme is selected.")
    .waitFor({ timeout: 10_000 });
  await page.getByText("Board not supported").waitFor({ timeout: 10_000 });
  await page
    .getByText(
      "Fixture ESP32 Only Theme does not list esp8266_smalltv_st7789 as a compatible VibeTV board.",
    )
    .waitFor({ timeout: 10_000 });

  const lockedButton = page
    .locator("li")
    .filter({ hasText: "Fixture ESP32 Only Theme" })
    .getByRole("button", { name: "Locked" });
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
  const page = await browser.newPage({ viewport });
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

  await page
    .getByText("Fixture Future Firmware Theme is selected.")
    .waitFor({ timeout: 10_000 });
  await page.getByText("Firmware too old").waitFor({ timeout: 10_000 });
  await page
    .getByText(
      "Fixture Future Firmware Theme requires firmware 9.9.9 or newer. Update firmware before installing this theme.",
    )
    .waitFor({ timeout: 10_000 });

  const lockedButton = page
    .locator("li")
    .filter({ hasText: "Fixture Future Firmware Theme" })
    .getByRole("button", { name: "Locked" });
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
  fixtureServer,
) {
  const page = await browser.newPage({ viewport });
  const installRequests = [];
  const initialReleaseRequests = fixtureServer.scriptOnlyReleaseRequestCount;
  await routeCompanionMissing(page, installRequests);

  await page.goto(`${appUrl}/install/synthwave`, { waitUntil: "networkidle" });
  await page.getByText("Companion required").waitFor({ timeout: 10_000 });
  await page
    .getByText("Fixture Synthwave Theme is selected.")
    .waitFor({ timeout: 10_000 });
  await page
    .getByRole("button", { name: "Installer pending" })
    .waitFor({ timeout: 10_000 });
  await page
    .getByRole("link", { name: "Support install script" })
    .waitFor({ timeout: 10_000 });

  assert(
    (await page.getByRole("link", { name: "Install Apple silicon" }).count()) ===
      0,
    "script-only release should not show the Apple silicon package button",
  );
  assert(
    (await page.getByRole("link", { name: "Install Intel Mac" }).count()) === 0,
    "script-only release should not show the Intel package button",
  );
  assert(
    fixtureServer.scriptOnlyReleaseRequestCount > initialReleaseRequests,
    "script-only flow did not read the local release fixture",
  );
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testPartialPackageReleaseShowsSupportFallback(
  browser,
  appUrl,
  fixtureServer,
) {
  const page = await browser.newPage({ viewport });
  const installRequests = [];
  const initialReleaseRequests = fixtureServer.partialReleaseRequestCount;
  await routeCompanionMissing(page, installRequests);

  await page.goto(`${appUrl}/install/synthwave`, { waitUntil: "networkidle" });
  await page.getByText("Companion required").waitFor({ timeout: 10_000 });
  await page
    .getByText("Fixture Synthwave Theme is selected.")
    .waitFor({ timeout: 10_000 });
  await page
    .getByRole("button", { name: "Installer pending" })
    .waitFor({ timeout: 10_000 });
  await page
    .getByRole("link", { name: "Support install script" })
    .waitFor({ timeout: 10_000 });

  assert(
    (await page.getByRole("link", { name: "Install Apple silicon" }).count()) ===
      0,
    "partial package release should not show the Apple silicon package button",
  );
  assert(
    (await page.getByRole("link", { name: "Install Intel Mac" }).count()) === 0,
    "partial package release should not show the Intel package button",
  );
  assert(
    fixtureServer.partialReleaseRequestCount > initialReleaseRequests,
    "partial-package flow did not read the local release fixture",
  );
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testPackageOnlyReleaseShowsPackageDownloads(
  browser,
  appUrl,
  fixtureServer,
) {
  const page = await browser.newPage({ viewport });
  const installRequests = [];
  const initialReleaseRequests = fixtureServer.packageOnlyReleaseRequestCount;
  await routeCompanionMissing(page, installRequests);

  await page.goto(`${appUrl}/install/synthwave`, { waitUntil: "networkidle" });
  await page.getByText("Companion required").waitFor({ timeout: 10_000 });
  await page
    .getByText("Fixture Synthwave Theme is selected.")
    .waitFor({ timeout: 10_000 });
  await page.getByRole("link", { name: "Install Apple silicon" }).waitFor({
    timeout: 10_000,
  });
  await page.getByRole("link", { name: "Install Intel Mac" }).waitFor({
    timeout: 10_000,
  });
  await clickDownloadWithoutLeavingPage(
    page.getByRole("link", { name: "Install Apple silicon" }),
  );
  await page
    .getByText(
      "Download started. Open the package from Downloads, finish the installer, then return here and check the bridge again.",
    )
    .waitFor({ timeout: 10_000 });

  assert(
    (await page.getByRole("link", { name: "Support install script" }).count()) ===
      0,
    "package-only release should not show the support script link",
  );
  assert(
    fixtureServer.packageOnlyReleaseRequestCount > initialReleaseRequests,
    "package-only flow did not read the local release fixture",
  );
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testReleaseCheckFailureShowsNoDownloadActions(
  browser,
  appUrl,
  fixtureServer,
) {
  const page = await browser.newPage({ viewport });
  const installRequests = [];
  const initialReleaseRequests = fixtureServer.failedReleaseRequestCount;
  await routeCompanionMissing(page, installRequests);

  await page.goto(`${appUrl}/install/synthwave`, { waitUntil: "networkidle" });
  await page.getByText("Companion required").waitFor({ timeout: 10_000 });
  await page
    .getByText("Fixture Synthwave Theme is selected.")
    .waitFor({ timeout: 10_000 });
  await page
    .getByRole("button", { name: "Check failed" })
    .waitFor({ timeout: 10_000 });
  await page
    .getByText(
      "Companion release check failed. Check your connection, then use Check installer again.",
    )
    .waitFor({ timeout: 10_000 });

  assert(
    (await page.getByRole("link", { name: "Install Apple silicon" }).count()) ===
      0,
    "failed release check should not show the Apple silicon package button",
  );
  assert(
    (await page.getByRole("link", { name: "Install Intel Mac" }).count()) === 0,
    "failed release check should not show the Intel package button",
  );
  assert(
    (await page.getByRole("link", { name: "Support install script" }).count()) ===
      0,
    "failed release check should not show the support script link",
  );
  assert(
    fixtureServer.failedReleaseRequestCount > initialReleaseRequests,
    "failed-release flow did not read the local release fixture",
  );
  assertNoInstallRequests(installRequests);
  await assertNoMobileOverflow(page);
  await page.close();
}

async function testMissingAssetReleaseShowsNoDownloadActions(
  browser,
  appUrl,
  fixtureServer,
) {
  const page = await browser.newPage({ viewport });
  const installRequests = [];
  const initialReleaseRequests = fixtureServer.missingAssetReleaseRequestCount;
  await routeCompanionMissing(page, installRequests);

  await page.goto(`${appUrl}/install/synthwave`, { waitUntil: "networkidle" });
  await page.getByText("Companion required").waitFor({ timeout: 10_000 });
  await page
    .getByText("Fixture Synthwave Theme is selected.")
    .waitFor({ timeout: 10_000 });
  await page
    .getByRole("button", { name: "Installer pending" })
    .waitFor({ timeout: 10_000 });
  await page
    .getByText(
      "v1.0.96: Companion installer is not published in the latest release yet.",
    )
    .waitFor({ timeout: 10_000 });

  assert(
    (await page.getByRole("link", { name: "Install Apple silicon" }).count()) ===
      0,
    "missing-asset release should not show the Apple silicon package button",
  );
  assert(
    (await page.getByRole("link", { name: "Install Intel Mac" }).count()) === 0,
    "missing-asset release should not show the Intel package button",
  );
  assert(
    (await page.getByRole("link", { name: "Support install script" }).count()) ===
      0,
    "missing-asset release should not show the support script link",
  );
  assert(
    fixtureServer.missingAssetReleaseRequestCount > initialReleaseRequests,
    "missing-asset flow did not read the local release fixture",
  );
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
  { device = companionDevice, onPair } = {},
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
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ ok: false }),
    });
  });
}

async function startFixtureServer() {
  let catalogRequestCount = 0;
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

function startNext({ appPort, catalogUrl, releaseUrl }) {
  const child = spawn(
    process.execPath,
    [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(appPort)],
    {
      cwd: root,
      env: testEnv(catalogUrl, releaseUrl),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));

  return { process: child };
}

async function runNextBuild({ catalogUrl, releaseUrl }) {
  await runCommand(process.execPath, [nextBin, "build"], {
    cwd: root,
    env: testEnv(catalogUrl, releaseUrl),
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

function testEnv(catalogUrl, releaseUrl) {
  return {
    ...process.env,
    CONTROL_CENTER_ALLOW_CATALOG_FALLBACK: "1",
    CONTROL_CENTER_COMPANION_RELEASE_API_URL: releaseUrl,
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

async function clickDownloadWithoutLeavingPage(locator) {
  await locator.evaluate((anchor) => {
    anchor.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
      },
      { once: true },
    );
    anchor.click();
  });
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
