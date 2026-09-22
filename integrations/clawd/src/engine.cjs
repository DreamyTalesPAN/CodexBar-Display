// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const http=require('node:http');
const path=require('node:path');
const {randomUUID,timingSafeEqual}=require('node:crypto');
const {observe,project,digest}=require('./lifecycle.cjs');
const upstream=name=>require(path.join(__dirname,'../upstream',name));
const lock=require('../upstream.lock.json');
const integrations=require('./integrations.cjs');
const {reconcileWait}=require('./claude-wait.cjs');
const {getAllAgents,getAgent}=upstream('agents/registry');
const {classifyPermissionInteraction}=upstream('src/permission-automation-policy');
const {resolveHookAgentId}=upstream('src/server-agent-id');
const initState=upstream('src/state');
const createRuntime=upstream('src/agent-runtime-main');
const {handleStatePost}=upstream('src/server-route-state');
const {createTranslator}=upstream('src/i18n');
const noop=()=>{};
// Explicit source identities, not model/account inference. Unmapped clients
// still report lifecycle but cannot select an unrelated provider's quota.
const usageProviders={'codex':'codex','claude-code':'claude','gemini-cli':'gemini','antigravity-cli':'antigravity','copilot-cli':'copilot'};
const priority=['waiting_for_permission','waiting_for_answer','waiting_for_review','error','compacting','tool_use','thinking','working','done','stale','idle','unavailable'];
async function createEngine({token,port=0,codexSessionsDir=null,integrationOptions=null,now=Date.now}={}) {
 if(typeof token!=='string'||token.length<32) throw Error('engine-token-required');
 const instance=randomUUID();
 const ctx={lang:'en',theme:{hitBoxes:{default:{}},states:Object.fromEntries(['idle',...new Set(getAllAgents().flatMap(agent=>Object.values(agent.eventMap||{})))].map(state=>[state,['']])),timings:{minDisplay:{},autoReturn:{}}},
  doNotDisturb:false,miniTransitioning:false,miniMode:false,mouseOverPet:false,idlePaused:true,
  forceEyeResend:false,eyePauseUntil:0,mouseStillSince:now(),miniSleepPeeked:false,
  pendingPermissions:[],hideBubbles:true,PASSTHROUGH_TOOLS:new Set(),
  claudeQuotaCollectionEnabled:false,kimiQuotaCollectionEnabled:false,
  playSound:noop,sendToRenderer:noop,syncHitWin:noop,sendToHitWin:noop,miniPeekIn:noop,miniPeekOut:noop,
  buildContextMenu:noop,buildTrayMenu:noop,dismissPermissionsForDnd:noop,focusTerminalWindow:noop,
  getCursorScreenPoint:()=>({x:0,y:0}),isAgentEnabled:()=>true,
  isAgentPermissionsEnabled:()=>false,isAgentSubagentPermissionsEnabled:()=>false,
  isCodexPermissionInterceptEnabled:()=>false,permLog:noop,
  resolvePermissionEntry:()=>{throw Error('observation-cannot-decide');},
 };
 ctx.t=createTranslator(()=>ctx.lang);
 const state=initState(ctx);Object.assign(ctx,state);
 // Keep account quota out of this engine, including unsolicited hook metadata.
 state.updateAccountQuota=noop;ctx.updateAccountQuota=noop;
 const update=(id,value,event,opts={})=>{
  // Route explicit child events before updating the parent. Clawd's visual
  // parent bookkeeping can clear its completed-turn flag on SubagentStop;
  // that must not undo an independently completed or waiting parent session.
  if(opts.subagentId) {
   const childId=id+':subagent:'+opts.subagentId;
   const childEvent=String(event).toLowerCase()==='subagentstart'?'UserPromptSubmit':String(event).toLowerCase()==='subagentstop'?'Stop':event;
   const accepted=update(childId,value,childEvent,{...opts,subagentId:null,subagentType:null});
   const child=state.sessions.get(childId);
   if(child) child.parentObservationId=digest(child.agentId+':'+id);
   return accepted;
  }
  const previous=state.sessions.get(id);
  // Keep Clawd's own deferred completion timer alive when a print-mode CLI
  // exits immediately after Stop. A vetoed Stop still cannot auto-promote.
  if(previous?.observation?.completedAt && String(event).toLowerCase()==='sessionend') {
   previous.endedAt=now();
   return true;
  }
  const accepted=state.updateSession(id,value,event,opts);
  let session=state.sessions.get(id);
  // Upstream deletes ended sessions immediately. Retain their final metadata
  // in that same bounded map long enough for a display polling once per 5s.
  if(!session && previous && String(event).toLowerCase()==='sessionend') {
   session={...previous,endedAt:now()};
   if(!previous.observation?.completedAt) observe(session,previous,event,'idle',opts,now());
   state.sessions.set(id,session);
   return accepted;
  }
  if(accepted!==false&&session) {
   observe(session,previous,event,value,opts,now());
   if(String(event).toLowerCase()==='pretooluse'||(String(event).toLowerCase()==='permissionrequest' && getAgent(session.agentId)?.capabilities?.permissionApproval===true)) {
    const interaction=classifyPermissionInteraction({agentId:session.agentId,toolName:opts.toolName});
    if(String(event).toLowerCase()!=='pretooluse'||['human-question','plan-review'].includes(interaction.intent)) session.observation.wait={intent:interaction.intent,at:now(),callId:opts.toolUseId,transcriptPath:opts.transcriptPath||session.transcriptPath};
   }
  }
  return accepted;
 };
 const runtime=createRuntime({getStateRuntime:()=>state,updateSession:update,isAgentEnabled:()=>true,logWarn:noop,
  loadCodexAgent:()=>{const config=upstream('agents/codex');return {...config,logConfig:{...config.logConfig,sessionDir:codexSessionsDir,pollIntervalMs:1000}};},
  showCodexUserInputBubble:input=>{
   const session=state.sessions.get(input.sessionId);
   if(session?.observation) session.observation.wait={intent:'human-question',at:now(),callId:input.callId};
   return false;
  },
  clearCodexUserInputBubbles:(id,callId)=>{
   const session=state.sessions.get(id);
   if(session?.observation?.wait&&(!callId||session.observation.wait.callId===callId)) {
    observe(session,null,'UserInputResolved','working',{},now());
   }
  },
 });
 ctx.updateSession=runtime.updateSessionFromServer;
 ctx.updateSessionMetadata=runtime.updateSessionMetadataFromServer;
 const recorder=()=>({accepted:noop,acceptedUnlessDnd:noop,droppedByDisabled:noop,droppedByDnd:noop,droppedInvalidAgent:noop,droppedUnsupported:noop});
 const options={dshStateSequenceFence:upstream('src/dsh-state-sequence').createDshStateSequenceFence(),grokTurnFence:upstream('src/grok-turn-fence')(),ctx,createRequestHookRecorder:recorder,shouldDropForDnd:()=>false,codexOfficialTurns:new Map(),isClaudeStatuslineMetadataAllowed:()=>false};
 function snapshot() {
  const generatedAt=now();
  for(const [id,session] of state.sessions) {
   reconcileWait(id,session,update,generatedAt);
   if(session.endedAt && generatedAt-session.endedAt>=10000) state.sessions.delete(id);
  }
  const sessions=[...state.sessions].map(([id,session])=>project(id,session,{now:generatedAt})).sort((a,b)=>a.id.localeCompare(b.id));
  const phase=priority.find(value=>sessions.some(session=>session.phase===value))||'unavailable';
  return {schemaVersion:1,engineVersion:lock.engineVersion,upstreamRevision:lock.clawd.commit,instance,generatedAt,health:'ready',phase,sessions,
   sources:getAllAgents().map(agent=>({id:agent.id,name:agent.name,usageProvider:usageProviders[agent.id],transport:agent.eventSource,capabilityLevel:agent.id==='codex'?'log-observed':integrations.profiles[agent.id]?'hook-adapter':'declared',explicitThinking:false}))};
 }
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  const auth=Buffer.from(req.headers.authorization||'');const expected=Buffer.from('Bearer '+token);
  if(auth.length!==expected.length||!timingSafeEqual(auth,expected)) {res.writeHead(401);res.end();return;}
  if(req.method==='GET'&&req.url==='/snapshot') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify(snapshot()));return;}
  if(req.method!=='POST'||!['/state','/integrations'].includes(req.url)) {res.writeHead(404);res.end();return;}
  let body=Buffer.alloc(0);
  try {
   for await(const chunk of req) {if(body.length+chunk.length>16384){res.writeHead(413);res.end();return;}body=Buffer.concat([body,chunk]);}
   const data=JSON.parse(body.toString());
   if(req.url==='/integrations') {
    if(!integrationOptions) {res.writeHead(503);res.end();return;}
    try {
     if(!data||Object.keys(data).some(key=>key!=='enabled')) throw Error('invalid-agent-activity');
     integrations.configureAll(data.enabled,integrationOptions);
    }
    catch {res.writeHead(409);res.end(JSON.stringify({error:'agent-integration-could-not-be-saved'}));return;}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(snapshot()));return;
   }
   if(!data||typeof data.session_id!=='string'||!data.session_id.trim()||data.session_id.length>256||/(^|:)default$/.test(data.session_id)) {res.writeHead(422);res.end();return;}
   const identity=resolveHookAgentId(data,{allowDefaultAgent:false});
   if(identity.rejected||!getAllAgents().some(agent=>agent.id===identity.agentId)){res.writeHead(422);res.end();return;}
   // Native Codex JSONL uses canonical raw IDs; namespace other clients at ingress.
   if(identity.agentId!=='codex') data.session_id=identity.agentId+':'+data.session_id;
   // Replay the bounded body to the unmodified Clawd ingress parser.
   const {Readable}=require('node:stream');const incoming=Readable.from([Buffer.from(JSON.stringify(data))]);
   incoming.headers=req.headers;
   handleStatePost(incoming,res,options);
  } catch {if(!res.headersSent)res.writeHead(400);res.end();}
 });
 server.requestTimeout=3000;server.headersTimeout=3000;server.maxConnections=32;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 if(codexSessionsDir) runtime.startCodexLogMonitor();
 return {snapshot,url:`http://127.0.0.1:${server.address().port}`,state,runtime,
  async close(){runtime.cleanup();state.cleanup();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));},
 };
}
module.exports={createEngine};
