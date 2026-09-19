// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
// Clawd fork export policy. The original runtime remains the session owner.
// Never derive reasoning from Clawd's visual "thinking" animation.
const {createHash} = require('node:crypto');
const phases = {
 sessionstart:'idle', agentspawn:'idle', session_meta:'idle',
 userpromptsubmit:'working', beforeagent:'working', beforemodel:'working',
 pretooluse:'tool_use', beforetool:'tool_use',
 posttooluse:'working', aftertool:'working', aftermodel:'working',
 precompact:'compacting', precompress:'compacting', postcompact:'working',
 posttoolusefailure:'error', stopfailure:'error', apierror:'error',
 sessionend:'unavailable', afteragent:'idle',
 'event_msg:task_started':'working', 'event_msg:user_message':'working',
 'response_item:function_call':'tool_use', 'response_item:custom_tool_call':'tool_use',
 'response_item:web_search_call':'tool_use', 'event_msg:exec_command_end':'working',
 'event_msg:patch_apply_end':'working', 'event_msg:custom_tool_call_output':'working',
 'event_msg:agent_reasoning':'thinking', 'event_msg:turn_aborted':'idle',
 userinputresolved:'working', subagentstart:'working', subagentstop:'working',
};
const waits={'tool-approval':'waiting_for_permission','human-question':'waiting_for_answer','plan-review':'waiting_for_review'};
const housekeeping=new Set(['notification','event_msg:token_count','stale-cleanup']);
const completions=new Set(['stop','event_msg:task_complete']);
const digest=value=>createHash('sha256').update(String(value)).digest('hex').slice(0,32);
function observe(session,previous,event,state,opts={},now=Date.now()) {
 const old=previous?.observation;
 const name=String(event).toLowerCase();
 if(housekeeping.has(name)) {session.observation=old;return;}
 // Upstream turn fencing owns order. Preserve its trusted source time on logs.
 const at=Number.isSafeInteger(opts.recapOccurredAt)?opts.recapOccurredAt:now;
 if(old && at<old.at) {session.observation=old;return;}
 if(completions.has(name) && old?.completedAt) {session.observation=old;return;}
 session.observation={event:name,at,state};
 if(completions.has(name)) {
  session.observation.completedAt=at;
  session.observation.historical=opts.recapSuppressed===true;
 }
}
function project(id,session,{now=Date.now(),doneMs=10000,staleMs=300000}={}) {
 const evidence=session.observation;
 let phase=phases[evidence?.event] || 'unavailable';
 let reason=evidence?'accepted-event':'no-lifecycle-evidence';
 if(evidence?.event==='postcompact' && evidence.state==='idle') phase='idle';
 if(evidence?.completedAt) {
  phase=!evidence.historical && now-evidence.completedAt<doneMs?'done':'idle';
  reason='turn-complete';
 }
 if(evidence?.wait) {phase=waits[evidence.wait.intent] || 'unavailable';reason='explicit-interaction';}
 const observedAt=Math.max(evidence?.at||0,evidence?.wait?.at||0);
 if(observedAt>now) {phase='unavailable';reason='clock-skew';}
 else if(observedAt && now-observedAt>staleMs && !['idle','unavailable'].includes(phase)) {
  phase='stale';reason='observation-expired';
 }
 return {id:digest(session.agentId+':'+id),source:session.agentId,phase,reason,observedAt,
  ...(evidence?.completedAt?{completionId:digest(id+':'+evidence.completedAt)}:{}),
  ...(phase==='error'?{errorKind:evidence.event==='posttoolusefailure'?'tool':'turn'}:{}),
 };
}
module.exports={observe,project,digest,phases};
