// SPDX-License-Identifier: AGPL-3.0-only
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {observe, project} = require('../src/lifecycle.cjs');
const row = (event, state='working', extra={}) => {
 const session={agentId:'claude-code', state, ...extra};
 observe(session, null, event, state, {}, 1000);
 return session;
};
for (const [event,phase] of Object.entries({SessionStart:'idle',UserPromptSubmit:'working',PreToolUse:'tool_use',PostToolUse:'working',PreCompact:'compacting',SessionEnd:'unavailable',PostToolUseFailure:'error',StopFailure:'error'})) {
 test(event,()=>assert.equal(project('session',row(event),{now:1000}).phase,phase));
}
test('visual thinking is not evidence of reasoning',()=>assert.equal(project('s',row('UserPromptSubmit','thinking'),{now:1000}).phase,'working'));
test('explicit reasoning event is distinct',()=>assert.equal(project('s',row('event_msg:agent_reasoning','thinking'),{now:1000}).phase,'thinking'));
test('permission, question and review stay distinct across notifications',()=>{
 for(const [intent,phase] of [['tool-approval','waiting_for_permission'],['human-question','waiting_for_answer'],['plan-review','waiting_for_review']]) {
  const before=row('PreToolUse'); before.observation.wait={intent,at:1001};
  const after={agentId:'claude-code',state:'notification'};
  observe(after,before,'Notification','notification',{},1002);
  assert.equal(project('s',after,{now:1002}).phase,phase);
 }
});
test('completion is bounded and duplicate Stop cannot replay it',()=>{
 let session=row('Stop','attention');
 assert.equal(project('s',session,{now:1001,doneMs:1000}).phase,'done');
 const previous=session;session={agentId:'claude-code',state:'attention'};
 observe(session,previous,'Stop','attention',{},5000);
 assert.equal(project('s',session,{now:5000,doneMs:1000}).phase,'idle');
 assert.equal(session.observation.completedAt,1000);
});
test('historical completion is never replayed on restart',()=>{
 const session={agentId:'codex',state:'attention'};
 observe(session,null,'event_msg:task_complete','attention',{recapOccurredAt:500,recapSuppressed:true},1000);
 assert.equal(project('s',session,{now:1000}).phase,'idle');
});
test('silence does not mean idle; expired evidence is stale',()=>{
 assert.equal(project('s',row('PreToolUse'),{now:301001,staleMs:300000}).phase,'stale');
});
test('manual compaction may end in idle',()=>assert.equal(project('s',row('PostCompact','idle'),{now:1000}).phase,'idle'));
test('export strips private fields and hashes source identifiers',()=>{
 const result=project('private-session',row('PreToolUse','working',{cwd:'/private/project',assistantLastOutput:'secret prompt',model:'secret-model'}),{now:1000});
 assert.doesNotMatch(JSON.stringify(result),/private|secret/);
 assert.match(result.id,/^[a-f0-9]{32}$/);
});
test('missing and future evidence cannot imply working',()=>{
 assert.equal(project('s',{agentId:'codex',state:'working'},{now:1000}).phase,'unavailable');
 assert.equal(project('s',row('PreToolUse'),{now:0}).phase,'unavailable');
});
