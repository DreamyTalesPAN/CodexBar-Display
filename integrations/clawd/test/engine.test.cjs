// SPDX-License-Identifier: AGPL-3.0-only
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createEngine}=require('../src/engine.cjs');
const claude=require('../upstream/hooks/clawd-hook');
const token='test-only-token-'.repeat(3);
async function fixture(t) {
 const engine=await createEngine({token});t.after(()=>engine.close());
 const post=(body,url='/state')=>fetch(engine.url+url,{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify(body)});
 const event=(event,sid='one',extra={})=>post(claude.buildStateBody(event,{session_id:sid,tool_name:'Read',...extra},()=>({})));
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
 const {engine,event,post}=await fixture(t);
 await event('SessionStart');await event('UserPromptSubmit');
 for(const [tool,phase] of [['Bash','waiting_for_permission'],['AskUserQuestion','waiting_for_answer'],['ExitPlanMode','waiting_for_review']]) {
  await event('PreToolUse','one',{tool_name:tool});
  const response=await post({agent_id:'claude-code',session_id:'one',tool_name:tool},'/permission');
  assert.equal(response.status,204);assert.equal(await response.text(),'');
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
