import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const origin = process.env.THEME_STUDIO_PREVIEW_URL || "http://localhost:3015";
assert(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const output = await mkdtemp(join(tmpdir(), "vibetv-editor-controls-"));
const browser = await chromium.launch();
const text = (value, x, y) => ({ type: "text", x, y, text: value, fontSize: 1, color: "#FFFFFF" });
const fixture = {
  packName: "Keyboard fixture", assets: {}, usage: "live",
  spec: { themeSpecVersion: 1, themeId: "keyboard-fixture", themeRev: 1, bgColor: "#112233", primitives: [
    { type: "rect", x: 0, y: 128, width: 240, height: 112, color: "#223344" },
    text("SESSION", 12, 134), text("{session}%", 152, 134),
    { type: "progress", x: 12, y: 154, width: 216, height: 13, binding: "session", color: "#FFFFFF" }, text("{usageMode}", 12, 170),
    text("WEEKLY", 12, 184), text("{weekly}%", 152, 184),
    { type: "progress", x: 12, y: 204, width: 216, height: 13, binding: "weekly", color: "#FFFFFF" }, text("{usageMode}", 12, 220),
    text("Hello", 20, 30),
  ] },
};
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  page.setDefaultTimeout(12000);
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.addInitScript((document) => {
    localStorage.setItem("vibetv.controlCenter.userThemes", JSON.stringify({ schemaVersion: 1, themes: [{ id: "fixture", updatedAt: "2026-09-09T09:00:00Z", document }] }));
    sessionStorage.setItem("vibetv.aiTheme.consent", "1");
  }, fixture);
  // All AI and credential traffic is intercepted. Never bill an account.
  await page.route("**/api/local-companion/v1/ai-theme/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/capabilities")) return route.fulfill({ json: { enabled: true, providers: [{ id: "openai", configured: true, verificationRequired: false }] } });
    if (path.endsWith("/concepts")) {
      requests.push(route.request().postDataJSON());
      return route.fulfill({ status: 502, json: { error: { code: "provider_unavailable" } } });
    }
    throw new Error(`Unexpected AI request: ${path}`);
  });
  await page.goto(origin + "/internal/theme-studio-preview");
  await page.getByText("Your saved design is ready.", { exact: true }).waitFor();
  const canvas = page.getByRole("region", { name: "Design canvas", exact: true });
  const idea = page.getByLabel("Your idea", { exact: true });
  const openTools = async () => page.getByRole("button", { name: "More options", exact: true }).click();
  async function snapshot() {
    if (!await page.getByRole("dialog").count()) await openTools();
    const details = page.locator("details").filter({ has: page.locator("summary", { hasText: "Import & export" }) });
    if (!await details.getAttribute("open").then((value) => value !== null)) await details.locator("summary").click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download editable design", exact: true }).click();
    const file = await download;
    const data = JSON.parse(await readFile(await file.path(), "utf8"));
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    return data;
  }
  async function elements() {
    await openTools();
    await page.locator("summary").filter({ hasText: "Elements in this design" }).click();
  }
  async function selectHello() {
    await canvas.getByRole("button", { name: "Select Hello 10", exact: true }).click();
    assert.equal(await canvas.evaluate((node) => document.activeElement === node), true, "Clicking preview takes focus away from prompt");
  }
  const original = await snapshot();
  await idea.fill("Draft prompt");
  await selectHello();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  let current = await snapshot();
  assert.equal(current.spec.primitives[9].x, 21);
  assert.equal(current.spec.primitives[9].y, 40);
  await page.keyboard.press("Meta+z");
  current = await snapshot();
  assert.equal(current.spec.primitives[9].y, 30);
  await page.keyboard.press("Control+z");
  assert.deepEqual(await snapshot(), original);
  await page.keyboard.press("Control+y");
  assert.equal((await snapshot()).spec.primitives[9].x, 21);
  await page.keyboard.press("Meta+Shift+z");
  assert.equal((await snapshot()).spec.primitives[9].y, 40);
  await page.keyboard.press("Control+Shift+z"); // Empty future is a safe no-op.
  await selectHello();
  await page.keyboard.press("Backspace");
  assert.equal((await snapshot()).spec.primitives.length, 9);
  await page.keyboard.press("Control+z");
  await selectHello();
  await page.keyboard.press("Delete");
  assert.equal((await snapshot()).spec.primitives.length, 9);
  await page.keyboard.press("Meta+z");
  console.log("PASS preview focus, 1/10-pixel arrows, Mac/Windows undo-redo, Delete and Backspace");

  await selectHello();
  const textInput = page.getByLabel("Your text", { exact: true });
  await textInput.fill("Hello again");
  await textInput.press("ArrowLeft");
  await textInput.press("Backspace");
  assert.equal(await textInput.inputValue(), "Hello agan");
  assert.equal((await snapshot()).spec.primitives.length, 10);
  await idea.fill("one");
  await idea.press("Meta+Enter");
  await idea.press("Control+Enter");
  await idea.press("Shift+Enter");
  assert.equal(await idea.inputValue(), "one\n\n\n");
  assert.equal(requests.length, 0);
  await idea.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  assert.equal(requests.length, 0, "IME confirmation does not submit");
  await idea.press("Enter");
  await page.waitForFunction(() => !document.querySelector("#ai-scene-request")?.disabled);
  assert.equal(requests.length, 1, JSON.stringify(await page.getByRole("alert").allTextContents()));
  assert.equal(requests[0].prompt, "one\n\n\n");
  await idea.fill("");
  await idea.press("Enter");
  assert.equal(requests.length, 1, "Blank Enter does not submit");
  console.log("PASS native text editing, Enter submits once, Mac/Windows/Shift newline, IME and blank guards");

  await elements();
  await page.locator('[data-design-row="window-0"]').dragTo(page.locator('[data-design-row="window-1"]'));
  current = await snapshot();
  assert.deepEqual(current.spec.primitives.slice(1, 9).map((p) => p.y), [184, 184, 204, 220, 134, 134, 154, 170]);
  assert.deepEqual(current.spec.primitives[0], original.spec.primitives[0]);
  await page.keyboard.press("Control+z");
  assert.deepEqual((await snapshot()).spec.primitives.slice(0, 9), original.spec.primitives.slice(0, 9));
  await elements();
  await page.getByLabel("Keep usage sections together").uncheck();
  await page.locator('[data-design-row="element-1"]').dragTo(page.locator('[data-design-row="element-5"]'));
  current = await snapshot();
  assert.equal(current.spec.primitives[1].y, 184);
  assert.equal(current.spec.primitives[5].y, 134);
  assert.equal(current.spec.primitives[2].y, 134, "Ungrouped move leaves other elements alone");
  await page.keyboard.press("Meta+z");
  await elements();
  await page.getByLabel("Arrange elements", { exact: true }).selectOption("layers");
  await page.locator('[data-design-row="element-1"]').dragTo(page.locator('[data-design-row="element-5"]'));
  current = await snapshot();
  assert.equal(current.spec.primitives[5].text, "SESSION");
  assert.equal(current.spec.primitives[5].y, 134, "Layer reordering does not change position");
  await page.keyboard.press("Meta+z");
  await elements();
  await page.getByRole("button", { name: "Move down: Session section", exact: true }).focus();
  await page.keyboard.press("Enter");
  assert.equal((await snapshot()).spec.primitives[1].y, 184);
  await page.keyboard.press("Meta+z");
  await elements();
  await page.getByRole("button", { name: "Move down: Session section", exact: true }).click();
  await page.keyboard.press("Control+z");
  assert.equal((await snapshot()).spec.primitives[1].y, 134, "Undo also works while arranging in the dialog");
  console.log("PASS drag/drop whole usage sections, individual position, layer order, keyboard alternative and exact undo");

  for (const name of ["Text", "Usage bar", "Reset countdown", "Session usage", "Weekly usage", "Usage direction", "Other live information", "Shape", "Clock"]) {
    const before = (await snapshot()).spec.primitives.length;
    await page.getByRole("button", { name: "Add element", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: new RegExp(`^${name} `) }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal((await snapshot()).spec.primitives.length, before + 1, name);
  }
  const last = (await snapshot()).spec.primitives.length;
  await canvas.getByRole("button", { name: `Select Clock ${last}`, exact: true }).click();
  const reading = page.getByLabel("Live information to show", { exact: true });
  const options = await reading.locator("option").evaluateAll((nodes) => nodes.map((node) => node.value));
  for (const key of options) {
    await reading.selectOption(key);
    assert.deepEqual((await page.getByRole("alert").allTextContents()).filter((value) => value.trim()), [], `No validation error for ${key}`);
  }
  await reading.selectOption("weekly");
  current = await snapshot();
  assert.equal(current.spec.primitives.at(-1).text, "{weekly}%");
  assert.equal(current.spec.primitives.at(-1).slot, 2);
  await canvas.focus();
  await page.keyboard.press("Control+s");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("vibetv.controlCenter.userThemes")));
  assert.deepEqual(saved.themes[0].document, current);
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("region", { name: "Selected element tools" }).count(), 0);
  console.log(`PASS all 9 add actions, ${options.length} live reading options, Windows save/select-all and Escape`);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await elements();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const dialog = page.getByRole("dialog");
  assert.equal(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth), true);
  await page.screenshot({ path: join(output, "mobile-elements.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Add element", exact: true }).click();
  await page.screenshot({ path: join(output, "mobile-add.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1200, height: 1000 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  await page.getByText("Your saved design is ready.", { exact: true }).waitFor();
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await canvas.getByRole("button", { name: "Select Weekly usage 7", exact: true }).click();
  await page.screenshot({ path: join(output, "desktop.png"), fullPage: true });
  assert.deepEqual(errors, []);
  console.log("PASS mobile overflow, dark/reduced-motion rendering and no browser errors");
  console.log(`Screenshots: ${output}`);
} finally {
  await browser.close();
}
