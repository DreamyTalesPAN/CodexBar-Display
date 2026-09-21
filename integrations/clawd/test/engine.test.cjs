// SPDX-License-Identifier: AGPL-3.0-only
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createEngine}=require('../src/engine.cjs');
const {buildObservation}=require('../src/hooks.cjs');
const token='test-only-token-'.repeat(3);
async function fixture(t) {
 const engine=await createEngine({token});t.after(()=>engine.close());
 const post=(body,url='/state')=>fetch(engine.url+url,{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify(body)});
 const event=(event,sid='one',extra={})=>post(buildObservation('claude-code',event,{session_id:sid,tool_name:'Read',...extra},()=>({})));
 return {engine,post,event};
}
test('real upstream ingress: lifecycle, two sessions and content redaction',async t=>{
 const {engine,event}=await fixture(t);
 for(const id of ['one','two']) {assert.equal((await event('SessionStart',id)).status,200);await event('UserPromptSubmit',id);}
 await event('PreToolUse','one',{cwd:'/private-project',tool_input:{command:'secret command'}});
 const snapshot=engine.snapshot();
 assert.equal(snapshot.sessions.length,2);
 assert.deepEqual(snapshot.sessions.map(s=>s.phase).sort(),['tool_use','working']);
 assert.doesNotMatch(JSON.stringify(snapshot),/private-project|secret command/);
 assert.equal(snapshot.sources.length,25);
});
test('native permissions and questions get no decision and keep wait across notification',async t=>{
 const {engine,event}=await fixture(t);
 await event('SessionStart');await event('UserPromptSubmit');
 for(const [tool,phase] of [['Bash','waiting_for_permission'],['AskUserQuestion','waiting_for_answer'],['ExitPlanMode','waiting_for_review']]) {
  await event('PreToolUse','one',{tool_name:tool});
  const response=await event('PermissionRequest','one',{tool_name:tool});
  assert.equal(response.status,200);
  assert.doesNotMatch(await response.text(),/allow|deny|decision/);
  await event('Notification','one',{notification_type:'permission_prompt'});
  assert.equal(engine.snapshot().sessions[0].phase,phase);
  await event('PostToolUse');
 }
});
test('AskUserQuestion PreToolUse is sufficient without PermissionRequest',async t=>{
 const {engine,event}=await fixture(t);await event('SessionStart');await event('PreToolUse','one',{tool_name:'AskUserQuestion'});
 assert.equal(engine.snapshot().sessions[0].phase,'waiting_for_answer');
});
test('all registered clients can use observation ingress with separate IDs',async t=>{
 const {engine,post}=await fixture(t);
 const {getAllAgents}=require('../upstream/agents/registry');
 for(const agent of getAllAgents()) {
  const event=Object.keys(agent.eventMap||{})[0]; if(!event)continue;
  const response=await post({agent_id:agent.id,session_id:'shared-id',event,state:agent.eventMap[event],session_seq:0,event_seq:0});
  assert.equal(response.status,200,agent.id);
 }
 const ids=engine.snapshot().sessions.map(s=>s.id);assert.equal(ids.length,new Set(ids).size);
 assert.ok(engine.snapshot().sessions.length>10);
});
test('unauthenticated, missing identity, oversized and control requests rejected',async t=>{
 const {engine,post}=await fixture(t);
 assert.equal((await fetch(engine.url+'/snapshot')).status,401);
 assert.equal((await post({agent_id:'claude-code',session_id:'default',event:'SessionStart',state:'idle'})).status,422);
 assert.equal((await post({session_id:'one',padding:'x'.repeat(20000)})).status,413);
 assert.equal((await post({},'/session_command')).status,404);
 assert.equal(engine.snapshot().sessions.length,0);
});

test('upstream live-work Stop gate cannot be bypassed by export',async t=>{
 const {engine,event}=await fixture(t);
 await event('SessionStart');await event('UserPromptSubmit');
 await event('Stop','one',{stop_hook_active:true});
 assert.equal(engine.snapshot().sessions[0].phase,'working');
 assert.equal(engine.snapshot().sessions[0].completionId,undefined);
 await event('UserPromptSubmit');await event('Stop');
 assert.equal(engine.snapshot().sessions[0].phase,'done');
});

