// SPDX-License-Identifier: AGPL-3.0-only
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {profiles, configure, entryFor} = require('../src/integrations.cjs');
const {decodeWindowsEncodedCommand} = require('../upstream/hooks/json-utils');

function fixture(t) {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibetv-observer-' $-"));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 return {settingsPath:path.join(dir,'settings.json'), directory:dir, runtimeDir:path.join(dir,'runtime'), claudeVersionInfo:{version:'2.1.78',status:'known',source:'test'}};
}
for (const agentId of Object.keys(profiles)) {
 for (const platform of ['darwin','win32']) test(`${agentId} ${platform}: install/update/remove preserves native hooks and permissions`, t=>{
  const opts={...fixture(t), platform};
  const original={permissions:{allow:['Read'],deny:['Bash']}, statusLine:{command:'my-status'}, hooks:{PreToolUse:[{matcher:'*',hooks:[{type:'command',command:'my-own-hook'},{type:'http',url:'http://localhost/existing-permission'}]}]}};
  fs.writeFileSync(opts.settingsPath,JSON.stringify(original));
  configure(agentId,true,opts);
  const first=fs.readFileSync(opts.settingsPath,'utf8');
  configure(agentId,true,opts);
  assert.equal(fs.readFileSync(opts.settingsPath,'utf8'),first,'idempotent');
  configure(agentId,true,{...opts,directory:path.join(opts.directory,'new-version')});
  const updated=fs.readFileSync(opts.settingsPath,'utf8');
  assert.notEqual(updated,first,'bundle replacement uses new observer');
  configure(agentId,false,opts);
  const restored=JSON.parse(fs.readFileSync(opts.settingsPath));
  const backupExpected=structuredClone(original);
  if(agentId==='copilot-cli') original.version=1;
  assert.deepEqual(restored,original);
  assert.deepEqual(JSON.parse(fs.readFileSync(opts.settingsPath+'.vibetv-backup')), backupExpected);
 });
}
test('malformed or explicitly disabled agent settings are never reset', t=>{
 const opts=fixture(t);
 for(const data of ['{broken','null','[]','{"disableAllHooks":true}','{"hooks":{"SessionStart":"custom"}}']) {
  fs.writeFileSync(opts.settingsPath,data);
  assert.throws(()=>configure('claude-code',true,opts));
  assert.equal(fs.readFileSync(opts.settingsPath,'utf8'),data);
 }
});
test('Claude version gates come from upstream; work-performing hooks are never installed', t=>{
 const opts=fixture(t);
 configure('claude-code',true,opts);
 let hooks=JSON.parse(fs.readFileSync(opts.settingsPath)).hooks;
 assert.ok(hooks.PreCompact);assert.ok(hooks.StopFailure);assert.ok(hooks.PermissionRequest);
 assert.equal(hooks.WorktreeCreate,undefined);
 configure('claude-code',true,{...opts,claudeVersionInfo:{version:'2.1.1',status:'known'}});
 hooks=JSON.parse(fs.readFileSync(opts.settingsPath)).hooks;
 assert.equal(hooks.StopFailure,undefined);assert.equal(hooks.PreCompact,undefined);
});
test('POSIX commands execute the bundled runtime with spaces and shell metacharacters', {skip:process.platform==='win32'}, t=>{
 const opts=fixture(t);
 fs.symlinkSync(process.execPath,path.join(opts.directory,'node'));
 fs.mkdirSync(path.join(opts.directory,'src'));
 fs.writeFileSync(path.join(opts.directory,'src/vibetv-observe.cjs'),'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
 const entry=entryFor('claude-code','PreToolUse',{...opts,platform:'darwin'});
 const result=spawnSync('/bin/sh',['-c',entry.hooks[0].command],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 assert.deepEqual(JSON.parse(result.stdout),[opts.runtimeDir,'claude-code','PreToolUse']);
});
test('Windows commands use absolute bundled Node, including Git Bash clients',()=>{
 const opts={directory:'C:\\Program Files\\VibeTV',runtimeDir:'C:\\Users\\A B\\VibeTV',platform:'win32'};
 for(const agentId of Object.keys(profiles)) {
  const entry=entryFor(agentId,'SessionStart',opts);
  const command=entry.hooks?.[0].command || entry.powershell;
  if(profiles[agentId].bash) assert.match(command,/'C:\/Program Files\/VibeTV\/node.exe'/);
  else assert.match(decodeWindowsEncodedCommand(command),/Program Files.*node.exe/);
  assert.doesNotMatch(command,/^node /);
 }
});


test('app upgrade refreshes only previously enabled hooks, preserving native settings',t=>{
 const opts=fixture(t);
 const originalFiles=new Map(Object.values(profiles).map(profile=>[profile,profile.file]));
 // Redirect every profile before refresh, including clients not in this fixture.
 for(const [id,profile] of Object.entries(profiles)) profile.file=()=>path.join(opts.directory,id+'.json');
 try {
  const oldOptions={...opts,settingsPath:profiles['claude-code'].file(),directory:path.join(opts.directory,'old')};
  configure('claude-code',true,oldOptions);
  const foreign={hooks:{BeforeAgent:[{hooks:[{type:'command',command:'my-hook'}]}]}};
  fs.writeFileSync(profiles['gemini-cli'].file(),JSON.stringify(foreign));
  require('../src/integrations.cjs').refreshConfigured({...opts,settingsPath:undefined,directory:path.join(opts.directory,'new')});
  const changed=fs.readFileSync(oldOptions.settingsPath,'utf8');
  assert.match(changed,/new/);assert.doesNotMatch(changed,/\/old\//);
  assert.deepEqual(JSON.parse(fs.readFileSync(profiles['gemini-cli'].file())),foreign);
  assert.equal(fs.existsSync(profiles['qwen-code'].file()),false);
 } finally {
  for(const [profile,file] of originalFiles) {if(file)profile.file=file;else delete profile.file;}
 }
});
