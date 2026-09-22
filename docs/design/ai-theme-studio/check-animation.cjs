const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(
  require.resolve("playwright", {
    paths: [resolve(__dirname, "../../../apps/control-center"), __dirname],
  }),
);
const assert = require("node:assert/strict");
const url = pathToFileURL(resolve(__dirname, "index.html")).href;
const screenshotDir = process.env.THEME_STUDIO_SCREENSHOTS;
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1056, height: 1600 },
      colorScheme: "light",
      reducedMotion: "no-preference",
    });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const requests = [];
    page.on("request", (r) => {
      if (r.url() !== url) requests.push(r.url());
    });
    await page.goto(url);
    const f = page;
    await f.locator("#vu-cat").waitFor();
    const snapshot = () => f.locator("#vu-cat").evaluate((c) => c.toDataURL());
    const first = await snapshot();
    await f.waitForFunction(
      (a) => document.getElementById("vu-cat").toDataURL() !== a,
      first,
    );
    assert.equal(
      await f
        .locator("#vu-cat")
        .evaluate((c) => c.getContext("2d").getImageData(0, 0, 1, 1).data[3]),
      0,
      "Sprite must have transparent background",
    );
    await f
      .getByRole("button", { name: "Pause animation", exact: true })
      .click();
    const paused = await snapshot();
    await page.waitForTimeout(1200);
    assert.equal(await snapshot(), paused, "Pause freezes rendered pixels");
    const canvasBefore = await f.locator("#vu-screen").boundingBox();
    await f
      .getByRole("button", { name: "Select animated cat", exact: true })
      .click();
    const canvasAfter = await f.locator("#vu-screen").boundingBox();
    assert.equal(canvasBefore.y, canvasAfter.y);
    assert(await f.locator("#vu-motion").isVisible());
    assert(await f.locator("#vu-label-field").isHidden());
    await f.locator("#vu-speed").selectOption("4");
    assert.equal(await f.locator("#vu-cat").getAttribute("data-fps"), "4");
    await f
      .getByRole("button", { name: "Undo last edit", exact: true })
      .click();
    assert.equal(await f.locator("#vu-speed").inputValue(), "2");
    const coords = () =>
      f.locator("#vu-object-cat").evaluate((e) => [e.style.left, e.style.top]);
    const p0 = await coords();
    await f.getByRole("button", { name: "Move right", exact: true }).click();
    assert.notDeepEqual(await coords(), p0);
    await f
      .getByRole("button", { name: "Undo last edit", exact: true })
      .click();
    assert.deepEqual(await coords(), p0);
    const box = await f.locator("#vu-object-cat").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 12,
      box.y + box.height / 2 + 6,
      { steps: 5 },
    );
    await page.mouse.up();
    assert.notDeepEqual(await coords(), p0);
    await f
      .getByRole("button", { name: "Undo last edit", exact: true })
      .click();
    assert.deepEqual(await coords(), p0);
    const bg = await f.locator("#vu-art").evaluate((c) => c.toDataURL());
    await f
      .getByRole("button", { name: "Remove element", exact: true })
      .click();
    assert(await f.locator("#vu-object-cat").isHidden());
    assert(await f.locator("#vu-preview-playback").isHidden());
    assert.equal(await f.locator("#vu-art").evaluate((c) => c.toDataURL()), bg);
    await f
      .getByRole("button", { name: "Undo last edit", exact: true })
      .click();
    assert(await f.locator("#vu-object-cat").isVisible());
    await f
      .getByRole("button", { name: "Select animated cat", exact: true })
      .click();
    await f
      .getByRole("button", { name: "Change movement", exact: true })
      .click();
    await f.getByRole("button", { name: "Update theme", exact: true }).click();
    await f.locator("#vu-loading").waitFor({ state: "hidden" });
    assert.equal(
      await f.locator("#vu-cat").getAttribute("data-motion"),
      "sleep",
    );
    assert.equal(await f.locator("#vu-art").evaluate((c) => c.toDataURL()), bg);
    assert.deepEqual(await coords(), p0);
    await f
      .getByRole("button", { name: "Undo last edit", exact: true })
      .click();
    assert.equal(
      await f.locator("#vu-cat").getAttribute("data-motion"),
      "blink",
    );
    await f.getByRole("button", { name: "Redo edit", exact: true }).click();
    assert.equal(
      await f.locator("#vu-cat").getAttribute("data-motion"),
      "sleep",
    );
    await f
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    const playing = await snapshot();
    await f.waitForFunction(
      (a) => document.getElementById("vu-cat").toDataURL() !== a,
      playing,
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await f
      .getByRole("button", { name: "Play animation", exact: true })
      .waitFor();
    const reduced = await snapshot();
    await page.waitForTimeout(1100);
    assert.equal(await snapshot(), reduced);
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const width of [1056, 768, 392, 352]) {
        await page.setViewportSize({ width, height: 1900 });
        const bounds = await f
          .locator("#vu-studio")
          .evaluate((e) => [e.clientWidth, e.scrollWidth]);
        assert(bounds[1] <= bounds[0] + 2);
        if (screenshotDir && (width === 1056 || width === 392))
          await f
            .locator("#vu-studio")
            .screenshot({
              path:
                screenshotDir + "/animated-" + scheme + "-" + width + ".png",
            });
        console.log("PASS sprite tools", scheme, width);
      }
    }
    await page.setViewportSize({ width: 1056, height: 1600 });
    await f.getByRole("button", { name: "New theme", exact: true }).click();
    await f.getByRole("button", { name: "Start new", exact: true }).click();
    await f.getByRole("button", { name: "Cozy cabin", exact: true }).click();
    await f.getByRole("button", { name: "Create theme", exact: true }).click();
    await f.locator("#vu-loading").waitFor({ state: "hidden" });
    assert(await f.locator("#vu-object-cat").isHidden());
    assert(
      await f.locator("#vu-restore").isHidden(),
      "Unrequested sprite is not a removed element",
    );
    await f.getByRole("button", { name: "Add animation", exact: true }).click();
    await f.getByRole("button", { name: "Update theme", exact: true }).click();
    await f.locator("#vu-loading").waitFor({ state: "hidden" });
    assert(await f.locator("#vu-object-cat").isVisible());
    await f
      .getByRole("button", { name: "Undo last edit", exact: true })
      .click();
    assert(await f.locator("#vu-object-cat").isHidden());
    const initialReduced = await browser.newPage({
      viewport: { width: 1056, height: 1200 },
      reducedMotion: "reduce",
    });
    await initialReduced.goto(url);
    const rf = initialReduced;
    await rf
      .getByRole("button", { name: "Play animation", exact: true })
      .waitFor();
    const still = await rf.locator("#vu-cat").evaluate((c) => c.toDataURL());
    await initialReduced.waitForTimeout(1100);
    assert.equal(
      await rf.locator("#vu-cat").evaluate((c) => c.toDataURL()),
      still,
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(
      requests,
      [],
      "Prototype must not request external resources",
    );
    console.log(
      "PASS actual changing pixels, transparency, pause, speed+undo, drag, removal, motion change, shared history, reduced motion, explicit add-animation flow; no JS errors",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
