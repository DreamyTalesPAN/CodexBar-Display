// SPDX-License-Identifier: AGPL-3.0-only
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createEngine}=require('../src/engine.cjs');
const {parseCodexUserInputRecord:parse}=require('../upstream/hooks/codex-user-input');
const token='test-only-token-'.repeat(3);
const response=payload=>({type:'response_item',payload,timestamp:new Date().toISOString()});
const request=(name='request_user_input_async',call_id='question-1')=>response({type:'function_call',name,call_id,arguments:JSON.stringify({questions:[name.endsWith('_async')?{title:'Private question',options:['Yes','No']}:{id:'one',question:'Private question',options:[]}]})});
const answer=(id='question-1')=>response({type:'message',role:'user',content:[{type:'input_text',text:'<send_user_message_question_reply>\n'+JSON.stringify([{questionItemId:JSON.stringify(['request_user_input_async',id,0]),answer:'Private answer'}])+'\n</send_user_message_question_reply>'}]});
async function until(check){for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,50));}assert.fail('observer did not reach expected phase');}

test('async parser recognizes the actual Desktop schema and correlated answer',()=>{
 assert.equal(parse(request()).async,true);
 assert.equal(parse(answer()).callId,'question-1');
 assert.equal(parse(request('request_user_input')).phase,'request');
 for(const payload of [{type:'message',role:'assistant',content:answer().payload.content},{type:'message',role:'user',content:[{type:'input_text',text:'Just an ordinary message'}]},{type:'message',role:'user',content:[{type:'input_text',text:'<send_user_message_question_reply>broken</send_user_message_question_reply>'}]}]) assert.equal(parse(response(payload)),null);
});

test('real Codex log monitor retains async wait through acceptance, tools and restart until the matching reply',{timeout:20000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vibetv-codex-question-'));
 const dayDir=path.join(dir,...new Date().toISOString().slice(0,10).split('-'));
 fs.mkdirSync(dayDir,{recursive:true});
 const file=path.join(dayDir,'rollout-2026-09-26T12-00-00-11111111-1111-4111-8111-111111111111.jsonl');
 const append=record=>fs.appendFileSync(file,JSON.stringify(record)+'\n');
 let engine;
 t.after(async()=>{await engine?.close();fs.rmSync(dir,{recursive:true,force:true});});
 engine=await createEngine({token,codexSessionsDir:dir});
 append({type:'session_meta',timestamp:new Date().toISOString(),payload:{id:'11111111-1111-4111-8111-111111111111',cwd:dir,source:'cli',originator:'codex_desktop'}});
 append({type:'event_msg',timestamp:new Date().toISOString(),payload:{type:'task_started',turn_id:'turn-1'}});
 await until(()=>engine.snapshot().phase==='working');
 append(request());
 await until(()=>engine.snapshot().phase==='waiting_for_answer');
 append(response({type:'function_call_output',call_id:'question-1',output:'{"accepted":true}'}));
 append(response({type:'function_call',call_id:'work-1',name:'exec_command',arguments:'{}'}));
 await until(()=>engine.snapshot().sessions[0]?.reason==='explicit-interaction' && [...engine.state.sessions.values()][0]?.observation?.event==='response_item:function_call');
 assert.equal(engine.snapshot().phase,'waiting_for_answer');
 await engine.close();engine=await createEngine({token,codexSessionsDir:dir});
 await until(()=>engine.snapshot().phase==='waiting_for_answer');
 append(answer('unrelated-question'));
 append(response({type:'function_call',call_id:'work-2',name:'exec_command',arguments:'{}'}));
 await until(()=>[...engine.state.sessions.values()][0]?.observation?.event==='response_item:function_call');
 assert.equal(engine.snapshot().phase,'waiting_for_answer');
 append(answer());
 await until(()=>engine.snapshot().phase==='working');
 assert.doesNotMatch(JSON.stringify(engine.snapshot()),/Private question|Private answer/);
 // The existing blocking question must still work, including its output.
 append(request('request_user_input','blocking-1'));
 await until(()=>engine.snapshot().phase==='waiting_for_answer');
 append(response({type:'function_call_output',call_id:'blocking-1',output:'{"answers":{}}'}));
 await until(()=>engine.snapshot().phase==='working');
 append(request());await until(()=>engine.snapshot().phase==='waiting_for_answer');
 append({type:'event_msg',timestamp:new Date().toISOString(),payload:{type:'task_complete',turn_id:'turn-1'}});
 await until(()=>[...engine.state.sessions.values()][0]?.observation?.completedAt);
 assert.equal(engine.snapshot().phase,'waiting_for_answer','finishing work must not dismiss an unanswered async question');
 await engine.close();engine=await createEngine({token,codexSessionsDir:dir});
 await until(()=>engine.snapshot().phase==='waiting_for_answer');
 append(answer());await until(()=>engine.snapshot().phase!=='waiting_for_answer');
 append({type:'event_msg',timestamp:new Date().toISOString(),payload:{type:'task_started',turn_id:'turn-2'}});
 append(request());await until(()=>engine.snapshot().phase==='waiting_for_answer');
 append({type:'event_msg',timestamp:new Date().toISOString(),payload:{type:'turn_aborted',turn_id:'turn-2'}});
 await until(()=>engine.snapshot().phase!=='waiting_for_answer');
});