test('a completed CLI session remains visible for one display interval after exit',async t=>{
 const {engine,event}=await fixture(t);
 await event('SessionStart');await event('UserPromptSubmit');await event('Stop');await event('SessionEnd');
 assert.equal(engine.snapshot().sessions[0].phase,'done');
});

test('identified subagent cannot replace parent waiting state',async t=>{
 const {engine,event}=await fixture(t);
 await event('SessionStart');await event('PreToolUse','one',{tool_name:'AskUserQuestion'});
 await event('SubagentStart','one',{agent_id:'child-1',agent_type:'reviewer'});
 const rows=engine.snapshot().sessions;
 assert.equal(rows.length,2);
 const child=rows.find(row=>row.parentId);
 assert.ok(child);assert.equal(child.phase,'working');
 assert.equal(rows.find(row=>row.id===child.parentId).phase,'waiting_for_answer');
});

test('headless exit lets the original completion debounce settle',async t=>{
 const {engine,post}=await fixture(t);
 await post({agent_id:'claude-code',session_id:'print',event:'UserPromptSubmit',state:'thinking',headless:true});
 await post({agent_id:'claude-code',session_id:'print',event:'Stop',state:'attention',headless:true});
 await post({agent_id:'claude-code',session_id:'print',event:'SessionEnd',state:'sleeping',headless:true});
 assert.equal(engine.snapshot().sessions[0].phase,'working');
 await new Promise(resolve=>setTimeout(resolve,2100));
 assert.equal(engine.snapshot().sessions[0].phase,'done');
});

test('native Claude elicitation is a question, not ordinary idle',async t=>{
 const {engine,event}=await fixture(t);
 await event('SessionStart');await event('Elicitation');
 assert.equal(engine.snapshot().sessions[0].phase,'waiting_for_answer');
 await event('PreToolUse');
 assert.equal(engine.snapshot().sessions[0].phase,'tool_use');
});

test('late child completion cannot restart a completed parent',async t=>{
 const {engine,event}=await fixture(t);
 await event('SessionStart');await event('UserPromptSubmit');await event('Stop');
 await new Promise(resolve=>setTimeout(resolve,250));
 assert.equal(engine.snapshot().sessions[0].phase,'done');
 await event('SubagentStop','one',{agent_id:'background-summary',agent_type:'summary'});
 const sessions=engine.snapshot().sessions;
 const parent=sessions.find(row=>!row.parentId);
 assert.equal(parent.phase,'done');
 assert.ok(sessions.some(row=>row.parentId===parent.id));
});

test('manual native denial settles only its exact waiting tool from transcript evidence',async t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vibetv-denial-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const transcript=path.join(dir,'session.jsonl');fs.writeFileSync(transcript,'');
 const {engine,event}=await fixture(t);
 await event('SessionStart');
 const tool_input={file_path:'/fixture',content:'PRIVATE file content'};
 fs.appendFileSync(transcript,JSON.stringify({type:'assistant',sessionId:'one',message:{content:[{type:'tool_use',id:'call-a',name:'Write',input:tool_input}]}})+'\n');
 await event('PermissionRequest','one',{tool_name:'Write',tool_input,transcript_path:transcript});
 const result=(sessionId,callId,is_error)=>JSON.stringify({type:'user',sessionId,timestamp:new Date().toISOString(),message:{content:[{type:'tool_result',tool_use_id:callId,is_error,content:'PRIVATE denial content'}]}})+'\n';
 fs.appendFileSync(transcript,result('another-session','call-a',true)+result('one','another-call',true));
 assert.equal(engine.snapshot().sessions[0].phase,'waiting_for_permission');
 fs.appendFileSync(transcript,result('one','call-a',true));
 const snapshot=engine.snapshot();
 assert.equal(snapshot.sessions[0].phase,'error');
 assert.equal(snapshot.sessions[0].errorKind,'tool');
 assert.doesNotMatch(JSON.stringify(snapshot),/PRIVATE|session.jsonl/);
});
