// Replay approved generated art through the normal AI button and real compiler.
// No credentials, paid provider calls, saved user drafts or hardware touched.
import { chromium } from 'playwright';
import { readFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const source=process.argv[2];
assert(source,'Supply the approved pet-study asset directory');
const output=await mkdtemp(join(tmpdir(),'vibetv-companion-flow-'));
const image=async name=>(await readFile(join(source,name))).toString('base64');
const background=await image('background-source.png');
const sheets=[await image('fox-source.png'),await image('bird-source.png')];
const style={packName:'Forest companions',title:'Forest',notes:'A fox and a small bird.',artPrompt:'Forest companions',environmentPrompt:'A quiet woodland clearing',animationMode:'four_frame',animationPrompt:'Gentle idle motion',backgroundColor:'#142820',panelColor:'#142820',textColor:'#FFFFFF',sessionColor:'#FFFFFF',weeklyColor:'#FFFFFF',borderRadius:0,progressStyle:'solid'};
const browser=await chromium.launch();
console.log('Artifacts: '+output);
try {
 for(const count of [1,2]) {
  const page=await browser.newPage({viewport:{width:1100,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/local-companion/v1/ai-theme/capabilities',route=>route.fulfill({json:{enabled:true,providers:[{id:'openai',configured:true,verificationRequired:false}]}}));
  let requests=0;
  const companions=[{id:'pet-1',x:125,y:59,size:44},{id:'pet-2',x:96,y:53,size:26}].slice(0,count).map((p,i)=>({...p,fps:4,frameCount:8,keyColor:'#FF00FF',sheetBase64:sheets[i],reuse:false}));
  await page.route('**/api/local-companion/v1/ai-theme/concepts',route=>{
   if(route.request().postDataJSON().target==='layout') return route.fulfill({json:{mode:'scene',notes:'Scene request',edits:[]}});
   assert.equal(route.request().postDataJSON().target,'companions');requests++;
   return route.fulfill({json:{style,imageBase64:background,imageContentType:'image/png',companions}});
  });
  await page.goto('http://localhost:3015/internal/theme-studio-preview');
  await page.getByLabel('Your idea',{exact:true}).fill(count===1?'A fox in a quiet woodland':'A fox and a small bird in a quiet woodland');
  await page.getByRole('button',{name:'Create with AI',exact:true}).click();
  await page.getByRole('dialog',{name:'Create with AI',exact:true}).waitFor();
  await page.getByLabel(/I agree to send/).check();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('textarea')?.value==='' || !!document.querySelector('p[role="alert"]'),null,{timeout:30000});
  assert.deepEqual(await page.locator('p[role="alert"]').allTextContents(),[]);
  assert.equal(requests,1);
  const render=page.locator('[aria-label^="Rendered VibeTV theme"]'),samples=new Set();
  for(let n=0;n<8;n++){await page.waitForTimeout(270);samples.add(await render.innerHTML());await render.screenshot({path:join(output,`${count}-frame-${n}.png`)});}
  assert(samples.size>3,'Sprite frames must visibly advance');
  await page.screenshot({path:join(output,`${count}-editor.png`),fullPage:true});
  await page.getByRole('button',{name:'More options',exact:true}).click();
  await page.locator('summary').filter({hasText:'Import & export'}).click();
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download editable design',exact:true}).click();
  const designPath=join(output,`${count}-design.json`);await(await download).saveAs(designPath);
  const design=JSON.parse(await readFile(designPath,'utf8'));
  const sprites=design.spec.primitives.filter(p=>/^\/themes\/u\/ai-pet-[12]\.cba$/.test(p.assetPath));
  assert.equal(sprites.length,count);
  for(const sprite of sprites){assert.equal(sprite.frameCount,8);assert(design.assets[sprite.assetPath].data.includes('.'),'Sprite needs transparent pixels');}
  const pack=page.waitForEvent('download');await page.getByRole('button',{name:'Export theme pack',exact:true}).click();await(await pack).saveAs(join(output,`${count}-theme.zip`));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({count,distinctSamples:samples.size,normalButton:'companions',compile:'pass',export:'pass',source:'replayed approved art, not a fresh provider call'}));
  await page.close();
 }
} finally {await browser.close();}
