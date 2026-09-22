// Offline generated-design import/export regression; no provider or device calls.
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const [root]=process.argv.slice(2),browser=await chromium.launch();
try{
 for(const name of ['one','two']){
  const page=await browser.newPage({viewport:{width:1100,height:1000}}),dir=path.join(root,name),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/local-companion/v1/ai-theme/concepts',()=>{throw Error('Unexpected provider call');});
  await page.goto('http://localhost:3015/internal/theme-studio-preview');
  await page.locator('input[type="file"][accept="application/json,.json"]').setInputFiles(path.join(dir,'design.json'));
  await page.getByText('Design opened.',{exact:true}).waitFor();
  const render=page.locator('[aria-label^="Rendered VibeTV theme"]'),samples=new Set();
  for(let i=0;i<10;i++){await page.waitForTimeout(140);samples.add(await render.innerHTML());}
  assert(samples.size>3,'Imported sprite animation does not advance');
  await page.screenshot({path:path.join(dir,'editor.png'),fullPage:true});
  await page.getByRole('button',{name:'More options',exact:true}).click();
  await page.locator('summary').filter({hasText:'Import & export'}).click();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download editable design',exact:true}).click();await(await download).saveAs(path.join(dir,'roundtrip.json'));
  const original=JSON.parse(await fs.readFile(path.join(dir,'design.json'))),actual=JSON.parse(await fs.readFile(path.join(dir,'roundtrip.json')));
  assert.deepEqual(actual.assets,original.assets,'Asset content changed on roundtrip');
  assert.deepEqual(actual.spec.primitives.filter(p=>p.assetPath),original.spec.primitives.filter(p=>p.assetPath),'Sprite positions/order changed');
  const pack=page.waitForEvent('download');await page.getByRole('button',{name:'Export theme pack',exact:true}).click();await(await pack).saveAs(path.join(dir,'theme.zip'));
  assert.deepEqual(errors,[]);console.log({name,distinctRenderedSamples:samples.size,roundtrip:'exact assets and sprite placement',zipBytes:(await fs.stat(path.join(dir,'theme.zip'))).size});await page.close();
 }
}finally{await browser.close();}
