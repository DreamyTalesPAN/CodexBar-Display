// SPDX-License-Identifier: AGPL-3.0-only
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
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
