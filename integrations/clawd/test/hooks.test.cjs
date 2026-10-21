// SPDX-License-Identifier: AGPL-3.0-only
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {spawn, spawnSync} = require('node:child_process');
const path = require('node:path');
const {adapters, buildObservation} = require('../src/hooks.cjs');

for (const agent of Object.keys(adapters)) {
  test('original hook builder: ' + agent, () => {
    const event = agent === 'copilot-cli' ? 'sessionStart' : agent === 'antigravity-cli' ? 'PreInvocation' : 'SessionStart';
    const body = buildObservation(agent, event, {session_id:'isolated-session',sessionId:'isolated-session',conversationId:'isolated-session'}, () => ({pidChain:[]}));
    assert.equal(body.agent_id, agent);
    assert.match(body.session_id, /isolated-session/);
    assert.ok(body.event);
  });
}

test('observer failure and Gemini events emit only neutral output', async () => {
  for (const [agent, event, payload] of [
    ['claude-code', 'PermissionRequest', '{"session_id":"isolated-session","tool_name":"Bash"}'],
    ['gemini-cli', 'BeforeTool', '{"session_id":"isolated-session","tool_name":"run_shell_command"}'],
    ['claude-code', 'PreToolUse', 'malformed'],
  ]) {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(__dirname,'../src/vibetv-observe.cjs'), '/nonexistent-vibetv-fixture', agent, event]);
      let stdout='', stderr='';
      child.stdout.on('data', chunk=>stdout+=chunk);
      child.stderr.on('data', chunk=>stderr+=chunk);
      child.on('error', reject);
      child.on('exit', code=>resolve({code,stdout,stderr}));
      child.stdin.end(payload);
    });
    assert.deepEqual(result, {code:0, stdout:'{}\n', stderr:''});
  }
});

test('QwenWork permission notifications remain ordinary work, not native approval waits',()=>{
 const body=buildObservation('qwenwork','PermissionRequest',{session_id:'isolated-session'},()=>({pidChain:[]}));
 assert.equal(body.state,'working');
});

test('Claude permission correlation requires exact input and one unresolved native call',t=>{
 const fs=require('node:fs'),os=require('node:os');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vibetv-permission-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const transcript_path=path.join(dir,'session.jsonl');
 const payload={session_id:'one',transcript_path,tool_name:'Write',tool_input:{file_path:'/test',content:'PRIVATE'}};
 const call=(id,input=payload.tool_input,sessionId='one')=>({type:'assistant',sessionId,message:{content:[{type:'tool_use',id,name:'Write',input}]}});
 const write=rows=>fs.writeFileSync(transcript_path,rows.map(JSON.stringify).join('\n')+'\n');
 const observe=()=>buildObservation('claude-code','PermissionRequest',payload,()=>({})).tool_use_id;
 write([call('other-input',{file_path:'/different'}),call('other-session',payload.tool_input,'two')]);
 assert.equal(observe(),undefined);
 write([call('a'),call('b')]);assert.equal(observe(),undefined);
 write([call('a'),call('b'),{type:'user',sessionId:'one',message:{content:[{type:'tool_result',tool_use_id:'a'}]}}]);
 assert.equal(observe(),'b');
});

test('generated hook command exits 0 silently when the bundled node or observer is missing (#851)', t => {
  const fs = require('node:fs'), os = require('node:os');
  const {entryFor} = require('../src/integrations.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibetv-hook-guard-' $-"));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const run = command => spawnSync('/bin/sh', ['-c', command], {encoding: 'utf8'});
  const command = entryFor('claude-code', 'SessionStart', {runtimeDir: dir, directory: path.join(dir, 'missing'), platform: 'darwin'}).hooks[0].command;
  const missing = run(command);
  assert.equal(missing.status, 0);
  assert.equal(missing.stdout + missing.stderr, '');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'node'), '#!/bin/sh\necho ran "$@"\n', {mode: 0o755});
  fs.writeFileSync(path.join(dir, 'src', 'vibetv-observe.cjs'), '');
  const present = entryFor('claude-code', 'SessionStart', {runtimeDir: dir, directory: dir, platform: 'darwin'}).hooks[0].command;
  assert.equal(run(present).stdout, `ran ${path.join(dir, 'src', 'vibetv-observe.cjs')} ${dir} claude-code SessionStart\n`);
});
