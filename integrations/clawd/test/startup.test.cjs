// SPDX-License-Identifier: AGPL-3.0-only
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {createInterface}=require('node:readline');
const {buildObservation}=require('../src/hooks.cjs');

for(const conflict of ['blocked','malformed']) test(`startup ${conflict} native config leaves observation and recovery available`,{timeout:15000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vibetv-startup-'));
 const runtimeDir=path.join(dir,'runtime');
 const native=path.join(dir,'copilot-cli.json');
 const original=conflict==='blocked'?JSON.stringify({disableAllHooks:true}):'{broken';
 fs.writeFileSync(native,original);
 // Redirect all native files before main starts; never touch the host's settings.
 const preload=path.join(dir,'fixture.cjs');
 fs.writeFileSync(preload,`const {profiles}=require(${JSON.stringify(path.resolve(__dirname,'../src/integrations.cjs'))});for(const [id,p] of Object.entries(profiles))p.file=()=>require('node:path').join(${JSON.stringify(dir)},id+'.json');`);
 const child=spawn(process.execPath,['--require',preload,path.resolve(__dirname,'../src/main.cjs'),runtimeDir,'true','30'],{env:{...process.env,CODEX_HOME:path.join(dir,'codex')},stdio:['pipe','pipe','pipe']});
 const exited=once(child,'exit');
 t.after(async()=>{child.stdin.end();if(child.exitCode===null&&!child.signalCode)child.kill();await exited;fs.rmSync(dir,{recursive:true,force:true});});
 const lines=createInterface({input:child.stdout});
 const [line]=await once(lines,'line');
 const first=JSON.parse(line);
 assert.equal(first.health,'ready');
 assert.equal(fs.readFileSync(native,'utf8'),original,'startup overwrote the conflicting native file');
 const endpoint=JSON.parse(fs.readFileSync(path.join(runtimeDir,'endpoint.json')));
 const post=(url,data)=>fetch(endpoint.url+url,{method:'POST',headers:{Authorization:'Bearer '+endpoint.token},body:JSON.stringify(data)});
 assert.equal((await post('/state',buildObservation('claude-code','UserPromptSubmit',{session_id:'existing-hook'},()=>({})))).status,200);
 const snap=await (await fetch(endpoint.url+'/snapshot',{headers:{Authorization:'Bearer '+endpoint.token}})).json();
 assert.equal(snap.sessions[0].phase,'working','one conflicting config disabled an existing observer');
 assert.equal(snap.instance,first.instance,'engine restarted on conflict');
 if(conflict==='malformed') {
  assert.equal((await post('/integrations',{enabled:false})).status,409,'do not overwrite unreadable customer settings');
  fs.writeFileSync(native,'{}');
 }
 const disabled=await post('/integrations',{enabled:false});
 assert.equal(disabled.status,200,'normal master-off endpoint is unreachable');
 assert.equal((await disabled.json()).sessions.length,0);
 assert.equal((await post('/state',buildObservation('claude-code','UserPromptSubmit',{session_id:'removed-hook'},()=>({})))).status,204);
});
