import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp,readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const origin=process.env.THEME_STUDIO_PREVIEW_URL || "http://localhost:3015";
assert(["localhost","127.0.0.1"].includes(new URL(origin).hostname),"Local preview only");
const output=await mkdtemp(join(tmpdir(),"vibetv-unified-"));
const browser=await chromium.launch();
try {
  const page=await browser.newPage({viewport:{width:1200,height:1000}});
  page.setDefaultTimeout(15000);
  const errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  page.on("dialog",d=>d.accept());
  await page.goto(origin+"/internal/theme-studio-preview");
  await page.getByLabel("Your idea",{exact:true}).waitFor();
  const capabilities=await page.evaluate(async()=>{const r=await fetch("/api/local-companion/v1/ai-theme/capabilities");return {status:r.status,body:await r.json()};});
  assert.equal(capabilities.status,200); assert.equal(capabilities.body.enabled,true);
  const foreign=await page.request.put(origin+"/api/local-companion/v1/ai-theme/providers/openai/credential",{headers:{Origin:"https://evil.test"},data:{apiKey:"never-send"}});
  assert.equal(foreign.status(),403);
  console.log("PASS real local helper and foreign-origin rejection");

  // Every credential and paid response below is intercepted in this fresh
  // browser context. These are integration fixtures, not a real AI quality test.
  const fixtures=await page.evaluate(()=>{
    const canvas=document.createElement("canvas");canvas.width=240;canvas.height=128;
    const c=canvas.getContext("2d");
    c.fillStyle="#112233";c.fillRect(0,0,240,128);
    c.fillStyle="#334455";c.fillRect(76,16,40,42);
    c.fillStyle="#112233";c.fillRect(80,20,32,32);
    c.fillStyle="#FFFFFF";c.fillRect(88,28,12,2);c.fillRect(88,34,9,2);
    c.fillStyle="#334455";c.fillRect(34,61,160,8);c.fillRect(48,69,8,59);c.fillRect(171,69,8,59);
    const background=canvas.toDataURL().split(",")[1];
    const sheet=document.createElement("canvas");sheet.width=64;sheet.height=48;
    const s=sheet.getContext("2d");
    for(let i=0;i<4;i++){
      const x=(i%2)*32,y=Math.floor(i/2)*24;
      s.fillStyle="#112233";s.fillRect(x,y,32,24);
      s.fillStyle="#FFFFFF";s.fillRect(x+8,y+8+i,12,2);s.fillRect(x+8,y+14+i,9,2);
    }
    const frames=sheet.toDataURL().split(",")[1];
    const sprite=document.createElement("canvas");sprite.width=960;sprite.height=512;
    const p=sprite.getContext("2d");p.fillStyle="#FF00FF";p.fillRect(0,0,960,512);
    for(let i=0;i<4;i++){p.fillStyle="#FFFFFF";p.fillRect(i*240+85,190,65,75);p.fillRect(i*240+140,230-i*5,18,25);}
    return {background,frames,sprite:sprite.toDataURL().split(",")[1]};
  });
  let configured=false,verificationRequired=false,rejectKey=true,temporaryFailure=false,kind="static",slow=false;
  let credentialWrites=0,credentialDeletes=0;
  const requests=[];
  const style={packName:"Office",title:"Office",notes:"A quiet office.",artPrompt:"An office",environmentPrompt:"A quiet room",animationMode:"static",animationPrompt:"",backgroundColor:"#112233",panelColor:"#112233",textColor:"#FFFFFF",sessionColor:"#FFFFFF",weeklyColor:"#FFFFFF",progressStyle:"solid",borderRadius:0};
  await page.route("**/api/local-companion/v1/ai-theme/**",async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith("/capabilities")) return route.fulfill({json:{enabled:true,providers:[{id:"openai",configured,verificationRequired}]}});
    if(path.endsWith("/credential")) {configured=route.request().method()!=="DELETE";verificationRequired=configured;if(configured)credentialWrites++;else credentialDeletes++;return route.fulfill({json:{configured}});}
    if(path.endsWith("/verify")) {
      if(rejectKey) return route.fulfill({status:401,json:{error:{code:"provider_auth_failed"}}});
      if(temporaryFailure) return route.fulfill({status:502,json:{error:{code:"provider_unavailable",stage:"connection",providerStatus:503,providerCode:"server_error",reason:"Service temporarily unavailable.",requestId:"req_fixture_503"}}});
      verificationRequired=false;return route.fulfill({json:{verified:true}});
    }
    if(path.endsWith("/concepts")){
      if(route.request().postDataJSON().target==="layout") return route.fulfill({json:{mode:"scene",notes:"Scene request",edits:[]}});
      const input=route.request().postDataJSON();requests.push(input);
      assert.equal(input.target,"companions","Selection must never choose the AI target");
      if(slow) await new Promise(r=>setTimeout(r,700));
      if(kind==="reject") return route.fulfill({status:502,json:{error:{code:"animation_quality_failed",stage:"region",reason:"No suitable area fits the display.",assessment:true}}}).catch(()=>{});
      const concept={imageBase64:fixtures.background,imageContentType:"image/png",style:{...style}};
      if(kind==="scene"){
        concept.style={...style,animationMode:"scene_loop",animationPrompt:"Only the code moves",notes:"The monitor code moves."};
        concept.sceneAnimation={x:80,y:20,width:32,height:24,fps:4,sheetBase64:fixtures.frames};
      } else if(kind==="character"){
        concept.style={...style,animationMode:"four_frame",animationPrompt:"A gently moving character",notes:"A little character joins the scene."};
        concept.animation={fps:4,keyColor:"#FF00FF",spriteSheetBase64:fixtures.sprite};
      }
      return route.fulfill({json:concept}).catch(()=>{});
    }
    return route.abort();
  });
  await page.reload();
  const input=page.getByLabel("Your idea",{exact:true});
  const create=page.getByRole("button",{name:"Create with AI",exact:true});
  await input.waitFor();
  assert.equal(await page.getByRole("textbox").count(),1,"Input is visible before connecting");
  for(const label of ["Animate scene","Adjust scene motion","Update animation","Edit whole scene","Find motion area with AI","Set up AI"]){
    assert.equal(await page.getByRole("button",{name:label,exact:true}).count(),0);
  }
  await input.fill("A quiet office");
  await create.click();
  await page.getByRole("dialog",{name:"Create with AI",exact:true}).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await input.inputValue(),"A quiet office");
  assert.equal(requests.length,0);
  await create.click();
  await page.getByLabel(/I agree to send/).check();
  await page.getByLabel("OpenAI key",{exact:true}).fill("fixture-rejected-key");
  await page.getByRole("button",{name:"Connect and continue",exact:true}).click();
  await page.getByRole("alert").filter({hasText:"OpenAI rejected this key"}).waitFor();
  assert.equal(requests.length,0);
  rejectKey=false;
  temporaryFailure=true;
  await page.getByLabel("Replace OpenAI key",{exact:true}).fill("fixture-good-key");
  await page.getByRole("button",{name:"Connect and continue",exact:true}).click();
  await page.getByRole("alert").filter({hasText:"OpenAI HTTP 503 (server_error)"}).waitFor();
  assert.equal(await page.getByLabel("Replace OpenAI key",{exact:true}).inputValue(),"");
  assert.equal(credentialWrites,2);assert.equal(credentialDeletes,0);assert.equal(requests.length,0);
  await page.screenshot({path:join(output,"connection-retry-desktop.png")});
  await page.setViewportSize({width:390,height:740});
  await page.screenshot({path:join(output,"connection-retry-mobile.png")});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.setViewportSize({width:1200,height:1000});
  // A reload must not turn a saved-but-unverified credential into readiness.
  await page.reload();await input.waitFor();await input.fill("A quiet office");await create.click();
  await page.getByText("Key saved · check needed",{exact:true}).waitFor();
  assert.equal(requests.length,0);
  temporaryFailure=false;
  await page.getByRole("button",{name:"Retry connection check",exact:true}).click();
  await page.getByText("AI plan: A quiet office. Preview the result; Undo takes you back.",{exact:true}).waitFor();
  assert.equal(credentialWrites,2);assert.equal(credentialDeletes,0);
  assert.equal(requests.length,1,"Connect continues the original create, no second AI click");
  assert.equal(await input.inputValue(),"");
  // The generation fixture can finish before the setup dialog's exit transition.
  await page.getByRole("textbox").waitFor({state:"visible"});
  assert.equal(await page.getByRole("textbox").count(),1);
  console.log("PASS connection diagnostics, retry without re-pasting, pending after reload, no generation before verification, one automatic continuation");

  await page.getByRole("button",{name:"Add element",exact:true}).click();
  await page.getByRole("button",{name:/^Text Add a name/}).click();
  await page.getByLabel("Your text",{exact:true}).fill("My note");
  await page.getByRole("button",{name:"Move right",exact:true}).click();
  assert.equal(await input.count(),1,"Manual selection keeps the same AI input");
  await page.getByRole("button",{name:"Add element",exact:true}).click();
  await page.getByRole("button",{name:/^Reset countdown/}).click();
  await page.getByLabel("Reset for",{exact:true}).selectOption("2");
  await page.getByRole("button",{name:"Deselect element",exact:true}).click();

  kind="character";
  await input.fill("A little cat should live here");
  await create.click();
  await page.getByText("AI plan: A little character joins the scene. Preview the result; Undo takes you back.",{exact:true}).waitFor();
  const character=page.getByLabel("Select Animated character 2",{exact:true});
  await character.click();
  await page.getByRole("button",{name:"Move right",exact:true}).click();
  const characterX=await character.getAttribute("x");
  assert.equal(await page.getByLabel("Animation speed",{exact:true}).count(),0);
  await input.fill("The cat should rest more calmly");
  await create.click();
  await page.getByText("AI plan: A little character joins the scene. Preview the result; Undo takes you back.",{exact:true}).waitFor();
  await create.waitFor();
  assert.equal(await character.getAttribute("x"),characterX);
  assert(requests.at(-1).previous.referenceImageBase64,"Director sees actual composed artwork");
  assert(requests.at(-1).previous.animationSheetBase64);
  console.log("PASS same input with selected figure, current visual reference and preserved character position");

  kind="scene";
  await input.fill("Make the office itself feel alive");
  await create.click();
  await page.getByText("AI plan: The monitor code moves. Preview the result; Undo takes you back.",{exact:true}).waitFor();
  assert.equal(await character.count(),0);
  assert.equal(await page.getByLabel(/Select Scene motion area/).count(),0);
  assert.equal(await page.getByLabel("Scene motion style",{exact:true}).count(),0);
  const renderer=page.locator('[aria-label^="Rendered VibeTV theme"]');
  const renderedFrames=new Set();
  for(let i=0;i<8;i++){await page.waitForTimeout(160);renderedFrames.add(await renderer.innerHTML());}
  assert(renderedFrames.size>1,"Genuine frame playback in the renderer");
  await page.getByRole("button",{name:"Pause animation",exact:true}).click();
  const paused=await renderer.innerHTML();await page.waitForTimeout(350);
  assert.equal(await renderer.innerHTML(),paused);
  await page.getByRole("button",{name:"Play animation",exact:true}).click();
  await page.getByRole("button",{name:/Save (design|changes)/}).click();
  const saved=await page.evaluate(()=>localStorage.getItem("vibetv.controlCenter.userThemes"));
  const savedDoc=JSON.parse(saved).themes[0].document;
  assert(savedDoc.assets["/themes/u/ai-scene-loop.cba"]);
  assert(savedDoc.spec.primitives.some(p=>p.text==="My note"));
  assert(savedDoc.spec.primitives.some(p=>p.text?.includes("{usageSlot2Reset}")));
  assert(!saved.includes("fixture-good-key")&&!saved.includes("imageBase64"));
  await page.reload();
  await page.getByText("Your saved design is ready.",{exact:true}).waitFor();
  assert.equal(await page.getByRole("textbox").count(),1);
  console.log("PASS AI-chosen scene representation, no area controls, real playback/pause, labels/reset preserved and save/reload");

  const exportDesign=async()=>{
    await page.getByRole("button",{name:"More options",exact:true}).click();
    await page.locator("summary").filter({hasText:"Import & export"}).click();
    const download=page.waitForEvent("download");
    await page.getByRole("button",{name:"Download editable design",exact:true}).click();
    const file=await download;const location=join(output,"editable-"+Date.now()+".json");await file.saveAs(location);
    await page.keyboard.press("Escape");
    return JSON.parse(await readFile(location,"utf8"));
  };
  const beforeFailure=await exportDesign();
  kind="reject";
  await input.fill("An impossible movement");
  await create.click();
  await page.getByRole("alert").filter({hasText:"Motion area selection. AI assessment: No suitable area fits the display."}).waitFor();
  assert.equal(await page.getByRole("status").filter({hasText:"AI is designing"}).count(),0,"No stale progress after failure");
  await page.screenshot({path:join(output,"diagnostic-error-desktop.png"),fullPage:true,animations:"disabled"});
  await page.setViewportSize({width:390,height:900});
  await page.screenshot({path:join(output,"diagnostic-error-mobile.png"),fullPage:true,animations:"disabled"});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.setViewportSize({width:1200,height:1000});
  assert.deepEqual(await exportDesign(),beforeFailure,"Quality failure keeps exact previous document");
  kind="static";slow=true;
  await input.fill("Make everything still");
  await create.click();await page.getByRole("button",{name:"Cancel",exact:true}).click();
  await page.waitForTimeout(850);
  assert.deepEqual(await exportDesign(),beforeFailure,"Cancellation never applies a late result");
  slow=false;
  await create.click();
  await page.getByText("AI plan: A quiet office. Preview the result; Undo takes you back.",{exact:true}).waitFor();
  assert.equal(await page.getByRole("button",{name:"Pause animation",exact:true}).count(),0);
  await page.getByRole("button",{name:"Undo last edit",exact:true}).click();
  assert.deepEqual(await exportDesign(),beforeFailure,"Undo restores full scene animation");
  console.log("PASS invalid region, cancellation, static conversion and exact undo");

  await page.getByRole("button",{name:"More options",exact:true}).click();
  await page.locator("summary").filter({hasText:"Import & export"}).click();
  const download=page.waitForEvent("download");
  await page.getByRole("button",{name:"Export theme pack",exact:true}).click();
  const zip=await download;await zip.saveAs(join(output,"scene.zip"));
  const zipBytes=await readFile(join(output,"scene.zip"));
  assert.equal(zipBytes.readUInt32LE(0),0x04034b50);
  assert(zipBytes.includes(Buffer.from("ai-scene-loop.cba")));
  await page.keyboard.press("Escape");
  // JSON round trip and invalid input protection.
  await page.locator('input[type="file"][accept="application/json,.json"]').setInputFiles({name:"roundtrip.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(beforeFailure))});
  const discard=page.getByRole("button",{name:"Discard and continue",exact:true});
  if(await discard.count()) await discard.click();
  assert.deepEqual((await exportDesign()).spec,beforeFailure.spec);
  await page.locator('input[type="file"][accept="application/json,.json"]').setInputFiles({name:"bad.json",mimeType:"application/json",buffer:Buffer.from("{")});
  await page.getByRole("alert").filter({hasText:"could not be imported"}).waitFor();
  assert.deepEqual((await exportDesign()).spec,beforeFailure.spec);
  for(const dark of [false,true]){
    await page.evaluate(d=>document.documentElement.classList.toggle("dark",d),dark);
    for(const width of [1200,768,390,352]){
      await page.setViewportSize({width,height:900});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      assert.equal(await input.count(),1);
      if(width===1200||width===390) await page.screenshot({path:join(output,(dark?"dark":"light")+"-"+width+".png"),fullPage:true,animations:"disabled"});
    }
  }
  // Another tab can have a connected helper but no billing consent yet.
  await page.evaluate(()=>sessionStorage.clear());
  await page.reload();
  await input.waitFor();
  kind="static";
  await input.fill("Keep this office quiet");
  const beforeConsent=requests.length;
  await create.click();
  await page.getByRole("dialog",{name:"Create with AI",exact:true}).waitFor();
  await page.getByLabel(/I agree to send/).check();
  await page.getByRole("button",{name:"Continue",exact:true}).click();
  await page.getByText("AI plan: A quiet office. Preview the result; Undo takes you back.",{exact:true}).waitFor();
  await page.getByRole("textbox").waitFor();
  assert.equal(requests.length,beforeConsent+1,"Existing key + fresh consent continues the original request");
  configured=false;
  const count=requests.length;
  await input.fill("A softer atmosphere");
  await create.click();
  await page.getByRole("dialog",{name:"Create with AI",exact:true}).waitFor();
  assert.equal(requests.length,count);
  assert.equal(await page.getByLabel("OpenAI key",{exact:true}).inputValue(),"");
  await page.keyboard.press("Escape");
  assert.equal(await input.inputValue(),"A softer atmosphere");
  assert.deepEqual(errors,[]);
  console.log("PASS ZIP, JSON round trip, invalid import safety, desktop/mobile light/dark, lost-key reconnect, no JS errors");
  console.log("Integration fixtures only; no paid AI requests. Screenshots: "+output);
} finally {await browser.close();}
