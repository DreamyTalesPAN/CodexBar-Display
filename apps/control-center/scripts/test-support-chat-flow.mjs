import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
const allowedMetadataKeys = [
  "appVersion",
  "companionVersion",
  "deviceConnected",
  "platform",
  "source",
  "surface",
];

async function main() {
  const fixture = await startFixtureServer();
  const appPort = await findFreePort();
  const appUrl = `http://127.0.0.1:${appPort}`;
  const app = startNextDev({
    appPort,
    catalogUrl: `http://127.0.0.1:${fixture.port}/theme-packs.json`,
    webhookUrl: `http://127.0.0.1:${fixture.port}/support-chat`,
  });
  let browser;

  try {
    await waitForHttp(appUrl);
    browser = await chromium.launch({ headless: true });
    await testMobileStreamingAndSessionFlow(browser, appUrl, fixture);
    await testWindowsWebViewFlow(browser, appUrl, fixture);
    console.log("control-center support chat flow tests passed");
  } finally {
    await browser?.close();
    await stopProcess(app);
    await fixture.close();
  }
}

async function testMobileStreamingAndSessionFlow(browser, appUrl, fixture) {
  const context = await browser.newContext({
    viewport: { height: 844, width: 390 },
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error(`Browser page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      console.error(`Browser console error: ${message.text()}`);
    }
  });
  await routeCompanionMissing(page);
  await page.goto(appUrl, { waitUntil: "domcontentloaded" });

  const trigger = page.getByRole("button", { name: "Customer Service" });
  await trigger.waitFor({ timeout: 15_000 });
  await trigger.focus();
  assert(
    await trigger.evaluate((element) => element === document.activeElement),
    "Customer Service trigger is not keyboard focusable",
  );
  await page.keyboard.press("Enter");

  await page.getByRole("heading", { name: "VibeTV Support" }).waitFor();
  const sheet = page.locator(".vibetv-support-chat");
  const mobileBox = await sheet.boundingBox();
  assert(mobileBox, "support sheet has no mobile bounding box");
  assert(
    Math.abs(mobileBox.width - 390) < 2,
    `mobile support sheet should fill the viewport, got ${mobileBox.width}px`,
  );
  await page
    .getByText("AI-assisted support. Don’t share passwords, API keys, or payment details.")
    .waitFor();
  await page.getByRole("link", { name: "Privacy Policy" }).waitFor();
  assert(
    (await page.getByRole("link", { name: "Privacy Policy" }).getAttribute("href")) ===
      "https://vibetv.shop/policies/privacy-policy",
    "support chat privacy link is incorrect",
  );
  await waitFor(
    () => fixture.requests.some(({ body }) => body.action === "loadPreviousSession"),
    "initial chat session load",
  );
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert(
    fixture.requests.filter(({ body }) => body.action === "loadPreviousSession").length === 1,
    "opening chat created duplicate session requests",
  );
  const initialLoad = fixture.requests.find(
    ({ body }) => body.action === "loadPreviousSession",
  );
  assertRequestContract(initialLoad, {
    expectedPlatform: "macos",
    expectedSurface: "local-control-center",
  });

  const firstSessionId = initialLoad.body.sessionId;
  assert(firstSessionId, "initial chat request has no sessionId");
  const input = page.getByPlaceholder("Type your question…");
  await input.fill("How do I reconnect my VibeTV?");
  await input.press("Enter");
  await page.getByText("Hello from VibeTV Support.", { exact: true }).waitFor();

  const firstSend = fixture.requests.find(({ body }) => body.action === "sendMessage");
  assertRequestContract(firstSend, {
    expectedPlatform: "macos",
    expectedSurface: "local-control-center",
  });
  assert(
    firstSend.body.chatInput === "How do I reconnect my VibeTV?",
    "sendMessage request did not use the approved chatInput key",
  );
  assert(
    firstSend.body.sessionId === firstSessionId,
    "sendMessage request did not reuse the loaded session",
  );

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await trigger.click();
  await waitFor(
    () => fixture.requests.filter(({ body }) => body.action === "loadPreviousSession").length === 2,
    "session reload after reopening chat",
  );
  const secondLoad = fixture.requests.filter(
    ({ body }) => body.action === "loadPreviousSession",
  )[1];
  assert(
    secondLoad.body.sessionId === firstSessionId,
    "reopening chat did not restore the existing session",
  );

  await page
    .getByRole("button", { name: "Start a new support conversation" })
    .click();
  await waitFor(
    () => fixture.requests.filter(({ body }) => body.action === "loadPreviousSession").length === 3,
    "session load after starting a new conversation",
  );
  const resetLoad = fixture.requests.filter(
    ({ body }) => body.action === "loadPreviousSession",
  )[2];
  assert(
    resetLoad.body.sessionId && resetLoad.body.sessionId !== firstSessionId,
    "New conversation did not create a fresh session",
  );
  assert(
    (await page.evaluate(() => localStorage.getItem("n8n-chat/sessionId"))) ===
      resetLoad.body.sessionId,
    "fresh n8n sessionId was not persisted after reset",
  );

  fixture.failNextSend();
  const sendsBeforeFailure = fixture.requests.filter(
    ({ body }) => body.action === "sendMessage",
  ).length;
  await page.getByPlaceholder("Type your question…").fill("Please fail once");
  await page.getByPlaceholder("Type your question…").press("Enter");
  await page
    .getByRole("alert")
    .filter({ hasText: "Support is temporarily unavailable" })
    .waitFor({ timeout: 10_000 });
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert(
    fixture.requests.filter(({ body }) => body.action === "sendMessage").length ===
      sendsBeforeFailure + 1,
    "failed message was retried automatically",
  );

  await context.close();
}

async function testWindowsWebViewFlow(browser, appUrl, fixture) {
  const existingLoads = fixture.requests.filter(
    ({ body }) => body.action === "loadPreviousSession",
  ).length;
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
    viewport: { height: 600, width: 800 },
  });
  const page = await context.newPage();
  await routeCompanionMissing(page);
  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Customer Service" }).click();
  await waitFor(
    () =>
      fixture.requests.filter(({ body }) => body.action === "loadPreviousSession").length ===
      existingLoads + 1,
    "Windows WebView session load",
  );
  const load = fixture.requests.filter(
    ({ body }) => body.action === "loadPreviousSession",
  ).at(-1);
  assertRequestContract(load, {
    expectedPlatform: "windows",
    expectedSurface: "local-control-center",
  });
  const desktopBox = await page.locator(".vibetv-support-chat").boundingBox();
  assert(desktopBox, "support sheet has no Windows bounding box");
  assert(
    desktopBox.width >= 400 && desktopBox.width <= 450,
    `Windows support sheet width is outside the desktop range: ${desktopBox.width}px`,
  );
  await context.close();
}

async function routeCompanionMissing(page) {
  await page.route("**/api/local-companion/v1/**", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        error: {
          code: "companion_unavailable",
          message: "Mock Mac App is unavailable.",
          nextAction: "Use the test support chat.",
        },
      }),
      contentType: "application/json",
      status: 503,
    });
  });
}

function assertRequestContract(request, { expectedPlatform, expectedSurface }) {
  assert(request, "expected support chat request was not captured");
  assert(
    !Object.hasOwn(request.headers, "authorization"),
    "support chat request sent an Authorization header",
  );
  assert(request.body.metadata, "support chat request has no metadata");
  const metadataKeys = Object.keys(request.body.metadata).sort();
  assert(
    metadataKeys.every((key) => allowedMetadataKeys.includes(key)),
    `support chat request contains unsafe metadata: ${metadataKeys.join(", ")}`,
  );
  assert(
    request.body.metadata.source === "vibetv-control-center",
    "support chat source metadata is incorrect",
  );
  assert(
    request.body.metadata.surface === expectedSurface,
    `support chat surface metadata is incorrect: ${request.body.metadata.surface}`,
  );
  assert(
    request.body.metadata.platform === expectedPlatform,
    `support chat platform metadata is incorrect: ${request.body.metadata.platform}`,
  );
  assert(
    typeof request.body.metadata.deviceConnected === "boolean",
    "support chat deviceConnected metadata is not boolean",
  );
  for (const forbidden of [
    "apiKey",
    "deviceId",
    "ip",
    "logs",
    "provider",
    "target",
    "usage",
  ]) {
    assert(
      !Object.hasOwn(request.body.metadata, forbidden),
      `support chat request leaked ${forbidden}`,
    );
  }
}

async function startFixtureServer() {
  const requests = [];
  let failNext = false;
  const server = createServer(async (request, response) => {
    if (request.url === "/theme-packs.json") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ themes: [] }));
      return;
    }

    if (request.url !== "/support-chat") {
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("not found");
      return;
    }

    const corsHeaders = {
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Origin": request.headers.origin || "*",
      Vary: "Origin",
    };
    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders);
      response.end();
      return;
    }

    const body = JSON.parse(await readRequestBody(request));
    requests.push({ body, headers: request.headers });
    if (body.action === "loadPreviousSession") {
      response.writeHead(200, {
        ...corsHeaders,
        "Content-Type": "application/json",
      });
      response.end(JSON.stringify({ data: [] }));
      return;
    }
    if (body.action === "sendMessage" && failNext) {
      failNext = false;
      response.writeHead(503, {
        ...corsHeaders,
        "Content-Type": "application/json",
      });
      response.end(JSON.stringify({ message: "support fixture unavailable" }));
      return;
    }
    if (body.action === "sendMessage") {
      response.writeHead(200, {
        ...corsHeaders,
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.write(`${JSON.stringify({ type: "begin" })}\n`);
      response.write(`${JSON.stringify({ type: "item", content: "Hello " })}\n`);
      response.write(
        `${JSON.stringify({ type: "item", content: "from VibeTV Support." })}\n`,
      );
      response.end(`${JSON.stringify({ type: "end" })}\n`);
      return;
    }

    response.writeHead(400, {
      ...corsHeaders,
      "Content-Type": "application/json",
    });
    response.end(JSON.stringify({ message: "unsupported action" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return {
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    failNextSend: () => {
      failNext = true;
    },
    port: address.port,
    requests,
  };
}

function startNextDev({ appPort, catalogUrl, webhookUrl }) {
  const child = spawn(
    process.execPath,
    [nextBin, "dev", "--hostname", "127.0.0.1", "--port", String(appPort)],
    {
      cwd: root,
      env: {
        ...process.env,
        CONTROL_CENTER_ALLOW_CATALOG_FALLBACK: "1",
        NEXT_PUBLIC_VIBETV_SUPPORT_CHAT_ENABLED: "1",
        NEXT_PUBLIC_VIBETV_SUPPORT_CHAT_STREAMING_ENABLED: "1",
        NEXT_PUBLIC_VIBETV_SUPPORT_CHAT_WEBHOOK_URL: webhookUrl,
        SHOPIFY_STORE_DOMAIN: "",
        SHOPIFY_STOREFRONT_ACCESS_TOKEN: "",
        SHOPIFY_STOREFRONT_PRIVATE_TOKEN: "",
        THEME_PACK_CATALOG_URL: catalogUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
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
  const deadline = Date.now() + 30_000;
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

async function waitFor(predicate, label) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
