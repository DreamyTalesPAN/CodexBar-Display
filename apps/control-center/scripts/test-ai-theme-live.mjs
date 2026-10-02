// Explicitly opt-in paid test. Fresh browser context; never touches user tabs.
import { chromium } from "playwright";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const replayPath = process.env.REPLAY_AI_RESULT;
assert(replayPath || process.env.ALLOW_PAID_AI_TEST === "1", "Requires explicit paid-test authorization");
const prompt = process.argv[2];
assert(prompt, "Supply one test prompt");
const output = await mkdtemp(join(tmpdir(), "vibetv-live-ai-"));
const browser = await chromium.launch();
const page = await browser.newPage({viewport:{width:1200,height:1000}});
page.setDefaultTimeout(15000);
const errors=[];
const alerts=page.locator('p[role="alert"]');
let beforeGeneration;
page.on("pageerror", e=>errors.push(e.message));
console.log("Artifacts: "+output);
try {
  if (replayPath) {
    const captured = JSON.parse(await readFile(replayPath, "utf8"));
    assert(captured.imageBase64, "Replay requires a successful captured provider result");
    await page.route("**/api/local-companion/v1/ai-theme/concepts", route => route.fulfill({json: route.request().postDataJSON().target === "layout" ? {mode:"scene",notes:"Scene request",edits:[]} : captured}));
    console.log("REPLAY stored result; no paid generation in this run");
  }
  await page.goto("http://localhost:3015/internal/theme-studio-preview");
  const input=page.getByLabel("Your idea",{exact:true});
  await input.waitFor();
  const cap=await page.evaluate(async()=> (await fetch("/api/local-companion/v1/ai-theme/capabilities")).json());
  assert.equal(cap.providers?.find(p=>p.id==="openai")?.configured,true,"Connect key in the user UI first");
  if(process.argv[3]) {
    await page.locator('input[type="file"][accept="application/json,.json"]').setInputFiles(process.argv[3]);
    await page.getByText("Design opened.",{exact:true}).waitFor();
    // Compare Undo with the accepted editor state, not unrecognised fields
    // which the normal file importer may have canonicalised on entry.
    await page.getByRole("button",{name:"More options",exact:true}).click();
    await page.locator("summary").filter({hasText:"Import & export"}).click();
    const baseline=page.waitForEvent("download");
    await page.getByRole("button",{name:"Download editable design",exact:true}).click();
    await (await baseline).saveAs(join(output,"before.json"));
    beforeGeneration=JSON.parse(await readFile(join(output,"before.json"),"utf8"));
    await page.getByRole("button",{name:"Close",exact:true}).click();
  }
  await input.fill(prompt);
  await page.getByRole("button",{name:"Create with AI",exact:true}).click();
  await page.getByRole("dialog",{name:"Create with AI",exact:true}).waitFor();
  await page.getByLabel(/I agree to send/).check();
  const responsePromise=page.waitForResponse(r=>r.url().endsWith("/ai-theme/concepts") && r.request().postDataJSON().target !== "layout",{timeout:250000});
  const started=Date.now();
  await page.getByRole("button",{name:"Continue",exact:true}).click();
  const response=await responsePromise;
  const body=await response.json();
  await writeFile(join(output,"provider-result.json"),JSON.stringify(body));
  const report={prompt,replayed:!!replayPath,status:response.status(),seconds:Math.round((Date.now()-started)/1000),style:body.style,error:body.error};
  console.log(JSON.stringify(report));
  await writeFile(join(output,"report.json"),JSON.stringify(report,null,2));
  if(body.imageBase64) await writeFile(join(output,"artwork.png"),Buffer.from(body.imageBase64,"base64"));
  if(body.sceneAnimation) await writeFile(join(output,"scene-sheet.png"),Buffer.from(body.sceneAnimation.sheetBase64,"base64"));
  if(body.animation) await writeFile(join(output,"character-sheet.png"),Buffer.from(body.animation.spriteSheetBase64,"base64"));
  if(!response.ok()) {
    await alerts.first().waitFor();
    console.log("UI error: "+await alerts.allTextContents());
    await page.screenshot({path:join(output,"failure.png"),fullPage:true,animations:"disabled"});
    process.exitCode=1;
  } else {
    await page.waitForFunction(()=>document.querySelector('textarea')?.value==="" || !!document.querySelector('p[role="alert"]'),null,{timeout:30000});
    if(await alerts.count()) throw new Error("Compilation: "+await alerts.allTextContents());
    await page.screenshot({path:join(output,"screen.png"),fullPage:true,animations:"disabled"});
    const render=page.locator('[aria-label^="Rendered VibeTV theme"]');
    const frames=new Set();
    for(let n=0;n<8;n++) {
      await page.waitForTimeout(270);
      frames.add(await render.innerHTML());
      await render.screenshot({path:join(output,`frame-${n}.png`)});
    }
    console.log("Distinct rendered samples: "+frames.size);
    if (body.sceneAnimation) assert(frames.size > 1, "Scene does not visibly advance");
    await page.getByRole("button",{name:"More options",exact:true}).click();
    await page.locator("summary").filter({hasText:"Import & export"}).click();
    const download=page.waitForEvent("download");
    await page.getByRole("button",{name:"Download editable design",exact:true}).click();
    await (await download).saveAs(join(output,"design.json"));
    const design=JSON.parse(await readFile(join(output,"design.json"),"utf8"));
    console.log("Assets: "+Object.keys(design.assets).join(", "));
    const pack=page.waitForEvent("download");
    await page.getByRole("button",{name:"Export theme pack",exact:true}).click();
    await (await pack).saveAs(join(output,"theme.zip"));
    if(process.argv[3]) {
      await page.getByRole("button",{name:"Close",exact:true}).click();
      await page.getByRole("button",{name:"Undo last edit",exact:true}).click();
      await page.getByRole("button",{name:"More options",exact:true}).click();
      await page.locator("summary").filter({hasText:"Import & export"}).click();
      const undone=page.waitForEvent("download");
      await page.getByRole("button",{name:"Download editable design",exact:true}).click();
      await (await undone).saveAs(join(output,"undo.json"));
      assert.deepEqual(JSON.parse(await readFile(join(output,"undo.json"),"utf8")),beforeGeneration,"Undo must restore the accepted original exactly");
      console.log("PASS exact Undo after real compilation");
    }
    assert.deepEqual(errors,[]);
    console.log(`PASS ${replayPath ? "replayed stored result" : "real provider response"}, browser compilation and exports; visual review still required`);
  }
} catch(e) {
  await page.screenshot({path:join(output,"failure.png"),fullPage:true,animations:"disabled"}).catch(()=>{});
  throw e;
} finally { await browser.close(); }
