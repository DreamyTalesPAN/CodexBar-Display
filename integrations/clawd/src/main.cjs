// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {randomBytes}=require('node:crypto');
// Upstream diagnostic messages can contain project names. The transport emits
// only the explicit allowlisted snapshot below; diagnostics never leave it.
console.log=console.warn=console.error=()=>{};
const {createEngine}=require('./engine.cjs');
async function main() {
 const runtimeDir=process.argv[2];
 if(!runtimeDir||!path.isAbsolute(runtimeDir)) throw Error('runtime-directory-required');
 fs.mkdirSync(runtimeDir,{recursive:true,mode:0o700});
 const token=randomBytes(32).toString('hex');
 const engine=await createEngine({token,codexSessionsDir:path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'sessions')});
 const endpoint=path.join(runtimeDir,'endpoint.json');
 const temp=endpoint+'.'+process.pid+'.tmp';
 fs.writeFileSync(temp,JSON.stringify({schemaVersion:1,url:engine.url,token}),{mode:0o600});
 fs.renameSync(temp,endpoint);
 const emit=()=>process.stdout.write(JSON.stringify(engine.snapshot())+'\n');
 emit();const timer=setInterval(emit,1000);
 let closing=false;
 async function close() {
  if(closing)return;closing=true;clearInterval(timer);
  try {const current=JSON.parse(fs.readFileSync(endpoint));if(current.token===token)fs.unlinkSync(endpoint);}catch{}
  await engine.close();
 }
 process.stdin.resume();process.stdin.once('end',close);
 for(const signal of ['SIGTERM','SIGINT'])process.once(signal,close);
 process.stdout.on('error',close);
}
main().catch(()=>{process.exitCode=1;});
