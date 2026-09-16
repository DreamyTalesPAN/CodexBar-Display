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
      viewport: { width: 1056, height: 1500 },
      colorScheme: "light",
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
    await f.locator("#vu-art").waitFor();
    const pos = () =>
      f
        .locator("#vu-object-session")
        .evaluate((e) => ({
          x: parseFloat(e.style.left),
          y: parseFloat(e.style.top),
        }));
    const canvas0 = await f.locator("#vu-screen").boundingBox();
    await f
      .getByRole("button", { name: "Select session remaining", exact: true })
      .click();
    assert(await f.locator("#vu-inspector").isVisible());
    assert(await f.locator("#vu-label").isVisible());
    const canvas1 = await f.locator("#vu-screen").boundingBox();
    assert(
      Math.abs(canvas0.y - canvas1.y) < 1,
      "Selecting an element must not move the preview: " +
        JSON.stringify({ canvas0, canvas1 }),
    );
    const p0 = await pos();
    await f.getByRole("button", { name: "Move left", exact: true }).click();
    const p1 = await pos();
    assert(p1.x < p0.x);
    await f
      .getByRole("button", { name: "Undo last edit", exact: true })
      .click();
    assert.deepEqual(await pos(), p0);
    await f.getByRole("button", { name: "Redo edit", exact: true }).click();
    assert.deepEqual(await pos(), p1);
    await f.locator("#vu-label").fill("MY SESSION");
    await f.locator("#vu-label").press("Tab");
    assert.equal(
      await f.locator("#vu-session-label").innerText(),
      "MY SESSION",
    );
    await f
      .getByRole("button", { name: "Remove element", exact: true })
      .click();
    assert(await f.locator("#vu-object-session").isHidden());
    await f
      .getByRole("button", { name: "Undo last edit", exact: true })
      .click();
    assert(await f.locator("#vu-object-session").isVisible());
    await f
      .getByRole("button", { name: "Select session remaining", exact: true })
      .click();
    const beforeDrag = await pos();
    const box = await f.locator("#vu-object-session").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 8,
      box.y + box.height / 2 + 9,
      { steps: 6 },
    );
    await page.mouse.up();
    const afterDrag = await pos();
    assert.notDeepEqual(afterDrag, beforeDrag);
    await f
      .getByRole("button", { name: "Undo last edit", exact: true })
      .click();
    assert.deepEqual(
      await pos(),
      beforeDrag,
      "Whole drag must be one undo step",
    );
    await f.getByRole("button", { name: "Redo edit", exact: true }).click();
    assert.deepEqual(await pos(), afterDrag);
    await f
      .getByRole("button", { name: "Select session remaining", exact: true })
      .press("ArrowDown");
    const beforeAI = await pos();
    await f.getByRole("button", { name: "Warmer sky", exact: true }).click();
    await f.getByRole("button", { name: "Update theme", exact: true }).click();
    assert(await f.locator("#vu-loading").isVisible());
    await f.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await f.locator("#vu-title").innerText(), "Moonlight cabin");
    await f.getByRole("button", { name: "Update theme", exact: true }).click();
    await f.locator("#vu-loading").waitFor({ state: "hidden" });
    assert.equal(await f.locator("#vu-title").innerText(), "Golden hour");
    assert.deepEqual(await pos(), beforeAI, "AI must preserve manual layout");
    await f.getByRole("button", { name: "Before", exact: true }).click();
    assert.equal(await f.locator("#vu-title").innerText(), "Moonlight cabin");
    await f.getByRole("button", { name: "Before", exact: true }).click();
    await f
      .getByRole("button", { name: "Undo last edit", exact: true })
      .click();
    assert.equal(await f.locator("#vu-title").innerText(), "Moonlight cabin");
    assert.deepEqual(await pos(), beforeAI);
    await f
      .getByRole("button", { name: "Undo last edit", exact: true })
      .click();
    assert.deepEqual(
      await pos(),
      afterDrag,
      "Manual edit follows AI in same history",
    );
    await f
      .getByRole("button", { name: "Select artwork", exact: true })
      .click();
    assert(await f.locator("#vu-label-field").isHidden());
    assert.match(await f.locator("#vu-element-help").innerText(), /one image/);
    const artBefore = await f.locator("#vu-art").evaluate((c) => c.toDataURL());
    await f
      .getByRole("button", { name: "Remove the cabin", exact: true })
      .click();
    await f.getByRole("button", { name: "Update theme", exact: true }).click();
    await f.locator("#vu-loading").waitFor({ state: "hidden" });
    assert.notEqual(
      await f.locator("#vu-art").evaluate((c) => c.toDataURL()),
      artBefore,
    );
    await f.getByRole("button", { name: "Almost empty", exact: true }).click();
    assert.equal(await f.locator("#vu-session-value").innerText(), "4%");
    await f.getByRole("button", { name: "No data", exact: true }).click();
    assert.equal(await f.locator("#vu-session-value").innerText(), "—");
    await f.getByRole("button", { name: "Normal", exact: true }).click();
    await f.getByRole("button", { name: "Save draft", exact: true }).click();
    assert.match(await f.locator("#vu-draft").innerText(), /Saved/);
    assert(await f.locator("#vu-screen").isVisible());
    await f
      .getByRole("button", { name: "Send to VibeTV", exact: true })
      .click();
    assert.match(await f.locator("#vu-status").innerText(), /not connected/);
    await f
      .getByRole("button", { name: "OpenAI · set up once", exact: true })
      .click();
    assert(await f.locator("#vu-setup").isVisible());
    assert(
      await f
        .getByLabel("API key field placeholder, disabled in prototype")
        .isDisabled(),
    );
    await f
      .getByRole("button", { name: "Try the setup demo", exact: true })
      .click();
    assert.match(
      await f.locator("#vu-connect-label").innerText(),
      /connected in demo/,
    );
    await f.getByRole("button", { name: "New theme", exact: true }).click();
    await f.getByRole("button", { name: "Keep editing", exact: true }).click();
    assert.equal(await f.locator("#vu-title").innerText(), "Quiet night");
    await f.getByRole("button", { name: "New theme", exact: true }).click();
    await f.getByRole("button", { name: "Start new", exact: true }).click();
    assert(await f.locator("#vu-placeholder").isVisible());
    await f
      .getByRole("button", { name: "Undo last edit", exact: true })
      .click();
    assert.equal(await f.locator("#vu-title").innerText(), "Quiet night");
    await f
      .getByRole("button", { name: "Select session remaining", exact: true })
      .click();
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const width of [1056, 768, 392, 352]) {
        await page.setViewportSize({ width, height: 1800 });
        const layout = await f.locator("#vu-studio").evaluate((root) => ({
          width: root.clientWidth,
          scroll: root.scrollWidth,
          outside: [
            ...root.querySelectorAll("button,input,textarea,.vu-device"),
          ]
            .filter((e) => e.getClientRects().length)
            .filter(
              (e) =>
                e.getBoundingClientRect().right >
                  root.getBoundingClientRect().right + 1 ||
                e.getBoundingClientRect().left <
                  root.getBoundingClientRect().left - 1,
            )
            .map((e) => e.id),
        }));
        assert(layout.scroll <= layout.width + 2, JSON.stringify(layout));
        assert.deepEqual(layout.outside, []);
        if (screenshotDir && (width === 1056 || width === 392))
          await f
            .locator("#vu-studio")
            .screenshot({
              path: screenshotDir + "/unified-" + scheme + "-" + width + ".png",
            });
        console.log("PASS responsive selected state", scheme, width);
      }
    }
    await f
      .getByRole("button", { name: "Deselect element", exact: true })
      .click();
    await page.setViewportSize({ width: 1056, height: 1400 });
    await page.emulateMedia({ colorScheme: "light" });
    if (screenshotDir)
      await f
        .locator("#vu-studio")
        .screenshot({ path: screenshotDir + "/unified-overview.png" });
    assert.deepEqual(errors, []);
    assert.deepEqual(
      requests,
      [],
      "Prototype must not request external resources",
    );
    console.log(
      "PASS unified selection, stationary canvas, move, drag, shared undo/redo, AI/cancel, removal, data states, same-screen save/send, setup walkthrough, safe new draft; no JS errors",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
